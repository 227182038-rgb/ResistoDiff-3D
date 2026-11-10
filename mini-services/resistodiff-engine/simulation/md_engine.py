"""Molecular dynamics simulation engine for ResistoDiff-3D.

Lightweight CPU-based MD using NumPy/SciPy with Velocity Verlet integration,
Lennard-Jones + Coulomb potentials, harmonic bonds, and velocity-rescaling
thermostat.  No OpenMM dependency required.
"""
from __future__ import annotations

import numpy as np
from scipy.spatial.distance import pdist, squareform

# Physical constants (reduced units: kcal, mol, Å, ps)
KB = 0.001987  # Boltzmann constant in kcal/(mol·K)


class MolecularSystem:
    """Represents an atomic system with periodic boundary conditions."""

    def __init__(
        self,
        positions: np.ndarray,
        masses: np.ndarray,
        charges: np.ndarray,
        box_size: float = 100.0,
    ) -> None:
        """Initialise the molecular system.

        Args:
            positions: (N, 3) Cartesian coordinates in Å.
            masses:    (N,) atomic masses in amu.
            charges:   (N,) partial charges in elementary-charge units.
            box_size:  Cubic box side length in Å.
        """
        self.positions = np.asarray(positions, dtype=np.float64)
        self.masses = np.asarray(masses, dtype=np.float64)
        self.charges = np.asarray(charges, dtype=np.float64)
        self.box_size = float(box_size)
        self.n_atoms = len(self.masses)
        self.bond_pairs: list[tuple[int, int]] = []
        self._detect_bonds()
        # Force-field parameters
        self.epsilon_lj = 0.1  # kcal/mol
        self.sigma_lj = 3.5  # Å
        self.k_coul = 332.0  # kcal·Å/(mol·e²)
        self.dielectric = 4.0
        self.cutoff = 12.0  # Å
        self.k_bond = 200.0  # kcal/(mol·Å²)
        self.r0_bond = 1.5  # Å
        self.target_temp = 300.0  # K

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _detect_bonds(self, threshold: float = 2.0) -> None:
        """Detect covalent bonds from initial distances < *threshold* Å."""
        dists = squareform(pdist(self.positions))
        np.fill_diagonal(dists, np.inf)
        pairs = np.argwhere((dists > 0.3) & (dists < threshold))
        seen: set[tuple[int, int]] = set()
        for i, j in pairs:
            key = (min(i, j), max(i, j))
            if key not in seen:
                seen.add(key)
                self.bond_pairs.append(key)

    def _minimum_image(self, dr: np.ndarray) -> np.ndarray:
        """Apply minimum image convention for cubic PBC."""
        return dr - self.box_size * np.round(dr / self.box_size)

    def _pairwise_distances(self) -> np.ndarray:
        """Return (N, N, 3) displacement vectors with minimum image."""
        dr = self.positions[np.newaxis, :, :] - self.positions[:, np.newaxis, :]
        return self._minimum_image(dr)

    # ------------------------------------------------------------------
    # Force computation
    # ------------------------------------------------------------------
    def compute_forces(self) -> np.ndarray:
        """Compute total forces (LJ + Coulomb + harmonic bonds) → (N, 3)."""
        forces = np.zeros_like(self.positions)
        dr_all = self._pairwise_distances()  # (N, N, 3)
        r_all = np.sqrt(np.sum(dr_all ** 2, axis=-1))  # (N, N)
        np.fill_diagonal(r_all, np.inf)  # avoid self-interaction

        # Mask for cutoff
        mask = r_all < self.cutoff

        # --- Lennard-Jones ---
        r_safe = np.where(mask, r_all, 1.0)
        inv_r6 = (self.sigma_lj / r_safe) ** 6
        inv_r12 = inv_r6 ** 2
        f_mag_lj = np.where(
            mask, 24.0 * self.epsilon_lj * (2.0 * inv_r12 - inv_r6) / r_safe ** 2, 0.0
        )
        # f_mag_lj is scalar per pair; multiply by dr to get vector
        forces += np.sum(f_mag_lj[:, :, np.newaxis] * dr_all, axis=1)

        # --- Coulomb ---
        f_mag_coul = np.where(
            mask,
            self.k_coul * self.charges[:, np.newaxis] * self.charges[np.newaxis, :] / (self.dielectric * r_safe ** 3),
            0.0,
        )
        forces += np.sum(f_mag_coul[:, :, np.newaxis] * dr_all, axis=1)

        # --- Harmonic bonds ---
        for i, j in self.bond_pairs:
            dr = self._minimum_image(self.positions[i] - self.positions[j])
            r = np.linalg.norm(dr)
            if r < 1e-12:
                continue
            f_vec = -self.k_bond * (r - self.r0_bond) * dr / r
            forces[i] += f_vec
            forces[j] -= f_vec

        return forces

    # ------------------------------------------------------------------
    # Energy
    # ------------------------------------------------------------------
    def compute_potential_energy(self) -> float:
        """Total potential energy (LJ + Coulomb + bonds) in kcal/mol."""
        dr_all = self._pairwise_distances()
        r_all = np.sqrt(np.sum(dr_all ** 2, axis=-1))
        np.fill_diagonal(r_all, np.inf)
        mask = r_all < self.cutoff
        r_safe = np.where(mask, r_all, 1.0)

        inv_r6 = (self.sigma_lj / r_safe) ** 6
        pe_lj = np.sum(np.where(mask, 4.0 * self.epsilon_lj * (inv_r6 ** 2 - inv_r6), 0.0))
        pe_coul = np.sum(
            np.where(
                mask,
                self.k_coul * self.charges[:, np.newaxis] * self.charges[np.newaxis, :] / (self.dielectric * r_safe),
                0.0,
            )
        ) * 0.5
        pe_bond = 0.0
        for i, j in self.bond_pairs:
            dr = self._minimum_image(self.positions[i] - self.positions[j])
            r = np.linalg.norm(dr)
            pe_bond += 0.5 * self.k_bond * (r - self.r0_bond) ** 2
        return float(pe_lj + pe_coul + pe_bond)

    def compute_kinetic_energy(self, velocities: np.ndarray) -> float:
        """KE = 0.5 Σ m_i v_i² in kcal/mol."""
        return float(0.5 * np.sum(self.masses * np.sum(velocities ** 2, axis=1)))

    # ------------------------------------------------------------------
    # Integration
    # ------------------------------------------------------------------
    def step(self, dt: float = 0.002) -> dict:
        """Single Velocity-Verlet step with velocity-rescaling thermostat.

        Returns dict with positions, velocities, forces, energies, temperature.
        """
        if not hasattr(self, "_velocities"):
            self._velocities = np.random.randn(self.n_atoms, 3) * np.sqrt(KB * self.target_temp / self.masses[:, np.newaxis])

        # Half-step velocity
        forces = self.compute_forces()
        acc = forces / self.masses[:, np.newaxis]
        self._velocities += 0.5 * dt * acc

        # Full-step position
        self.positions += dt * self._velocities
        self.positions %= self.box_size  # PBC wrap

        # New forces
        forces_new = self.compute_forces()
        acc_new = forces_new / self.masses[:, np.newaxis]
        self._velocities += 0.5 * dt * acc_new

        # Velocity rescaling thermostat
        ke = self.compute_kinetic_energy(self._velocities)
        current_temp = 2.0 * ke / (3.0 * self.n_atoms * KB) if self.n_atoms > 0 else 0.0
        if current_temp > 1e-12:
            scale = np.sqrt(self.target_temp / current_temp)
            self._velocities *= scale
            ke = self.compute_kinetic_energy(self._velocities)
            current_temp = self.target_temp

        pe = self.compute_potential_energy()
        return {
            "positions": self.positions.copy(),
            "velocities": self._velocities.copy(),
            "forces": forces_new.copy(),
            "potential_energy": pe,
            "kinetic_energy": ke,
            "temperature": current_temp,
        }

    def run(
        self, n_steps: int = 1000, dt: float = 0.002, save_every: int = 10
    ) -> list[dict]:
        """Run *n_steps* of MD, returning saved trajectory frames."""
        trajectory: list[dict] = []
        for step_i in range(n_steps):
            frame = self.step(dt)
            if step_i % save_every == 0:
                frame["step"] = step_i
                trajectory.append(frame)
        return trajectory

    # ------------------------------------------------------------------
    # Analysis
    # ------------------------------------------------------------------
    def get_rmsf(self, trajectory: list[dict]) -> np.ndarray:
        """Per-atom RMSF from trajectory frames."""
        if not trajectory:
            return np.zeros(self.n_atoms)
        frames = np.array([f["positions"] for f in trajectory])  # (T, N, 3)
        mean_pos = frames.mean(axis=0)
        return np.sqrt(np.mean((frames - mean_pos) ** 2, axis=(0, 2)))  # (N,)

    def get_b_factors(self, trajectory: list[dict]) -> np.ndarray:
        r"""B-factors: $B = \frac{8\pi^2}{3} \cdot \mathrm{RMSF}^2$ in Å²."""
        rmsf = self.get_rmsf(trajectory)
        return (8.0 * np.pi ** 2 / 3.0) * rmsf ** 2


