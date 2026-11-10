"""
Integration and API tests for ResistoDiff-3D FastAPI backend.
Tests all endpoints, request validation, background task dispatching, and error handling.
"""
import sys
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python-backend"))
sys.path.insert(0, str(ROOT / "mini-services" / "resistodiff-engine"))

from main import app, get_dataset_manager


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_health_check(client):
    """Verify system health check endpoint."""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "version" in data
    assert len(data["models_loaded"]) >= 4


def test_get_all_targets(client):
    """Verify listing all AMR protein targets."""
    response = client.get("/api/targets")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 4
    target_ids = [t["target_id"] for t in data]
    assert "tem1" in target_ids
    assert "kpc2" in target_ids
    assert "ndm1" in target_ids
    assert "gyra" in target_ids


def test_get_target_detail(client):
    """Verify fetching details of a specific target."""
    response = client.get("/api/targets/tem1")
    assert response.status_code == 200
    data = response.json()
    assert data["target_id"] == "tem1"
    assert data["uniprot_id"] == "P62593"
    assert len(data["known_mutations"]) > 0
    assert len(data["pocket_annotations"]) > 0


def test_get_target_not_found(client):
    """Verify 404 on nonexistent target."""
    response = client.get("/api/targets/unknown_target_xyz")
    assert response.status_code == 404


def test_sefe_mutate_endpoint_string_mutations(client):
    """Verify submitting mutation analysis with string notation ('G238S')."""
    payload = {
        "target_id": "tem1",
        "mutations": ["G238S"],
    }
    response = client.post("/api/sefe/mutate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "task_id" in data
    assert data["target_id"] == "tem1"
    assert data["status"] == "pending"


def test_sefe_mutate_endpoint_dict_mutations(client):
    """Verify submitting mutation analysis with structured dicts."""
    payload = {
        "target_id": "tem1",
        "mutations": [{"position": 238, "mutant": "S", "wild_type": "G"}],
    }
    response = client.post("/api/sefe/mutate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "task_id" in data


def test_dapm_pockets_endpoint(client):
    """Verify submitting pocket detection."""
    payload = {
        "target_id": "tem1",
    }
    response = client.post("/api/dapm/pockets", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "task_id" in data
    assert data["status"] == "pending"


def test_dapm_simulate_endpoint(client):
    """Verify submitting MD simulation."""
    payload = {
        "target_id": "tem1",
        "n_steps": 20,
        "dt": 0.002,
    }
    response = client.post("/api/dapm/simulate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "task_id" in data


def test_ase3diff_generate_endpoint_with_defaults(client):
    """Verify submitting SE(3) diffusion generation without manual coordinates."""
    payload = {
        "target_id": "tem1",
        "num_molecules": 2,
        "num_steps": 10,
        "guidance_scale": 3.0,
    }
    response = client.post("/api/ase3diff/generate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "task_id" in data


def test_ase3diff_score_endpoint(client):
    """Verify synchronous protein-ligand binding scoring."""
    payload = {
        "target_id": "tem1",
        "ligand_smiles": "CC(=O)Oc1ccccc1C(=O)O",
    }
    response = client.post("/api/ase3diff/score", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "binding_score" in data
    assert "binding_score_label" in data


def test_dataset_status_endpoint(client):
    """Verify dataset repository status."""
    response = client.get("/api/dataset/status")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["num_targets"] >= 4
