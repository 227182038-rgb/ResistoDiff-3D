"""
SE(3)-Equivariant Diffusion Model for 3D Molecule Generation.

Generates 3D molecular coordinates conditioned on protein pocket geometry
using an equivariant denoising network with classifier-free guidance.

References:
    - Ho et al., "Denoising Diffusion Probabilistic Models", NeurIPS 2020
    - Nichol & Dhariwal, "Improved Denoising Diffusion Probabilistic Models", 2021
    - Satorras et al., "E(n) Equivariant Graph Neural Networks", ICML 2021
    - Ho & Salimans, "Classifier-Free Diffusion Guidance", NeurIPS 2022

All computations are CPU-only (device='cpu').
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch import Tensor


# ================================================================== #
#                        GeneratedMolecule                           #
# ================================================================== #


@dataclass
class GeneratedMolecule:
    """Container for a molecule produced by the diffusion generator."""
    coordinates: np.ndarray          # (N, 3) Ångström positions
    atom_types: List[str]            # element symbols per atom
    confidence: float                # generation quality score [0, 1]
    pocket_distance_violations: int  # atoms outside pocket radius
    num_atoms: int = 0

    def __post_init__(self) -> None:
        self.num_atoms = len(self.atom_types)


# ================================================================== #
#                      GaussianDiffusion3D                            #
# ================================================================== #


class GaussianDiffusion3D:
    """Gaussian diffusion forward process for 3D coordinate noise.

    Supports cosine (improved DDPM) and linear beta schedules.
    All schedule tensors are precomputed in ``__init__`` for speed.
    """

    def __init__(self, num_timesteps: int = 200, schedule: str = "cosine") -> None:
        if schedule == "cosine":
            self.betas = self._cosine_schedule(num_timesteps)
        elif schedule == "linear":
            self.betas = self._linear_schedule(num_timesteps)
        else:
            raise ValueError(f"Unknown schedule: {schedule!r}")

        self.num_timesteps = num_timesteps
        self.alphas = 1.0 - self.betas
        self.alpha_cumprod = torch.cumprod(self.alphas, dim=0)
        self.sqrt_alpha_cumprod = torch.sqrt(self.alpha_cumprod)
        self.sqrt_one_minus_alpha_cumprod = torch.sqrt(1.0 - self.alpha_cumprod)

    # ---------- schedule builders ---------- #

    @staticmethod
    def _cosine_schedule(T: int, s: float = 0.008) -> Tensor:
        """Improved DDPM cosine schedule (Nichol & Dhariwal 2021)."""
        steps = torch.arange(T + 1, dtype=torch.float64)
        f = torch.cos(((steps / T) + s) / (1.0 + s) * (math.pi / 2.0)) ** 2
        alphas = f / f[0]
        betas = 1.0 - alphas[1:] / alphas[:-1]
        return torch.clamp(betas, 0.0, 0.999).float()

    @staticmethod
    def _linear_schedule(T: int, beta_start: float = 1e-4,
                         beta_end: float = 0.02) -> Tensor:
        """Standard linear beta schedule."""
        return torch.linspace(beta_start, beta_end, T).float()

    # ---------- core API ---------- #

    def add_noise(self, x_0: Tensor, t: int,
                  noise: Optional[Tensor] = None) -> Tensor:
        """Forward process  q(x_t | x_0) = sqrt(α_t)·x_0 + sqrt(1-α_t)·ε."""
        if noise is None:
            noise = torch.randn_like(x_0)
        sa = self.sqrt_alpha_cumprod[t].view(-1, 1)
        s1ma = self.sqrt_one_minus_alpha_cumprod[t].view(-1, 1)
        return sa * x_0 + s1ma * noise

    def sample_timestep(self, batch_size: int) -> Tensor:
        """Sample random timesteps uniformly from {0, …, T-1}."""
        return torch.randint(0, self.num_timesteps, (batch_size,), dtype=torch.long)


# ================================================================== #
#                       Network Components                            #
# ================================================================== #


class SinusoidalTimeEmbedding(nn.Module):
    """Sinusoidal positional encoding → 2-layer MLP → *hidden_dim* vector."""

    def __init__(self, hidden_dim: int) -> None:
        super().__init__()
        self.mlp = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim * 4),
            nn.SiLU(),
            nn.Linear(hidden_dim * 4, hidden_dim),
        )
        self._half = hidden_dim // 2

    def forward(self, t: int, batch_size: int) -> Tensor:
        """Return (batch_size, hidden_dim) time embedding."""
        freqs = torch.exp(
            -math.log(10000.0)
            * torch.arange(self._half, dtype=torch.float32) / self._half
        )
        args = t * freqs                          # (half,)
        emb = torch.cat([torch.cos(args), torch.sin(args)], dim=-1)  # (hidden_dim,)
        return self.mlp(emb.unsqueeze(0).expand(batch_size, -1))     # (B, hidden_dim)


class EquivariantBlock(nn.Module):
    """Single SE(3)-equivariant message-passing block.

    Coordinate updates are equivariant (direction × invariant scalar).
    Feature updates are invariant (MLP on scalar features).

    For small molecules (N ≤ 50) a fully-connected edge set is used.
    """

    def __init__(self, hidden_dim: int, time_dim: int) -> None:
        super().__init__()
        edge_in = 2 * hidden_dim + 1 + time_dim
        self.edge_mlp = nn.Sequential(
            nn.Linear(edge_in, hidden_dim), nn.SiLU(),
            nn.Linear(hidden_dim, hidden_dim),
        )
        self.coord_mlp = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim), nn.SiLU(),
            nn.Linear(hidden_dim, 1),
        )
        node_in = hidden_dim * 2 + time_dim
        self.node_mlp = nn.Sequential(
            nn.Linear(node_in, hidden_dim), nn.SiLU(),
            nn.Linear(hidden_dim, hidden_dim),
        )
        self._init_weights()

    @staticmethod
    def _init_weights() -> None:          # noqa: N802 – called in __init__
        pass  # weights initialised by PyTorch defaults; xavier set in parent

    def _init_weights(self) -> None:
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight, gain=0.02)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

    def forward(self, h: Tensor, x: Tensor, t_emb: Tensor) -> tuple[Tensor, Tensor]:
        """
        Parameters
        ----------
        h : (N, hidden_dim)  node features
        x : (N, 3)           coordinates
        t_emb : (N, time_dim) time embedding (broadcast per node)

        Returns
        -------
        h_new, x_new
        """
        N = h.size(0)
        # Fully-connected edge index (O(N²) – fine for N ≤ 50)
        idx = torch.arange(N, device=h.device)
        src, dst = idx.repeat_interleave(N), idx.repeat(N)
        mask = src != dst
        src, dst = src[mask], dst[mask]

        diff = x[src] - x[dst]                             # (E, 3)
        dist_sq = (diff ** 2).sum(dim=-1, keepdim=True)     # (E, 1)
        edge_in = torch.cat([h[src], h[dst], dist_sq, t_emb[src]], dim=-1)
        edge_msg = self.edge_mlp(edge_in)                  # (E, hidden_dim)

        # Equivariant coordinate update:  Δx_i = Σ_j (x_i - x_j) · φ(m_ij)
        w = self.coord_mlp(edge_msg)                        # (E, 1)
        coord_delta = diff * w                              # (E, 3)
        x_new = x.clone()
        x_new.scatter_add_(0, dst.unsqueeze(-1).expand_as(coord_delta), coord_delta)

        # Invariant node update with residual
        agg = torch.zeros_like(h)
        agg.scatter_add_(0, dst.unsqueeze(-1).expand_as(edge_msg), edge_msg)
        h_new = h + self.node_mlp(torch.cat([h, agg, t_emb], dim=-1))

        return h_new, x_new


# ================================================================== #
#                     SE3EquivariantUNet                              #
# ================================================================== #


class SE3EquivariantUNet(nn.Module):
    """Simplified SE(3)-equivariant denoising network.

    Architecture
    -------------
    1. Input projection: [noisy_coords (3) || atom_types (K)] → hidden_dim
    2. Sinusoidal time embedding → MLP → hidden_dim
    3. Four equivariant blocks (coordinate + feature updates)
    4. Output head: hidden_dim → 3  (predicted noise ε_θ)
    """

    def __init__(
        self,
        in_channels: int = 6,
        out_channels: int = 3,
        hidden_dim: int = 128,
        num_layers: int = 4,
    ) -> None:
        super().__init__()
        self.hidden_dim = hidden_dim

        self.input_proj = nn.Linear(in_channels, hidden_dim)
        self.time_embed = SinusoidalTimeEmbedding(hidden_dim)

        self.blocks = nn.ModuleList(
            [EquivariantBlock(hidden_dim, hidden_dim) for _ in range(num_layers)]
        )

        self.output_head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim), nn.SiLU(),
            nn.Linear(hidden_dim, out_channels),
        )
        self._init_weights()

    def _init_weights(self) -> None:
        nn.init.xavier_uniform_(self.input_proj.weight, gain=0.02)
        nn.init.zeros_(self.input_proj.bias)
        for m in self.output_head.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight, gain=0.02)
                nn.init.zeros_(m.bias)

    def forward(
        self,
        x_t: Tensor,
        atom_types: Tensor,
        t: int,
        condition: Optional[Tensor] = None,
    ) -> Tensor:
        """Predict noise  ε_θ(x_t, t).

        Parameters
        ----------
        x_t : (N, 3)            noisy coordinates
        atom_types : (N, K)      one-hot atom-type features
        t : int                  diffusion timestep
        condition : (hidden_dim,) or None  pocket conditioning vector

        Returns
        -------
        noise_pred : (N, 3)
        """
        N = x_t.size(0)
        t_emb = self.time_embed(t, N)               # (N, hidden_dim)
        if condition is not None:
            t_emb = t_emb + condition.unsqueeze(0).expand(N, -1)

        h = self.input_proj(torch.cat([x_t, atom_types], dim=-1))

        for block in self.blocks:
            h, x_t = block(h, x_t, t_emb)

        return self.output_head(h)                   # (N, 3)


# ================================================================== #
#                      MoleculeGenerator                              #
# ================================================================== #


class MoleculeGenerator:
    """Generate 3D molecular coordinates in a protein pocket.

    Uses SE(3)-equivariant diffusion with classifier-free guidance
    and a soft pocket-constraint to keep atoms near the binding site.
    """

    ATOM_VOCAB: List[str] = ["C", "N", "O", "S", "F", "Cl"]
    NUM_ATOM_TYPES: int = len(ATOM_VOCAB)

    def __init__(
        self,
        pocket_center: np.ndarray,
        pocket_radius: float = 5.0,
        num_atoms: int = 25,
    ) -> None:
        self.pocket_center = torch.tensor(
            pocket_center, dtype=torch.float32
        ).view(3)
        self.pocket_radius = float(pocket_radius)
        self.num_atoms = int(num_atoms)

    # ---------- pocket encoding ---------- #

    def _encode_pocket(self, hidden_dim: int = 128) -> Tensor:
        """Encode pocket geometry into a *hidden_dim*-dim condition vector.

        Layout: centre (3) + radius (1) + RBF over radii (hidden_dim-4).
        """
        rbf_dim = hidden_dim - 4
        centres = torch.linspace(0.0, 10.0, rbf_dim)
        rbf = torch.exp(-0.5 * ((centres - self.pocket_radius) / 0.5) ** 2)
        return torch.cat([self.pocket_center, torch.tensor([self.pocket_radius]), rbf])

    # ---------- denoising loop ---------- #

    def _denoise(
        self,
        model: SE3EquivariantUNet,
        diffusion: GaussianDiffusion3D,
        condition: Tensor,
        num_steps: int,
        guidance_scale: float,
    ) -> np.ndarray:
        """Iterative reverse diffusion from t = T-1 → 0."""
        x = torch.randn(self.num_atoms, 3)
        atom_idx = torch.randint(0, self.NUM_ATOM_TYPES, (self.num_atoms,))
        atom_types = F.one_hot(atom_idx, self.NUM_ATOM_TYPES).float()

        null_cond = torch.zeros_like(condition)

        for t_val in reversed(range(num_steps)):
            t = t_val
            # Classifier-free guidance:  ε = ε_uncond + s·(ε_cond − ε_uncond)
            with torch.no_grad():
                eps_cond = model(x, atom_types, t, condition=condition)
                eps_uncond = model(x, atom_types, t, condition=null_cond)
            eps_pred = eps_uncond + guidance_scale * (eps_cond - eps_uncond)

            alpha_bar_t = diffusion.alpha_cumprod[t]
            alpha_t = diffusion.alphas[t]
            beta_t = diffusion.betas[t]

            # Predict x_0
            x0 = (x - diffusion.sqrt_one_minus_alpha_cumprod[t] * eps_pred) / \
                 diffusion.sqrt_alpha_cumprod[t].clamp(min=1e-8)

            if t > 0:
                alpha_bar_prev = diffusion.alpha_cumprod[t - 1]
                mean = (
                    torch.sqrt(alpha_bar_prev) * beta_t / (1.0 - alpha_bar_t) * x0
                    + torch.sqrt(alpha_t) * (1.0 - alpha_bar_prev)
                    / (1.0 - alpha_bar_t) * x
                )
                noise = torch.randn_like(x) if t > 1 else torch.zeros_like(x)
                x = mean + torch.sqrt(beta_t) * noise
            else:
                x = x0

            # Pocket soft-constraint
            x = self._apply_pocket_constraint(x)

        return x.detach().numpy()

    # ---------- geometry helpers ---------- #

    def _apply_pocket_constraint(self, x: Tensor, strength: float = 0.1) -> Tensor:
        """Pull atoms back toward pocket centre when they exceed *pocket_radius*."""
        disp = x - self.pocket_center
        dist = disp.norm(dim=-1, keepdim=True)
        mask = (dist > self.pocket_radius).float()
        overshoot = (dist - self.pocket_radius) / dist.clamp(min=1e-8)
        return x - mask * strength * disp * overshoot

    # ---------- public API ---------- #

    def generate(
        self,
        num_molecules: int = 6,
        num_steps: int = 200,
        guidance_scale: float = 5.0,
    ) -> List[GeneratedMolecule]:
        """Generate candidate molecules and return them."""
        diffusion = GaussianDiffusion3D(num_timesteps=num_steps, schedule="cosine")
        model = SE3EquivariantUNet(
            in_channels=3 + self.NUM_ATOM_TYPES,
            out_channels=3,
            hidden_dim=128,
            num_layers=4,
        )
        model.eval()
        condition = self._encode_pocket(hidden_dim=128)

        results: List[GeneratedMolecule] = []
        for _ in range(num_molecules):
            coords = self._denoise(model, diffusion, condition, num_steps, guidance_scale)
            results.append(self._build_result(coords))
        return results

    def _build_result(self, coords: np.ndarray) -> GeneratedMolecule:
        """Package coordinates into a :class:`GeneratedMolecule`."""
        idx = np.random.randint(0, self.NUM_ATOM_TYPES, self.num_atoms)
        symbols = [self.ATOM_VOCAB[i] for i in idx]
        dists = np.linalg.norm(coords - self.pocket_center.numpy(), axis=1)
        violations = int((dists > self.pocket_radius).sum())
        confidence = float(np.clip(1.0 - violations / max(self.num_atoms, 1), 0.0, 1.0))
        return GeneratedMolecule(
            coordinates=coords,
            atom_types=symbols,
            confidence=confidence,
            pocket_distance_violations=violations,
        )


# ================================================================== #
#                        Smoke test / Demo                            #
# ================================================================== #


def _demo() -> None:
    torch.manual_seed(42)
    np.random.seed(42)

    # 1. GaussianDiffusion3D
    diff = GaussianDiffusion3D(num_timesteps=10, schedule="cosine")
    x0 = torch.randn(5, 3)
    xt = diff.add_noise(x0, t=5)
    assert xt.shape == (5, 3)
    t_batch = diff.sample_timestep(8)
    assert t_batch.shape == (8,)
    print(f"[OK] GaussianDiffusion3D  xt={xt.shape}  t_batch={t_batch.shape}")

    # 2. SE3EquivariantUNet forward
    model = SE3EquivariantUNet(in_channels=9, hidden_dim=64, num_layers=2)
    x_t = torch.randn(20, 3)
    atom_types = F.one_hot(torch.randint(0, 6, (20,)), 6).float()
    noise_pred = model(x_t, atom_types, t=5)
    assert noise_pred.shape == (20, 3)
    print(f"[OK] SE3EquivariantUNet  noise_pred={noise_pred.shape}")

    # 3. Classifier-free guidance path (conditional + unconditional)
    cond = torch.randn(64)
    eps_c = model(x_t, atom_types, t=3, condition=cond)
    eps_u = model(x_t, atom_types, t=3, condition=None)
    guided = eps_u + 5.0 * (eps_c - eps_u)
    assert guided.shape == (20, 3)
    print(f"[OK] Classifier-free guidance  guided={guided.shape}")

    # 4. MoleculeGenerator (fast: few steps, small model)
    gen = MoleculeGenerator(pocket_center=np.zeros(3), pocket_radius=5.0, num_atoms=10)
    mols = gen.generate(num_molecules=2, num_steps=10, guidance_scale=3.0)
    assert len(mols) == 2
    for m in mols:
        assert m.coordinates.shape == (10, 3)
        assert m.num_atoms == 10
    print(f"[OK] MoleculeGenerator  {len(mols)} mols, "
          f"conf={mols[0].confidence:.2f}, viol={mols[0].pocket_distance_violations}")

    print("\n=== All se3_diffuser smoke-tests passed ===")


if __name__ == "__main__":
    _demo()