# ======================================================================
# SimulationAnalyzer – static analysis utilities
# ======================================================================


class SimulationAnalyzer:
    """Collection of static structural analysis methods."""

    @staticmethod
    def compute_distance_matrix(positions: np.ndarray) -> np.ndarray:
        """Pairwise Euclidean distance matrix (N×N)."""
        return squareform(pdist(np.asarray(positions)))

    @staticmethod
    def find_contacts(positions: np.ndarray, cutoff: float = 4.5) -> list[tuple[int, int]]:
        """Return atom pairs within *cutoff* Å."""
        dmat = squareform(pdist(np.asarray(positions)))
        pairs = np.argwhere((dmat > 0.1) & (dmat < cutoff))
        return [(int(min(i, j)), int(max(i, j))) for i, j in pairs if i < j]

    @staticmethod
    def compute_radius_of_gyration(positions: np.ndarray, masses: np.ndarray) -> float:
        r"""$R_g = \sqrt{\frac{\sum m_i |\mathbf{r}_i - \mathbf{r}_{cm}|^2}{\sum m_i}}$."""
        pos = np.asarray(positions, dtype=np.float64)
        m = np.asarray(masses, dtype=np.float64)
        com = np.average(pos, axis=0, weights=m)
        return float(np.sqrt(np.average(np.sum((pos - com) ** 2, axis=1), weights=m)))

    @staticmethod
    def compute_dihedral(positions: np.ndarray, i: int, j: int, k: int, l: int) -> float:
        """Dihedral angle in degrees for atoms i-j-k-l."""
        pos = np.asarray(positions, dtype=np.float64)
        b1 = pos[j] - pos[i]
        b2 = pos[k] - pos[j]
        b3 = pos[l] - pos[k]
        n1 = np.cross(b1, b2)
        n2 = np.cross(b2, b3)
        m_vec = np.cross(n1, b2 / (np.linalg.norm(b2) + 1e-30))
        x = np.dot(n1, n2)
        y = np.dot(m_vec, n2)
        return float(np.degrees(np.arctan2(y, x)))


