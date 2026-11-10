"""Geometric pocket detection for ResistoDiff-3D.

Grid-based algorithm that identifies protein surface pockets by finding
buried void regions, clustering them, and scoring for druggability.
Uses only numpy, scipy, and the standard library.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy import ndimage
from scipy.spatial import ConvexHull


# ======================================================================
# Data classes
# ======================================================================


@dataclass
class PocketResult:
    """A single detected pocket with geometric and chemical descriptors."""

    pocket_id: int
    center: tuple[float, float, float]
    volume: float
    surface_area: float
    depth: float
    druggability: float
    residues: list[str]
    pocket_type: str  # 'active-site', 'allosteric', or 'cryptic'
    conservation_score: float


# ======================================================================
# Helper functions
# ======================================================================

_HYDROPHOBIC_RESIDUES: set[str] = {"ALA", "VAL", "ILE", "LEU", "MET", "PHE", "TRP", "PRO"}


def is_hydrophobic(residue_name: str) -> bool:
    """Return True if *residue_name* (3-letter code) is hydrophobic."""
    return residue_name.strip().upper() in _HYDROPHOBIC_RESIDUES


def get_vdw_radii() -> dict[str, float]:
    """Standard van der Waals radii (Å) for the 20 canonical amino-acid side chains.

    Values represent an effective CA-centred radius for grid-based detection.
    """
    return {
        "ALA": 3.1, "ARG": 4.0, "ASN": 3.4, "ASP": 3.4, "CYS": 3.5,
        "GLN": 3.7, "GLU": 3.7, "GLY": 2.6, "HIS": 3.6, "ILE": 3.8,
        "LEU": 3.8, "LYS": 3.8, "MET": 4.0, "PHE": 4.2, "PRO": 3.4,
        "SER": 3.1, "THR": 3.3, "TRP": 4.5, "TYR": 4.3, "VAL": 3.5,
    }


# Hardcoded residue-frequency table for common bacteria (E. coli-like).
# Keys are 3-letter codes, values are frequencies summing to ~1.0.
_BACTERIAL_FREQ: dict[str, float] = {
    "ALA": 0.083, "ARG": 0.054, "ASN": 0.044, "ASP": 0.053, "CYS": 0.011,
    "GLN": 0.039, "GLU": 0.057, "GLY": 0.075, "HIS": 0.022, "ILE": 0.053,
    "LEU": 0.092, "LYS": 0.058, "MET": 0.024, "PHE": 0.040, "PRO": 0.046,
    "SER": 0.068, "THR": 0.058, "TRP": 0.013, "TYR": 0.032, "VAL": 0.067,
}


def compute_conservation(residue_ids: list[str]) -> float:
    r"""Shannon-entropy-based conservation score for a set of residues.

    Uses a hardcoded bacterial frequency table.  Score ranges 0 (fully random)
    to 1 (perfectly conserved at the most-probable residue).
    """
    if not residue_ids:
        return 0.0
    # Extract residue names from strings like "A:42:ALA"
    names = [rid.split(":")[-1].strip().upper() for rid in residue_ids]
    # Build observed frequency
    counts: dict[str, int] = {}
    for n in names:
        counts[n] = counts.get(n, 0) + 1
    total = len(names)
    observed: dict[str, float] = {k: v / total for k, v in counts.items()}
    # Shannon entropy
    entropy = 0.0
    for freq in observed.values():
        if freq > 0:
            entropy -= freq * math.log2(freq)
    # Maximum possible entropy for 20 amino acids
    h_max = math.log2(20)
    # Normalised: 0 = maximally diverse, 1 = single residue type
    diversity = entropy / h_max if h_max > 0 else 0.0
    conservation = 1.0 - diversity
    # Boost if the dominant residue matches the most common bacterial residue
    dominant = max(observed, key=observed.get)
    bacterial_dominant = max(_BACTERIAL_FREQ, key=_BACTERIAL_FREQ.get)
    if dominant == bacterial_dominant and observed[dominant] > 0.5:
        conservation = min(1.0, conservation + 0.15)
    return float(np.clip(conservation, 0.0, 1.0))


def _sigmoid(x: float) -> float:
    """Numerically stable sigmoid."""
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    ex = math.exp(x)
    return ex / (1.0 + ex)


# ======================================================================
# PocketDetector
# ======================================================================


class PocketDetector:
    """Grid-based geometric pocket detector.

    Algorithm:
    1. Build a 3D grid around the protein.
    2. Mark grid points that are inside protein atoms as *buried*.
    3. Find *void* points: not inside any atom but surrounded by atoms
       on at least 3 orthogonal faces (±x, ±y, ±z).
    4. Cluster connected void points (6-connectivity) via ``scipy.ndimage.label``.
    5. Score each cluster for druggability.
    """

    def __init__(
        self,
        probe_radius: float = 1.4,
        min_volume: float = 50.0,
        grid_spacing: float = 0.5,
    ) -> None:
        self.probe_radius = float(probe_radius)
        self.min_volume = float(min_volume)
        self.grid_spacing = float(grid_spacing)
        self._vdw = get_vdw_radii()

    def detect_pockets(
        self,
        positions: np.ndarray,
        radii: np.ndarray,
        residue_ids: list[str],
    ) -> list[PocketResult]:
        """Detect pockets in a protein structure.

        Args:
            positions:   (N, 3) atom coordinates in Å.
            radii:       (N,) effective atomic radii in Å.
            residue_ids: list of length N with residue identifiers
                         (e.g. ``"A:42:ALA"``).

        Returns:
            List of :class:`PocketResult` sorted by druggability descending.
        """
        positions = np.asarray(positions, dtype=np.float64)
        radii = np.asarray(radii, dtype=np.float64)
        n_atoms = len(positions)
        if n_atoms == 0:
            return []

        # ---- 1. Build grid ----
        margin = 5.0
        origin = positions.min(axis=0) - margin
        extent = positions.max(axis=0) - origin + 2.0 * margin
        grid_shape = np.ceil(extent / self.grid_spacing).astype(int) + 1

        # ---- 2. Find buried grid points (inside any atom + probe) ----
        gx, gy, gz = (
            np.arange(s) * self.grid_spacing + origin[d]
            for d, s in enumerate(grid_shape)
        )
        buried = np.zeros(grid_shape, dtype=bool)
        for i in range(n_atoms):
            r = radii[i] + self.probe_radius
            r2 = r * r
            pos = positions[i]
            ix_min = max(0, int(np.floor((pos[0] - r - origin[0]) / self.grid_spacing)))
            ix_max = min(grid_shape[0], int(np.ceil((pos[0] + r - origin[0]) / self.grid_spacing)) + 1)
            iy_min = max(0, int(np.floor((pos[1] - r - origin[1]) / self.grid_spacing)))
            iy_max = min(grid_shape[1], int(np.ceil((pos[1] + r - origin[1]) / self.grid_spacing)) + 1)
            iz_min = max(0, int(np.floor((pos[2] - r - origin[2]) / self.grid_spacing)))
            iz_max = min(grid_shape[2], int(np.ceil((pos[2] + r - origin[2]) / self.grid_spacing)) + 1)

            sub_gx = gx[ix_min:ix_max] - pos[0]
            sub_gy = gy[iy_min:iy_max] - pos[1]
            sub_gz = gz[iz_min:iz_max] - pos[2]

            d2 = sub_gx[:, None, None] ** 2 + sub_gy[None, :, None] ** 2 + sub_gz[None, None, :] ** 2
            buried[ix_min:ix_max, iy_min:iy_max, iz_min:iz_max] |= (d2 < r2)

        # ---- 3. Find void points ----
        # A void point is not buried but has buried neighbours on >=3
        # orthogonal directions.
        void = ~buried
        neighbour_count = np.zeros_like(buried, dtype=np.int32)
        neighbour_count[1:, :, :] += buried[:-1, :, :]
        neighbour_count[:-1, :, :] += buried[1:, :, :]
        neighbour_count[:, 1:, :] += buried[:, :-1, :]
        neighbour_count[:, :-1, :] += buried[:, 1:, :]
        neighbour_count[:, :, 1:] += buried[:, :, :-1]
        neighbour_count[:, :, :-1] += buried[:, :, 1:]
        void_mask = void & (neighbour_count >= 3)

        # ---- 4. Cluster void points ----
        labelled, n_clusters = ndimage.label(void_mask, structure=ndimage.generate_binary_structure(3, 1))

        # ---- 5. Score each cluster ----
        voxel_vol = self.grid_spacing ** 3
        # Precompute per-atom residue names
        res_names = [rid.split(":")[-1].strip().upper() for rid in residue_ids]

        results: list[PocketResult] = []
        for cluster_id in range(1, n_clusters + 1):
            cluster_mask = labelled == cluster_id
            n_voxels = int(cluster_mask.sum())
            volume = n_voxels * voxel_vol
            if volume < self.min_volume:
                continue

            # Void-point coordinates
            vox_coords = np.argwhere(cluster_mask).astype(np.float64) * self.grid_spacing + origin

            # Center of mass of void
            center = tuple(vox_coords.mean(axis=0).tolist())

            # Surface area via convex hull
            try:
                hull = ConvexHull(vox_coords)
                surface_area = float(hull.area)
            except Exception:
                surface_area = 0.0

            # Depth: max distance from pocket center to nearest protein surface atom
            dist_to_center = np.linalg.norm(positions - np.array(center), axis=1)
            nearest_surface_dist = np.min(dist_to_center) if n_atoms > 0 else 0.0
            depth = float(np.max(np.linalg.norm(vox_coords - np.array(center), axis=1)))

            # Surrounding residues (atoms within 5Å of any void point)
            if n_voxels > 5000:
                # Subsample for performance
                idx = np.random.choice(n_voxels, 5000, replace=False)
                sample = vox_coords[idx]
            else:
                sample = vox_coords
            # (N, 1, 3) - (1, S, 3) -> (N, S)
            diffs = positions[:, None, :] - sample[None, :, :]
            dists_to_sample = np.sqrt(np.sum(diffs ** 2, axis=-1))
            nearby_mask = np.any(dists_to_sample < 5.0, axis=1)
            nearby_residues = list(set(residue_ids[i] for i in range(n_atoms) if nearby_mask[i]))
            nearby_names = list(set(res_names[i] for i in range(n_atoms) if nearby_mask[i]))

            # Hydrophobicity fraction
            if nearby_names:
                hydro_frac = sum(1.0 for n in nearby_names if is_hydrophobic(n)) / len(nearby_names)
            else:
                hydro_frac = 0.0

            # Druggability score
            raw_score = 0.02 * volume - 0.01 * depth + 0.5 * hydro_frac
            druggability = _sigmoid(raw_score)

            # Conservation
            conservation = compute_conservation(nearby_residues) if nearby_residues else 0.5

            # Pocket type
            if conservation > 0.7:
                pocket_type = "active-site"
            elif conservation < 0.6:
                pocket_type = "allosteric"
            else:
                pocket_type = "cryptic"

            results.append(PocketResult(
                pocket_id=cluster_id,
                center=center,
                volume=round(volume, 2),
                surface_area=round(surface_area, 2),
                depth=round(depth, 2),
                druggability=round(druggability, 4),
                residues=nearby_residues,
                pocket_type=pocket_type,
                conservation_score=round(conservation, 4),
            ))

        # Sort by druggability descending
        results.sort(key=lambda p: p.druggability, reverse=True)
        return results
