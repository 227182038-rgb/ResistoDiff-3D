"""
SE(3)-Equivariant Graph Neural Network for Protein Mutation Analysis.

Implements the E(n)-Equivariant GNN (EGNN) architecture adapted for
protein structure modeling and mutation effect prediction as part of
the ResistoDiff-3D drug discovery platform.

References:
    - Satorras et al., "E(n) Equivariant Graph Neural Networks", ICML 2021
    - Schütt et al., "SchNet: A continuous-filter convolutional neural network",
      2017

All computations are CPU-only (device='cpu').
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple, Union

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch import Tensor

# --------------- constants ---------------

AMINO_ACIDS = list("ACDEFGHIKLMNPQRSTVWY")
AA_TO_IDX = {aa: i for i, aa in enumerate(AMINO_ACIDS)}
DEFAULT_CATALYTIC_TRIAD = {"H", "D", "S"}  # serine protease default

# Simple rotamer library: chi1 angles (degrees) for each amino acid type.
# Keys are one-letter codes; values are lists of chi1 angle samples.
ROTAMER_LIBRARY: Dict[str, List[float]] = {
    "A": [60.0, 180.0, -60.0],
    "R": [60.0, 180.0, -60.0],
    "N": [60.0, 180.0, -60.0],
    "D": [60.0, 180.0, -60.0],
    "C": [60.0, 180.0, -60.0],
    "Q": [60.0, 180.0, -60.0],
    "E": [60.0, 180.0, -60.0],
    "G": [0.0],
    "H": [60.0, 180.0, -60.0],
    "I": [60.0, 180.0, -60.0],
    "L": [60.0, 180.0, -60.0],
    "K": [60.0, 180.0, -60.0],
    "M": [60.0, 180.0, -60.0],
    "F": [60.0, 180.0, -60.0],
    "P": [0.0],
    "S": [60.0, 180.0, -60.0],
    "T": [60.0, 180.0, -60.0],
    "W": [60.0, 180.0, -60.0],
    "Y": [60.0, 180.0, -60.0],
    "V": [60.0, 180.0, -60.0],
}


# ================================================================== #
#                      Utility Functions                             #
# ================================================================== #


def get_amino_acid_one_hot(aa_letter: str) -> Tensor:
    """Return a 20-dimensional one-hot tensor for the given amino acid letter.

    Unknown residues map to an all-zeros vector.
    """
    vec = torch.zeros(20, dtype=torch.float32)
    idx = AA_TO_IDX.get(aa_letter.upper(), None)
    if idx is not None:
        vec[idx] = 1.0
    return vec


def compute_rmsd(coords1: Tensor, coords2: Tensor) -> float:
    """Compute RMSD between two coordinate sets of shape (N, 3).

    Uses the Kabsch-alignment-free formula when the correspondences
    are already known (same ordering).
    """
    if coords1.shape != coords2.shape:
        raise ValueError(
        f"Coordinate shape mismatch: {coords1.shape} vs {coords2.shape}"
    )
    diff = coords1 - coords2
    return float(torch.sqrt(torch.mean(diff ** 2)).item())


def generate_mutant_coords(
    wt_coords: Tensor,
    mutation_position: int,
    new_aa: str,
    rotamer_library: Optional[Dict[str, List[float]]] = None,
) -> Tensor:
    """Generate mutant CA coordinates by perturbing the mutation site.

    Strategy: apply a small rotation around the CA-CB bond direction
    (approximated from neighbours) using chi1 rotamer angles.
    """
    rot_lib = rotamer_library or ROTAMER_LIBRARY
    mut_coords = wt_coords.clone()
    n_residues = wt_coords.shape[0]
    if mutation_position < 0 or mutation_position >= n_residues:
        return mut_coords

    # Pick a rotamer angle (middle of the library entries)
    angles = rot_lib.get(new_aa.upper(), [0.0])
    angle_deg = angles[len(angles) // 2]
    angle_rad = math.radians(angle_deg)

    # Approximate CB direction using neighbours
    prev_pos = max(mutation_position - 1, 0)
    next_pos = min(mutation_position + 1, n_residues - 1)
    direction = mut_coords[next_pos] - mut_coords[prev_pos]
    norm = direction.norm()
    if norm < 1e-8:
        direction = torch.tensor([1.0, 0.0, 0.0])
    else:
        direction = direction / norm

    # Rodrigues rotation around the approximate bond axis
    k = direction
    v = torch.zeros(3)
    # create a perpendicular displacement (~1.5 A CA-CB bond)
    perp = torch.linalg.cross(k, torch.tensor([0.0, 0.0, 1.0]))
    if perp.norm() < 1e-6:
        perp = torch.linalg.cross(k, torch.tensor([1.0, 0.0, 0.0]))
    perp = perp / perp.norm() * 1.5
    v = (
        perp * math.cos(angle_rad)
        + torch.linalg.cross(k, perp) * math.sin(angle_rad)
        + k * torch.dot(k, perp) * (1 - math.cos(angle_rad))
    )
    mut_coords[mutation_position] += v * 0.3  # subtle shift
    return mut_coords


# ================================================================== #
#                    EGNN Message Passing Layer                       #
# ================================================================== #


class EGNNMessagePassingLayer(nn.Module):
    """Single E(n)-equivariant message passing layer.

    Implements the equivariant update rules from Satorras et al. (2021):

    * Edge message:  m_ij = MLP_edge([h_i, h_j, ||x_i - x_j||^2, e_ij])
    * Coord update:  x_i' = x_i + Σ_j (x_i - x_j) · φ_e(m_ij)
    * Node update:   h_i' = MLP_node([h_i, Σ_j m_ij])

    Parameters
    ----------
    hidden_dim : int
        Dimensionality of node/edge hidden features.
    edge_attr_dim : int
        Dimensionality of edge attributes (0 if unused).
    """

    def __init__(self, hidden_dim: int = 128, edge_attr_dim: int = 0) -> None:
        super().__init__()
        self.hidden_dim = hidden_dim

        edge_in = 2 * hidden_dim + 1 + edge_attr_dim

        # Edge MLP: [h_i || h_j || d² || edge_attr] -> hidden_dim
        self.edge_mlp = nn.Sequential(
            nn.Linear(edge_in, hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, hidden_dim),
        )

        # Coordinate MLP: edge_message -> scalar weight per edge
        self.coord_mlp = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, 1),
        )

        # Node MLP: [h_i || agg_messages] -> hidden_dim (residual)
        self.node_mlp = nn.Sequential(
            nn.Linear(2 * hidden_dim, hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, hidden_dim),
        )

        self._reset_parameters()

    # ---------------------------------------------------------- #
    def _reset_parameters(self) -> None:
        """Xavier-initialise all linear layers."""
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

    # ---------------------------------------------------------- #
    def forward(
        self,
        h: Tensor,
        x: Tensor,
        edge_index: Tensor,
        edge_attr: Optional[Tensor] = None,
    ) -> Tuple[Tensor, Tensor]:
        """

        Parameters
        ----------
        h : Tensor, shape (N, hidden_dim)
            Node features.
        x : Tensor, shape (N, 3)
            Node coordinates.
        edge_index : Tensor, shape (2, E)
            Sparse edge index in COO format.
        edge_attr : Tensor or None, shape (E, edge_attr_dim)
            Edge attributes.

        Returns
        -------
        h_new : Tensor, shape (N, hidden_dim)
        x_new : Tensor, shape (N, 3)
        """
        N = h.size(0)
        src, dst = edge_index[0], edge_index[1]  # (E,) each

        # --- Pairwise distance squared ---
        diff = x[src] - x[dst]  # (E, 3)
        dist_sq = (diff ** 2).sum(dim=-1, keepdim=True)  # (E, 1)

        # --- Edge MLP ---
        edge_input_parts: List[Tensor] = [h[src], h[dst], dist_sq]
        if edge_attr is not None:
            edge_input_parts.append(edge_attr)
        edge_input = torch.cat(edge_input_parts, dim=-1)  # (E, edge_in)
        edge_msg = self.edge_mlp(edge_input)  # (E, hidden_dim)

        # --- Coordinate update (SE(3) equivariant) ---
        coord_weight = self.coord_mlp(edge_msg)  # (E, 1)
        coord_delta = diff * coord_weight  # (E, 3)
        x_new = x.clone()
        x_new.scatter_add_(0, dst.unsqueeze(-1).expand_as(coord_delta), coord_delta)

        # --- Aggregate messages to nodes ---
        agg = torch.zeros_like(h)  # (N, hidden_dim)
        agg.scatter_add_(0, dst.unsqueeze(-1).expand_as(edge_msg), edge_msg)

        # --- Node MLP with residual ---
        h_new = self.node_mlp(torch.cat([h, agg], dim=-1)) + h

        return h_new, x_new


# ================================================================== #
#                     ResistoEGNNEncoder                             #
# ================================================================== #


class ResistoEGNNEncoder(nn.Module):
    """Full EGNN encoder for protein structures.

    Stacks four :class:`EGNNMessagePassingLayer` layers with a linear
    node-embedding projection at the input.

    Parameters
    ----------
    input_dim : int
        Raw node-feature dimensionality (e.g. 20 for AA one-hot + extras).
    hidden_dim : int
        Hidden size used throughout the network.
    edge_attr_dim : int
        Edge attribute dimensionality.
    num_layers : int
        Number of EGNN message-passing layers.
    """

    def __init__(
        self,
        input_dim: int = 23,
        hidden_dim: int = 128,
        edge_attr_dim: int = 0,
        num_layers: int = 4,
    ) -> None:
        super().__init__()
        self.hidden_dim = hidden_dim
        self.node_embedding = nn.Linear(input_dim, hidden_dim)
        self.layers = nn.ModuleList(
            [EGNNMessagePassingLayer(hidden_dim, edge_attr_dim) for _ in range(num_layers)]
        )
        self._reset_parameters()

    def _reset_parameters(self) -> None:
        nn.init.xavier_uniform_(self.node_embedding.weight)
        nn.init.zeros_(self.node_embedding.bias)

    def forward(
        self,
        h: Tensor,
        x: Tensor,
        edge_index: Tensor,
        edge_attr: Optional[Tensor] = None,
    ) -> Tuple[Tensor, Tensor]:
        """Run the encoder.

        Returns
        -------
        h : Tensor (N, hidden_dim)
        x : Tensor (N, 3)
        """
        h = self.node_embedding(h)
        for layer in self.layers:
            h, x = layer(h, x, edge_index, edge_attr)
        return h, x


# ================================================================== #
#                      MutationScorer                               #
# ================================================================== #


class MutationScorer(nn.Module):
    """Score protein mutations using structural EGNN features.

    Provides ΔΔG predictions for folding stability, binding affinity,
    and catalytic efficiency, combined into a single fitness score.
    """

    def __init__(self, encoder: ResistoEGNNEncoder) -> None:
        super().__init__()
        self.encoder = encoder
        hid = encoder.hidden_dim

        # Per-residue energy heads
        self.energy_head = nn.Sequential(
            nn.Linear(hid, hid // 2),
            nn.SiLU(),
            nn.Linear(hid // 2, 1),
        )

        # Fitness combination weights (learnable logits → softmax)
        self.fitness_weights = nn.Parameter(torch.tensor([1.0, 0.8, 0.6]))
        self._reset_parameters()

    def _reset_parameters(self) -> None:
        for m in self.energy_head.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

    def _forward_energy(self, h: Tensor, x: Tensor, edge_index: Tensor) -> Tensor:
        """Compute per-node energy from EGNN features."""
        with torch.no_grad():
            h_out, _ = self.encoder(h, x, edge_index)
        return self.energy_head(h_out).squeeze(-1)  # (N,)

    # ---- public API ---- #

    def compute_ddg_fold(
        self,
        wt_coords: Tensor,
        mut_coords: Tensor,
        edge_index: Tensor,
        node_feats: Tensor,
    ) -> float:
        """Predict ΔΔG of folding (kcal/mol).

        Positive = destabilising, Negative = stabilising.
        """
        e_wt = self._forward_energy(node_feats, wt_coords, edge_index).sum()
        e_mut = self._forward_energy(node_feats, mut_coords, edge_index).sum()
        return float((e_mut - e_wt).item())

    def compute_ddg_binding(
        self,
        wt_coords: Tensor,
        mut_coords: Tensor,
        active_site_mask: Tensor,
    ) -> float:
        """Predict ΔΔG of binding from active-site geometry changes.

        Uses mean Euclidean displacement of active-site Cα atoms.
        """
        if active_site_mask.sum() == 0:
            return 0.0
        disp = (mut_coords - wt_coords)[active_site_mask.bool()]
        # Scale: 1 Å mean displacement ≈ 1.5 kcal/mol (empirical proxy)
        return float(disp.norm(dim=-1).mean().item() * 1.5)

    def compute_catalysis_effect(
        self,
        mut_coords: Tensor,
        catalytic_residues: Sequence[int],
    ) -> float:
        """Estimate catalytic efficiency change from triad geometry.

        Compares inter-residue distances within the catalytic triad
        after mutation. Larger deviation → worse catalysis.
        """
        if len(catalytic_residues) < 2:
            return 0.0
        idx = torch.tensor(catalytic_residues, dtype=torch.long)
        if idx.max() >= mut_coords.size(0):
            return 0.0
        triad = mut_coords[idx]  # (T, 3)
        # Sum of pairwise distances
        total_d = 0.0
        count = 0
        for i in range(triad.size(0)):
            for j in range(i + 1, triad.size(0)):
                total_d += (triad[i] - triad[j]).norm().item()
                count += 1
        # Ideal triad centroid distance ~6 Å; deviation from that is penalised
        ideal = 6.0
        mean_d = total_d / max(count, 1)
        return float(abs(mean_d - ideal) * 2.0)

    def compute_fitness_score(
        self, ddg_fold: float, ddg_catalysis: float, ddg_binding: float,
    ) -> float:
        """Combine scores with learnable weights.

        Lower is better for all components, so we negate and softmax-weight.
        """
        w = F.softmax(self.fitness_weights, dim=0)
        raw = w[0] * (-ddg_fold) + w[1] * (-ddg_catalysis) + w[2] * (-ddg_binding)
        # Map to [0, 1] via sigmoid for interpretability
        return float(torch.sigmoid(raw).item())


# ================================================================== #
#                    ProteinGraphBuilder                             #
# ================================================================== #


class ProteinGraphBuilder:
    """Convert PDB structures into graph representations for EGNN.

    Node features: amino-acid one-hot (20), secondary structure (3),
    B-factor (1), solvent accessibility proxy (1) → 25-dim input.
    Coordinates: Cα atom positions.
    Edges: k-nearest neighbours (k=10) within 8 Å cutoff.
    """

    SS_MAP = {"H": 0, "E": 1, "C": 2}  # helix, sheet, coil
    K_NEIGHBOURS = 10
    CUTOFF_ANGSTROM = 8.0

    # ---- PDB parsing ---- #

    def parse_pdb_to_graph(
        self, pdb_input: Union[str, Path]
    ) -> Tuple[Tensor, Tensor, Tensor, List[Dict]]:
        """Parse a PDB file and return graph tensors.

        Returns
        -------
        h : Tensor (N, 25)
            Node features.
        x : Tensor (N, 3)
            Cα coordinates.
        edge_index : Tensor (2, E)
            Edge list (kNN + sequential).
        residue_info : list[dict]
            Per-residue metadata.
        """
        from Bio.PDB import PDBParser

        pdb_path = Path(pdb_input)
        if not pdb_path.exists():
            raise FileNotFoundError(f"PDB file not found: {pdb_path}")

        parser = PDBParser(QUIET=True)
        structure = parser.get_structure("prot", str(pdb_path))
        model = structure[0]

        coords: List[np.ndarray] = []
        aa_types: List[str] = []
        bfactors: List[float] = []
        res_info: List[Dict] = []

        for chain in model:
            for res in chain:
                if res.id[0] != " ":  # skip HETATMs / waters
                    continue
                if "CA" not in res:
                    continue
                ca = res["CA"]
                coords.append(ca.get_coord().astype(np.float32))
                aa_types.append(res.get_resname())
                bfactors.append(ca.get_bfactor())
                res_info.append(
                    {
                        "resname": res.get_resname(),
                        "resseq": res.id[1],
                        "chain": chain.id,
                        "icode": res.id[2].strip(),
                    }
                )

        if len(coords) == 0:
            raise ValueError("No Cα atoms found in the PDB file.")

        x = torch.from_numpy(np.array(coords, dtype=np.float32))  # (N, 3)
        N = x.size(0)

        # --- Node features ---
        # Use 3-letter → 1-letter mapping
        three_to_one = {
            "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C",
            "GLN": "Q", "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I",
            "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F", "PRO": "P",
            "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V",
        }
        one_hots = torch.stack(
            [get_amino_acid_one_hot(three_to_one.get(aa, "X")) for aa in aa_types]
        )  # (N, 20)

        # Secondary structure: default to coil, could integrate DSSP
        ss = torch.zeros(N, 3, dtype=torch.float32)
        ss[:, 2] = 1.0  # coil

        # B-factor (normalised)
        bf = torch.tensor(bfactors, dtype=torch.float32).unsqueeze(-1)
        bf_mean, bf_std = bf.mean(), bf.std().clamp(min=1e-6)
        bf_norm = (bf - bf_mean) / bf_std

        # Solvent-accessibility proxy: based on Cα-Cβ distance to centroid
        centroid = x.mean(dim=0, keepdim=True)
        dist_to_centroid = (x - centroid).norm(dim=-1, keepdim=True)
        sa_proxy = dist_to_centroid / dist_to_centroid.max().clamp(min=1e-6)

        h = torch.cat([one_hots, ss, bf_norm, sa_proxy], dim=-1)  # (N, 25)

        # --- Edge construction: sequential + kNN ---
        edge_set = set()
        # Sequential edges (backbone connectivity)
        for i in range(N - 1):
            edge_set.add((i, i + 1))
            edge_set.add((i + 1, i))

        # kNN within cutoff
        if N > self.K_NEIGHBOURS:
            dist_mat = torch.cdist(x, x)  # (N, N)
            for i in range(N):
                dists_i = dist_mat[i]
                # Mask self and already-connected
                _, knn_idx = torch.topk(
                    dists_i, k=self.K_NEIGHBOURS + 1, largest=False
                )
                for j in knn_idx[1:]:  # skip self
                    j = j.item()
                    if dists_i[j].item() <= self.CUTOFF_ANGSTROM:
                        edge_set.add((i, j))
                        edge_set.add((j, i))

        if len(edge_set) == 0:
            edge_index = torch.zeros((2, 0), dtype=torch.long)
        else:
            edges = torch.tensor(list(edge_set), dtype=torch.long).t()
            edge_index = edges.contiguous()

        return h, x, edge_index, res_info

    # ---- Active-site mask ---- #

    @staticmethod
    def get_active_site_mask(
        residue_info: List[Dict],
        known_active_sites: Optional[Sequence[Union[str, Tuple[str, int]]]] = None,
    ) -> Tensor:
        """Create a boolean mask for active-site residues.

        Parameters
        ----------
        residue_info : list[dict]
            Per-residue metadata from :meth:`parse_pdb_to_graph`.
        known_active_sites : sequence
            Either residue sequence numbers (int/str) or
            (chain_id, resseq) tuples.

        Returns
        -------
        mask : Tensor (N,) bool
        """
        N = len(residue_info)
        mask = torch.zeros(N, dtype=torch.bool)
        if known_active_sites is None:
            return mask
        for i, info in enumerate(residue_info):
            for site in known_active_sites:
                if isinstance(site, tuple):
                    if info["chain"] == site[0] and info["resseq"] == site[1]:
                        mask[i] = True
                else:
                    if info["resseq"] == int(site):
                        mask[i] = True
        return mask


# ================================================================== #
#                   Pre-trained weights loader                       #
# ================================================================== #


def load_pretrained_egnn(
    model: nn.Module,
    weights_path: Optional[Union[str, Path]] = None,
) -> nn.Module:
    """Load pre-trained weights or Xavier-initialise the model.

    Parameters
    ----------
    model : nn.Module
        The EGNN model (encoder or scorer).
    weights_path : str or Path or None
        Path to ``.pt`` weight file.  If *None* or the file does not
        exist, the model is initialised with Xavier uniform and a
        warning is printed.

    Returns
    -------
    model : nn.Module
        The model (modified in-place, also returned for convenience).
    """
    if weights_path is not None:
        p = Path(weights_path)
        if p.exists():
            state = torch.load(str(p), map_location="cpu", weights_only=True)
            model.load_state_dict(state, strict=False)
            print(f"[EGNN] Loaded weights from {p}")
            return model
    # Fallback: Xavier init
    for m in model.modules():
        if isinstance(m, nn.Linear):
            nn.init.xavier_uniform_(m.weight)
            if m.bias is not None:
                nn.init.zeros_(m.bias)
    if weights_path is not None:
        print(
            f"[EGNN] Weights not found at {weights_path}; "
            "initialised with Xavier uniform."
        )
    else:
        print("[EGNN] No weights path provided; initialised with Xavier uniform.")
    return model


# ================================================================== #
#                          Main / Demo                               #
# ================================================================== #


def _demo() -> None:
    """Quick smoke-test to verify everything runs on CPU."""
    torch.manual_seed(42)
    device = torch.device("cpu")

    # 1. Utility functions
    oh = get_amino_acid_one_hot("A")
    assert oh.sum() == 1.0 and oh.argmax().item() == 0
    print("[OK] get_amino_acid_one_hot")

    rmsd = compute_rmsd(
        torch.randn(10, 3), torch.randn(10, 3) + 0.1
    )
    assert rmsd > 0
    print(f"[OK] compute_rmsd = {rmsd:.4f}")

    # 2. Build a synthetic protein graph (50 residues)
    N = 50
    x = torch.randn(N, 3, device=device)
    h = torch.randn(N, 25, device=device)

    # kNN edges
    dists = torch.cdist(x, x)
    _, idx = torch.topk(dists, k=11, largest=False, dim=1)
    edge_list = set()
    for i in range(N):
        for j in idx[i][1:].tolist():
            if dists[i, j] < 10.0:
                edge_list.add((i, j))
                edge_list.add((j, i))
    for i in range(N - 1):
        edge_list.add((i, i + 1))
        edge_list.add((i + 1, i))
    edge_index = torch.tensor(list(edge_list), dtype=torch.long).t().contiguous()
    print(f"[OK] Synthetic graph: {N} nodes, {edge_index.size(1)} edges")

    # 3. EGNN layer (standalone test with hidden_dim features)
    h64 = torch.randn(N, 64, device=device)
    layer = EGNNMessagePassingLayer(hidden_dim=64).to(device)
    h_out, x_out = layer(h64, x, edge_index)
    assert h_out.shape == (N, 64)
    assert x_out.shape == (N, 3)
    print(f"[OK] EGNNMessagePassingLayer  h={h_out.shape}  x={x_out.shape}")

    # 4. Full encoder
    encoder = ResistoEGNNEncoder(input_dim=25, hidden_dim=64, num_layers=4).to(device)
    h_enc, x_enc = encoder(h, x, edge_index)
    assert h_enc.shape == (N, 64)
    print(f"[OK] ResistoEGNNEncoder  h={h_enc.shape}  x={x_enc.shape}")

    # 5. MutationScorer
    scorer = MutationScorer(encoder).to(device)
    mut_coords = generate_mutant_coords(x, mutation_position=25, new_aa="R")
    active_mask = torch.zeros(N, dtype=torch.bool)
    active_mask[20:30] = True
    catalytic = [20, 22, 24]

    ddg_f = scorer.compute_ddg_fold(x, mut_coords, edge_index, h)
    ddg_b = scorer.compute_ddg_binding(x, mut_coords, active_mask)
    ddg_c = scorer.compute_catalysis_effect(mut_coords, catalytic)
    fitness = scorer.compute_fitness_score(ddg_f, ddg_c, ddg_b)
    print(f"[OK] MutationScorer  ddG_fold={ddg_f:.4f}  "
          f"ddG_bind={ddg_b:.4f}  catalysis={ddg_c:.4f}  fitness={fitness:.4f}")

    # 6. Weights loader (no file → Xavier init)
    load_pretrained_egnn(scorer)
    print("[OK] load_pretrained_egnn (Xavier fallback)")

    print("\n=== All smoke-tests passed ===")


if __name__ == "__main__":
    _demo()
