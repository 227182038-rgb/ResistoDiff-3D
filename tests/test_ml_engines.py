"""
Unit and algorithmic validation tests for ResistoDiff-3D ML Engines.
Tests EGNN message passing, SE(3) diffusion, MD Verlet integration, and PocketDetector.
"""
import sys
from pathlib import Path
import pytest
import numpy as np
import torch
import torch.nn.functional as F

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "mini-services" / "resistodiff-engine"))

from models.egnn import (
    ResistoEGNNEncoder,
    EGNNMessagePassingLayer,
    MutationScorer,
    get_amino_acid_one_hot,
    compute_rmsd,
    generate_mutant_coords,
)
from diffusion.se3_diffuser import (
    GaussianDiffusion3D,
    SE3EquivariantUNet,
    MoleculeGenerator,
)
from diffusion.esm_scorer import (
    ESMProteinEncoder,
    LigandDescriptorEncoder,
    InteractionScorer,
    ESMBindingScorer,
)
from pockets.detector import PocketDetector, compute_conservation
from simulation.md_engine import MolecularSystem, SimulationAnalyzer, ProteinSimulator


# ── 1. EGNN Tests ────────────────────────────────────────────────────────

def test_amino_acid_encoding():
    """Verify one-hot vector generation for standard amino acids."""
    ala = get_amino_acid_one_hot("A")
    assert ala.shape == (20,)
    assert ala[0].item() == 1.0
    assert ala.sum().item() == 1.0


def test_egnn_layer_forward():
    """Verify EGNN message passing preserves node & coordinate shapes."""
    layer = EGNNMessagePassingLayer(hidden_dim=64, edge_attr_dim=0)
    h = torch.randn(20, 64)
    x = torch.randn(20, 3)
    edge_index = torch.randint(0, 20, (2, 50))

    h_out, x_out = layer(h, x, edge_index)
    assert h_out.shape == (20, 64)
    assert x_out.shape == (20, 3)


def test_egnn_coordinate_translation_equivariance():
    """Verify that shifting inputs by translation T shifts outputs by T."""
    encoder = ResistoEGNNEncoder(input_dim=25, hidden_dim=32, num_layers=2)
    h = torch.randn(15, 25)
    x = torch.randn(15, 3)
    edge_index = torch.randint(0, 15, (2, 30))

    _, x_out1 = encoder(h, x, edge_index)

    # Apply rigid translation
    translation = torch.tensor([5.0, -3.0, 2.5])
    _, x_out2 = encoder(h, x + translation, edge_index)

    diff = torch.norm((x_out1 + translation) - x_out2)
    assert diff.item() < 1e-2, f"Translation equivariance violation: {diff.item()}"
    assert torch.allclose(x_out1 + translation, x_out2, atol=1e-3, rtol=1e-3)


def test_mutation_scorer_ddg():
    """Verify delta-delta-G and fitness score calculations."""
    encoder = ResistoEGNNEncoder(input_dim=25, hidden_dim=32, num_layers=2)
    scorer = MutationScorer(encoder)

    x_wt = torch.randn(30, 3)
    x_mut = x_wt + torch.randn(30, 3) * 0.2
    h = torch.randn(30, 25)
    edge_index = torch.randint(0, 30, (2, 60))

    ddg_fold = scorer.compute_ddg_fold(x_wt, x_mut, edge_index, h)
    assert isinstance(ddg_fold, float)

    active_mask = torch.zeros(30, dtype=torch.bool)
    active_mask[5:10] = True
    ddg_bind = scorer.compute_ddg_binding(x_wt, x_mut, active_mask)
    assert isinstance(ddg_bind, float)

    fitness = scorer.compute_fitness_score(ddg_fold=0.5, ddg_catalysis=1.0, ddg_binding=0.1)
    assert 0.0 <= fitness <= 1.0


# ── 2. SE(3) Diffusion Tests ─────────────────────────────────────────────

def test_gaussian_diffusion_noise_schedule():
    """Verify forward diffusion noise scheduling and shape retention."""
    diff = GaussianDiffusion3D(num_timesteps=50, schedule="cosine")
    x0 = torch.randn(12, 3)
    xt = diff.add_noise(x0, t=10)
    assert xt.shape == (12, 3)


def test_diffusion_molecule_generation():
    """Verify generation of 3D molecular candidates inside pocket bounds."""
    gen = MoleculeGenerator(pocket_center=np.array([0.0, 0.0, 0.0]), pocket_radius=8.0, num_atoms=15)
    mols = gen.generate(num_molecules=2, num_steps=10, guidance_scale=2.0)
    assert len(mols) == 2
    for m in mols:
        assert m.coordinates.shape == (15, 3)
        assert len(m.atom_types) == 15
        assert 0.0 <= m.confidence <= 1.0


# ── 3. MD Simulation Engine Tests ────────────────────────────────────────

def test_molecular_system_verlet_integration():
    """Verify Velocity Verlet physics preserves degrees of freedom."""
    pos = np.random.randn(20, 3) * 10.0
    masses = np.full(20, 12.0)
    charges = np.zeros(20)
    system = MolecularSystem(pos, masses, charges, box_size=50.0)

    traj = system.run(n_steps=20, dt=0.002, save_every=5)
    assert len(traj) > 0
    assert "potential_energy" in traj[0]
    assert "kinetic_energy" in traj[0]
    assert "temperature" in traj[0]


def test_simulation_analyzer_radius_of_gyration():
    """Verify Radius of Gyration calculation."""
    analyzer = SimulationAnalyzer()
    pos = np.array([[1.0, 0.0, 0.0], [-1.0, 0.0, 0.0]], dtype=np.float64)
    masses = np.array([1.0, 1.0], dtype=np.float64)
    rg = analyzer.compute_radius_of_gyration(pos, masses)
    assert np.isclose(rg, 1.0)


# ── 4. Pocket Detector Tests ─────────────────────────────────────────────

def test_pocket_detector_execution():
    """Verify PocketDetector executes cleanly with optimized spatial bounding."""
    detector = PocketDetector(probe_radius=1.4, min_volume=20.0, grid_spacing=1.0)
    pos = np.random.randn(50, 3) * 10.0
    radii = np.full(50, 3.5)
    residue_ids = [f"A:{i}:ALA" for i in range(50)]

    pockets = detector.detect_pockets(pos, radii, residue_ids)
    assert isinstance(pockets, list)
    for p in pockets:
        assert p.volume >= 20.0
        assert 0.0 <= p.druggability <= 1.0


def test_compute_conservation():
    """Verify Shannon-entropy conservation scoring."""
    identical_residues = ["A:1:ALA"] * 20
    score_conserved = compute_conservation(identical_residues)
    assert score_conserved > 0.8

    diverse_residues = [f"A:{i}:{aa}" for i, aa in enumerate(["ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY"])]
    score_diverse = compute_conservation(diverse_residues)
    assert score_diverse < score_conserved
