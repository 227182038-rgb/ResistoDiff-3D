"""
ESM-Style Protein-Ligand Binding Scorer.

Implements a lightweight, CPU-only protein language model inspired by
ESM-2 (Lin et al., 2023) combined with RDKit-derived ligand descriptors
to produce protein-ligand binding affinity predictions.

Components:
    - ESMProteinEncoder : tiny transformer encoder for amino-acid sequences
    - LigandDescriptorEncoder : MLP over RDKit physicochemical descriptors
    - InteractionScorer  : cross-attention protein↔ligand + binding head
    - ESMBindingScorer  : end-to-end convenience wrapper

References:
    - Lin et al., "Evolutionary Scale Prediction of Atomic-Level Protein
      Structure with a Language Model", Science 2023
    - Rives et al., "Biological Structure and Function Emerge from
      Scaling Up Language Models", PNAS 2021

All computations are CPU-only.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch import Tensor


# ================================================================== #
#                       Constants & Alphabet                          #
# ================================================================== #

STANDARD_AAS = list("ACDEFGHIKLMNPQRSTVWY")
SPECIAL_TOKENS = ["<pad>", "<bos>", "<eos>", "<mask>", "<unk>"]

# Token → index mapping
AA_VOCAB = SPECIAL_TOKENS + STANDARD_AAS            # 25 tokens
TOKEN2IDX: Dict[str, int] = {tok: i for i, tok in enumerate(AA_VOCAB)}
IDX2TOKEN: Dict[int, str] = {i: tok for tok, i in TOKEN2IDX.items()}

# RDKit descriptor names used as ligand features
LIGAND_DESCRIPTOR_NAMES: List[str] = [
    "MolWt", "MolLogP", "TPSA", "NumHDonors", "NumHAcceptors",
    "NumRotatableBonds", "NumAromaticRings", "NumAliphaticRings",
    "FractionCSP3", "HeavyAtomCount", "RingCount", "NumValenceElectrons",
]
NUM_LIGAND_FEATURES = len(LIGAND_DESCRIPTOR_NAMES)


# ================================================================== #
#                       Data Containers                                #
# ================================================================== #


@dataclass
class ESMScoreResult:
    """Output of the ESM binding scorer."""
    binding_score: float       # predicted pIC50 (-log10 IC50 in M)
    protein_embedding: np.ndarray  # (hidden_dim,) pooled protein repr
    ligand_embedding: np.ndarray   # (hidden_dim,) ligand repr
    attention_weights: np.ndarray  # (seq_len, 1) cross-attn importance


# ================================================================== #
#                      ESMProteinEncoder                             #
# ================================================================== #


class ESMProteinEncoder(nn.Module):
    """Lightweight ESM-style protein sequence encoder.

    Architecture (all CPU):
        - Token embedding (25 vocab) + learned positional embedding
        - 4-layer TransformerEncoder  (hidden=128, heads=4, FFN=512)
        - Mean-pool → fixed-size protein embedding
    """

    def __init__(
        self,
        vocab_size: int = 25,
        hidden_dim: int = 128,
        num_layers: int = 4,
        num_heads: int = 4,
        max_seq_len: int = 1024,
        dropout: float = 0.1,
    ) -> None:
        super().__init__()
        self.hidden_dim = hidden_dim

        self.token_emb = nn.Embedding(vocab_size, hidden_dim, padding_idx=0)
        self.pos_emb = nn.Embedding(max_seq_len, hidden_dim)

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=hidden_dim,
            nhead=num_heads,
            dim_feedforward=hidden_dim * 4,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)

        self.layer_norm = nn.LayerNorm(hidden_dim)
        self._init_weights()

    def _init_weights(self) -> None:
        nn.init.normal_(self.token_emb.weight[1:], std=0.02)  # skip pad
        nn.init.normal_(self.pos_emb.weight, std=0.02)

    def _tokenize(self, sequence: str) -> Tensor:
        """Convert a single-letter AA sequence to token indices."""
        ids = [TOKEN2IDX.get("<bos>")]
        for ch in sequence.upper():
            ids.append(TOKEN2IDX.get(ch, TOKEN2IDX["<unk>"]))
        ids.append(TOKEN2IDX["<eos>"])
        return torch.tensor(ids, dtype=torch.long)

    def forward(self, sequence: str) -> Tuple[Tensor, Tensor]:
        """Encode a protein sequence.

        Returns
        -------
        residues : (L, hidden_dim)  per-residue representations
        pooled   : (hidden_dim,)     mean-pooled over non-padding tokens
        """
        ids = self._tokenize(sequence).unsqueeze(0)       # (1, L)
        L = ids.size(1)
        positions = torch.arange(L, dtype=torch.long).unsqueeze(0)

        x = self.token_emb(ids) + self.pos_emb(positions)  # (1, L, D)
        x = self.transformer(x)                             # (1, L, D)
        x = self.layer_norm(x)

        residues = x.squeeze(0)                             # (L, D)
        # Mean-pool over non-pad tokens
        pad_mask = (ids.squeeze(0) != 0).float()           # (L,)
        pooled = (residues * pad_mask.unsqueeze(-1)).sum(0) / pad_mask.sum().clamp(min=1)
        return residues, pooled                             # (L, D), (D,)


# ================================================================== #
#                    LigandDescriptorEncoder                          #
# ================================================================== #


class LigandDescriptorEncoder(nn.Module):
    """Compute RDKit descriptors and project them via an MLP."""

    def __init__(self, in_dim: int = NUM_LIGAND_FEATURES, hidden_dim: int = 128) -> None:
        super().__init__()
        self.mlp = nn.Sequential(
            nn.Linear(in_dim, hidden_dim),
            nn.SiLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
        )
        self._init_weights()

    def _init_weights(self) -> None:
        for m in self.mlp.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

    @staticmethod
    def compute_descriptors(smiles: str) -> np.ndarray:
        """Extract a fixed-size descriptor vector from a SMILES string.

        Falls back to a zero vector if RDKit cannot parse the SMILES.
        """
        from rdkit import Chem
        from rdkit.Chem import Descriptors

        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return np.zeros(NUM_LIGAND_FEATURES, dtype=np.float32)

        vals: List[float] = []
        for name in LIGAND_DESCRIPTOR_NAMES:
            fn = getattr(Descriptors, name, None)
            vals.append(fn(mol) if fn else 0.0)
        arr = np.array(vals, dtype=np.float32)
        # Clamp extreme values for numerical stability
        return np.clip(arr, -50.0, 50.0)

    def forward(self, smiles: str) -> Tensor:
        """Encode a ligand SMILES into a fixed-size embedding."""
        desc = self.compute_descriptors(smiles)
        desc_t = torch.from_numpy(desc).unsqueeze(0)  # (1, D)
        return self.mlp(desc_t).squeeze(0)             # (hidden_dim,)


# ================================================================== #
#                       InteractionScorer                             #
# ================================================================== #


class InteractionScorer(nn.Module):
    """Score protein-ligand binding via cross-attention + MLP head.

    Protein residues attend to the ligand embedding; the attention
    weights serve as per-residue importance scores.
    """

    def __init__(self, hidden_dim: int = 128, num_heads: int = 4) -> None:
        super().__init__()
        self.hidden_dim = hidden_dim
        self.num_heads = num_heads

        # Cross-attention: protein residues (query) attend to ligand (key/value)
        self.cross_attn = nn.MultiheadAttention(
            embed_dim=hidden_dim, num_heads=num_heads, batch_first=True, dropout=0.1
        )

        # Combine attended protein context with ligand embedding
        self.head = nn.Sequential(
            nn.Linear(hidden_dim * 2, hidden_dim),
            nn.GELU(),
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.GELU(),
            nn.Linear(hidden_dim // 2, 1),
        )
        self._init_weights()

    def _init_weights(self) -> None:
        for m in self.head.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

    def forward(
        self,
        protein_residues: Tensor,
        protein_pooled: Tensor,
        ligand_emb: Tensor,
    ) -> Tuple[Tensor, Tensor]:
        """Compute binding score.

        Parameters
        ----------
        protein_residues : (L, D)
        protein_pooled   : (D,)
        ligand_emb       : (D,)

        Returns
        -------
        score : scalar Tensor
        attn_weights : (L, num_heads) attention map
        """
        D = self.hidden_dim
        res = protein_residues.unsqueeze(0)                  # (1, L, D)
        lig = ligand_emb.unsqueeze(0).unsqueeze(0)           # (1, 1, D)

        attended, attn_weights = self.cross_attn(
            query=res, key=lig, value=lig, need_weights=True
        )                                                   # (1, L, D), (1, L, 1)

        # Combine: mean-pool attended residues + ligand
        context = attended.squeeze(0).mean(dim=0)           # (D,)
        combined = torch.cat([context, ligand_emb], dim=-1) # (2D,)
        score = self.head(combined).squeeze(-1)              # scalar
        return score, attn_weights.squeeze(0).detach()      # (L, H)


# ================================================================== #
#                     ESMBindingScorer (wrapper)                      #
# ================================================================== #


class ESMBindingScorer:
    """End-to-end protein-ligand binding scorer.

    Uses the lightweight ESM encoder + RDKit ligand descriptors +
    cross-attention interaction module to predict binding affinity.

    Parameters
    ----------
    hidden_dim : int
        Internal hidden size (default 128).
    weights_path : str or None
        Path to ``.pt`` checkpoint.  If *None*, the model is
        Xavier-initialised (untrained).
    """

    def __init__(
        self,
        hidden_dim: int = 128,
        weights_path: Optional[str] = None,
    ) -> None:
        self.protein_encoder = ESMProteinEncoder(hidden_dim=hidden_dim)
        self.ligand_encoder = LigandDescriptorEncoder(hidden_dim=hidden_dim)
        self.interaction_scorer = InteractionScorer(hidden_dim=hidden_dim)

        self._load_weights(weights_path)
        self.protein_encoder.eval()
        self.ligand_encoder.eval()
        self.interaction_scorer.eval()

    def _load_weights(self, path: Optional[str]) -> None:
        """Load weights or fall back to Xavier init."""
        if path is not None:
            from pathlib import Path
            p = Path(path)
            if p.exists():
                state = torch.load(str(p), map_location="cpu", weights_only=True)
                self.protein_encoder.load_state_dict(state.get("protein", {}), strict=False)
                self.ligand_encoder.load_state_dict(state.get("ligand", {}), strict=False)
                self.interaction_scorer.load_state_dict(state.get("interaction", {}), strict=False)
                print(f"[ESMScorer] Loaded weights from {p}")
                return
        print("[ESMScorer] No weights path; using Xavier initialisation.")

    @torch.no_grad()
    def score(self, protein_sequence: str, ligand_smiles: str) -> ESMScoreResult:
        """Score a single protein–ligand pair.

        Parameters
        ----------
        protein_sequence : str
            One-letter amino-acid sequence (e.g. ``"MKTLLL..."``).
        ligand_smiles : str
            SMILES string of the small molecule.

        Returns
        -------
        ESMScoreResult
        """
        residues, pooled = self.protein_encoder(protein_sequence)
        lig_emb = self.ligand_encoder(ligand_smiles)
        score, attn = self.interaction_scorer(residues, pooled, lig_emb)

        # Map raw logit → plausible pIC50 range [3, 12]
        pic50 = 3.0 + 9.0 * torch.sigmoid(score).item()

        return ESMScoreResult(
            binding_score=pic50,
            protein_embedding=pooled.numpy(),
            ligand_embedding=lig_emb.numpy(),
            attention_weights=attn.numpy(),
        )

    @torch.no_grad()
    def score_batch(
        self,
        protein_sequence: str,
        ligand_smiles_list: List[str],
    ) -> List[ESMScoreResult]:
        """Score one protein against multiple ligands (shared protein encoding)."""
        residues, pooled = self.protein_encoder(protein_sequence)
        results: List[ESMScoreResult] = []
        for smi in ligand_smiles_list:
            lig_emb = self.ligand_encoder(smi)
            score, attn = self.interaction_scorer(residues, pooled, lig_emb)
            pic50 = 3.0 + 9.0 * torch.sigmoid(score).item()
            results.append(ESMScoreResult(
                binding_score=pic50,
                protein_embedding=pooled.numpy(),
                ligand_embedding=lig_emb.numpy(),
                attention_weights=attn.numpy(),
            ))
        return results

    @torch.no_grad()
    def rank_ligands(
        self,
        protein_sequence: str,
        ligand_smiles_list: List[str],
        top_k: int = 5,
    ) -> List[Tuple[str, float]]:
        """Rank ligands by predicted binding affinity (descending pIC50)."""
        results = self.score_batch(protein_sequence, ligand_smiles_list)
        ranked = sorted(
            zip(ligand_smiles_list, [r.binding_score for r in results]),
            key=lambda x: x[1],
            reverse=True,
        )
        return ranked[:top_k]


# ================================================================== #
#                        Smoke test / Demo                            #
# ================================================================== #


def _demo() -> None:
    torch.manual_seed(42)

    # 1. Protein encoder
    encoder = ESMProteinEncoder(hidden_dim=64, num_layers=2, num_heads=2)
    seq = "MKFLILLFNILCLFPVLAADNHGVSLHVKAFDALQKAGDVDIMIREILK"
    residues, pooled = encoder(seq)
    L = len(seq) + 2  # BOS + EOS
    assert residues.shape == (L, 64), f"Got {residues.shape}"
    assert pooled.shape == (64,)
    print(f"[OK] ESMProteinEncoder  residues={residues.shape}  pooled={pooled.shape}")

    # 2. Ligand encoder
    lig_enc = LigandDescriptorEncoder(hidden_dim=64)
    smiles = "CC(=O)Oc1ccccc1C(=O)O"  # aspirin
    lig_emb = lig_enc(smiles)
    assert lig_emb.shape == (64,)
    desc = LigandDescriptorEncoder.compute_descriptors(smiles)
    assert desc.shape == (NUM_LIGAND_FEATURES,)
    print(f"[OK] LigandDescriptorEncoder  emb={lig_emb.shape}  desc={desc.shape}")

    # 3. Interaction scorer
    scorer = InteractionScorer(hidden_dim=64, num_heads=2)
    score, attn = scorer(residues, pooled, lig_emb)
    assert score.ndim == 0, f"Expected scalar, got {score.shape}"
    assert attn.shape[0] == L
    print(f"[OK] InteractionScorer  score={score.item():.4f}  attn={attn.shape}")

    # 4. Full ESMBindingScorer
    full_scorer = ESMBindingScorer(hidden_dim=64)
    result = full_scorer.score(seq, smiles)
    assert 3.0 <= result.binding_score <= 12.0
    assert result.protein_embedding.shape == (64,)
    assert result.ligand_embedding.shape == (64,)
    print(f"[OK] ESMBindingScorer  pIC50={result.binding_score:.2f}")

    # 5. Batch & rank
    ligands = [
        "CC(=O)Oc1ccccc1C(=O)O",     # aspirin
        "CC(C)Cc1ccc(cc1)C(C)C(=O)O", # ibuprofen
        "CN1C=NC2=C1C(=O)N(C(=O)N2C)C", # caffeine
        "c1ccc2c(c1)ccc3c2ccc4c3cccc4",  # pyrene
    ]
    ranked = full_scorer.rank_ligands(seq, ligands, top_k=3)
    print(f"[OK] rank_ligands  top-3:")
    for smi, sc in ranked:
        print(f"      pIC50={sc:.2f}  {smi}")

    print("\n=== All esm_scorer smoke-tests passed ===")


if __name__ == "__main__":
    _demo()