# ======================================================================
# ProteinSimulator – convenience wrapper around Bio.PDB
# ======================================================================

# Residue-level properties: mass (amu) and typical CA charge
_RESIDUE_PROPS: dict[str, tuple[float, float]] = {
    "ALA": (71.08, 0.0), "ARG": (156.19, 1.0), "ASN": (114.10, -0.1),
    "ASP": (115.09, -1.0), "CYS": (103.15, 0.0), "GLN": (128.13, -0.1),
    "GLU": (129.12, -1.0), "GLY": (57.05, 0.0), "HIS": (137.14, 0.5),
    "ILE": (113.16, 0.0), "LEU": (113.16, 0.0), "LYS": (128.17, 1.0),
    "MET": (131.19, 0.0), "PHE": (147.18, 0.0), "PRO": (97.12, 0.0),
    "SER": (87.08, 0.0), "THR": (101.10, 0.0), "TRP": (186.21, 0.0),
    "TYR": (163.18, 0.0), "VAL": (99.13, 0.0),
}
_DEFAULT_PROP = (110.0, 0.0)


class ProteinSimulator:
    """High-level interface: load a PDB, run a short MD simulation."""

    def __init__(self, system: MolecularSystem, residue_ids: list[str]) -> None:
        self.system = system
        self.residue_ids = residue_ids
        self.analyzer = SimulationAnalyzer()

    @classmethod
    def from_pdb(cls, pdb_path: str) -> "ProteinSimulator":
        """Build a ProteinSimulator from a PDB file (CA atoms only)."""
        from Bio.PDB import PDBParser

        parser = PDBParser(QUIET=True)
        structure = parser.get_structure("prot", pdb_path)
        positions, masses, charges, res_ids = [], [], [], []
        for model in structure:
            for chain in model:
                for res in chain:
                    ca = res["CA"] if "CA" in res else None
                    if ca is None:
                        continue
                    positions.append(ca.get_coord())
                    resname = res.get_resname()
                    m, q = _RESIDUE_PROPS.get(resname, _DEFAULT_PROP)
                    masses.append(m)
                    charges.append(q)
                    res_ids.append(f"{chain.id}:{res.id[1]}:{resname}")
        pos = np.array(positions, dtype=np.float64)
        com = pos.mean(axis=0)
        pos -= com  # centre at origin
        masses_arr = np.array(masses, dtype=np.float64)
        charges_arr = np.array(charges, dtype=np.float64)
        box = float(np.max(np.abs(pos)) * 2.5 + 20.0)
        system = MolecularSystem(pos, masses_arr, charges_arr, box_size=box)
        inst = cls(system, res_ids)
        inst._loaded_path = str(pdb_path)
        return inst

    def simulate(self, pdb_path: str | None = None, n_steps: int = 500, dt: float = 0.002) -> dict:
        """Run MD on *pdb_path* (or current loaded system) and return results + analysis."""
        target = self
        if pdb_path and getattr(self, "_loaded_path", None) != str(pdb_path):
            target = ProteinSimulator.from_pdb(pdb_path)
        traj = target.system.run(n_steps=n_steps, dt=dt, save_every=10)
        rmsf = target.system.get_rmsf(traj)
        b_factors = target.system.get_b_factors(traj)
        rg = target.analyzer.compute_radius_of_gyration(
            target.system.positions, target.system.masses
        )
        contacts = target.analyzer.find_contacts(target.system.positions, cutoff=4.5)
        return {
            "trajectory": traj,
            "residue_ids": target.residue_ids,
            "rmsf": rmsf.tolist(),
            "b_factors": b_factors.tolist(),
            "radius_of_gyration": rg,
            "n_contacts": len(contacts),
            "final_energy": traj[-1]["potential_energy"] if traj else 0.0,
            "final_temperature": traj[-1]["temperature"] if traj else 0.0,
        }
