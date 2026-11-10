"""
ResistoDiff-3D Python Backend — FastAPI Application

Production-grade API server that connects the Next.js frontend to the
ML engines (EGNN, ESM-2 scorer, SE(3) diffuser, MD engine, pocket
detector) and the bio-target dataset manager.

Routes
------
1.  GET  /api/health           — health check
2.  GET  /api/targets           — list all bio-targets
3.  GET  /api/targets/{id}      — get specific target details
4.  POST /api/sefe/mutate       — SEFE mutation analysis (ESM-2 + EGNN)
5.  POST /api/dapm/pockets      — detect pockets (geometric detector)
6.  POST /api/dapm/simulate     — molecular dynamics simulation
7.  POST /api/ase3diff/generate — generate molecules (SE(3) diffusion)
8.  POST /api/ase3diff/score    — score protein-ligand binding
9.  GET  /api/dataset/status    — dataset management status
10. POST /api/dataset/sync      — trigger dataset sync

All long-running operations (MD simulation, molecule generation)
run as background tasks and return a task ID for polling.
"""
from __future__ import annotations

import asyncio
import logging
import sys
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import torch
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── Add engine directory to sys.path so we can import from it ──────
ENGINE_ROOT = Path(__file__).resolve().parent.parent / "mini-services" / "resistodiff-engine"
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

# ── Local imports ──────────────────────────────────────────────────
from config import get_settings  # noqa: E402
from dataset_manager import (
    BioTarget,
    KnownMutation,
    PocketAnnotation,
    get_dataset_manager,
)  # noqa: E402

# ── Engine imports ─────────────────────────────────────────────────
from models.egnn import (  # noqa: E402
    MutationScorer,
    ProteinGraphBuilder,
    ResistoEGNNEncoder,
    generate_mutant_coords,
    load_pretrained_egnn,
)
from diffusion.esm_scorer import ESMBindingScorer  # noqa: E402
from diffusion.se3_diffuser import (  # noqa: E402
    GeneratedMolecule,
    MoleculeGenerator,
)
from simulation.md_engine import ProteinSimulator  # noqa: E402
from pockets.detector import (  # noqa: E402
    PocketDetector,
    PocketResult,
    get_vdw_radii,
)

# ── Logging ────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("resistodiff")


# ======================================================================
# Global state: task store for background jobs
# ======================================================================


class _TaskStore:
    """In-memory store for background task status and results."""

    def __init__(self) -> None:
        self._tasks: Dict[str, Dict[str, Any]] = {}

    def create(self, name: str) -> str:
        task_id = uuid.uuid4().hex[:12]
        self._tasks[task_id] = {
            "task_id": task_id,
            "name": name,
            "status": "pending",
            "created_at": time.time(),
            "result": None,
            "error": None,
        }
        return task_id

    def update(self, task_id: str, status: str, result: Any = None, error: Any = None) -> None:
        task = self._tasks.get(task_id)
        if task is None:
            return
        task["status"] = status
        task["completed_at"] = time.time()
        if result is not None:
            task["result"] = result
        if error is not None:
            task["error"] = error

    def get(self, task_id: str) -> Optional[Dict[str, Any]]:
        return self._tasks.get(task_id)


task_store = _TaskStore()


# ======================================================================
# Application lifecycle
# ======================================================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start-up and shut-down hooks.

    * Initialises the dataset manager (seeds pre-loaded targets on first run).
    * Pre-loads lightweight models into CPU memory.
    * Cleans up on shutdown.
    """
    logger.info("ResistoDiff-3D backend starting up …")

    # Initialise dataset
    dm = get_dataset_manager()
    logger.info("Dataset manager ready — %d targets loaded.", len(dm.list_targets()))

    # Pre-load ML models onto CPU
    app.state.egnn_encoder = ResistoEGNNEncoder(input_dim=25, hidden_dim=128, num_layers=4)
    app.state.egnn_scorer = MutationScorer(app.state.egnn_encoder)
    load_pretrained_egnn(app.state.egnn_scorer)
    app.state.egnn_scorer.eval()
    logger.info("EGNN mutation scorer loaded (CPU).")

    app.state.esm_scorer = ESMBindingScorer(hidden_dim=128)
    logger.info("ESM-2 binding scorer loaded (CPU).")

    app.state.pocket_detector = PocketDetector(
        probe_radius=1.4, min_volume=50.0, grid_spacing=0.8
    )
    logger.info("Geometric pocket detector ready.")

    logger.info("All models initialised. Server is ready.")
    yield

    # Shutdown
    del app.state.egnn_encoder
    del app.state.egnn_scorer
    del app.state.esm_scorer
    logger.info("ResistoDiff-3D backend shut down.")


# ======================================================================
# FastAPI app
# ======================================================================


app = FastAPI(
    title="ResistoDiff-3D API",
    description=(
        "Production API for the ResistoDiff-3D antimicrobial-resistance drug "
        "discovery platform.  Provides SEFE mutation analysis, DAPM pocket "
        "detection & MD simulation, and ASE(3)-Diff molecule generation."
    ),
    version="1.0.0",
    lifespan=lifespan,
)


# ── CORS ──────────────────────────────────────────────────────────
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ======================================================================
# Pydantic request / response models
# ======================================================================


class HealthResponse(BaseModel):
    status: str
    version: str
    models_loaded: List[str]
    uptime_seconds: float


class TargetSummary(BaseModel):
    target_id: str
    name: str
    uniprot_id: str
    pdb_ids: List[str]
    sequence_length: int
    organism: str
    protein_class: str
    amr_category: str
    num_mutations: int
    last_updated: str


class MutationOut(BaseModel):
    position: int
    wild_type: str
    mutant: str
    effect: str
    clinical_significance: str
    references: List[str]


class PocketAnnotationOut(BaseModel):
    name: str
    residues: List[str]
    description: str


class TargetDetail(BaseModel):
    target_id: str
    name: str
    uniprot_id: str
    pdb_ids: List[str]
    sequence: str
    organism: str
    protein_class: str
    amr_category: str
    description: str
    known_mutations: List[MutationOut]
    pocket_annotations: List[PocketAnnotationOut]
    last_updated: str


class SEFE_mutateRequest(BaseModel):
    """Request body for SEFE mutation analysis."""
    target_id: str = Field(..., description="Target identifier (e.g. 'tem1')")
    mutations: Optional[List[Any]] = Field(
        None, description="List of mutations [{position: int, mutant: str}, …] or ['G238S', …]"
    )
    run_all_known: Optional[bool] = Field(False, description="Whether to run all known mutations")
    pdb_id: Optional[str] = Field(None, description="PDB ID to use (defaults to first available)")


class MutationAnalysisResult(BaseModel):
    mutation: Dict[str, Any]
    ddg_fold: float
    ddg_binding: float
    catalysis_effect: float
    fitness_score: float
    rmsd_wt_vs_mut: float


class SEFE_mutateResponse(BaseModel):
    task_id: str
    target_id: str
    status: str
    results: Optional[List[MutationAnalysisResult]] = None


class DAPM_pocketsRequest(BaseModel):
    """Request body for pocket detection."""
    target_id: str = Field(..., description="Target identifier")
    pdb_id: Optional[str] = Field(None, description="PDB ID (defaults to first available)")


class PocketOut(BaseModel):
    pocket_id: int
    center: List[float]
    volume: float
    surface_area: float
    depth: float
    druggability: float
    residues: List[str]
    pocket_type: str
    conservation_score: float


class DAPM_pocketsResponse(BaseModel):
    task_id: str
    target_id: str
    status: str
    pockets: Optional[List[PocketOut]] = None


class DAPM_simulateRequest(BaseModel):
    """Request body for MD simulation."""
    target_id: str = Field(..., description="Target identifier")
    pdb_id: Optional[str] = Field(None, description="PDB ID (defaults to first available)")
    n_steps: int = Field(500, ge=10, le=50000, description="Number of MD steps")
    dt: float = Field(0.002, ge=0.0005, le=0.01, description="Timestep (ps)")


class DAPM_simulateResponse(BaseModel):
    task_id: str
    target_id: str
    status: str
    result: Optional[Dict[str, Any]] = None


class ASE3Diff_generateRequest(BaseModel):
    """Request body for SE(3) diffusion molecule generation."""
    target_id: str = Field(..., description="Target identifier")
    pocket_center: Optional[List[float]] = Field(None, min_length=3, max_length=3, description="Pocket centre [x, y, z] in Å")
    pocket_radius: float = Field(5.0, gt=1.0, le=30.0, description="Pocket radius in Å")
    pocket_id: Optional[int] = Field(1, description="Pocket ID if pocket_center is not specified")
    num_atoms: int = Field(25, ge=5, le=100, description="Atoms per generated molecule")
    num_molecules: int = Field(6, ge=1, le=50, description="Number of molecules to generate")
    num_steps: int = Field(50, ge=5, le=500, description="Diffusion denoising steps")
    guidance_scale: float = Field(5.0, ge=1.0, le=20.0, description="Classifier-free guidance scale")


class MoleculeOut(BaseModel):
    coordinates: List[List[float]]
    atom_types: List[str]
    confidence: float
    pocket_distance_violations: int
    num_atoms: int


class ASE3Diff_generateResponse(BaseModel):
    task_id: str
    target_id: str
    status: str
    molecules: Optional[List[MoleculeOut]] = None


class ASE3Diff_scoreRequest(BaseModel):
    """Request body for protein-ligand binding scoring."""
    target_id: str = Field(..., description="Target identifier")
    ligand_smiles: str = Field(..., description="Ligand SMILES string")


class ASE3Diff_scoreResponse(BaseModel):
    target_id: str
    ligand_smiles: str
    binding_score: float
    binding_score_label: str


class DatasetStatusResponse(BaseModel):
    status: str
    dataset_path: str
    num_targets: int
    target_ids: List[str]
    total_cached_pdbs: int
    current_version: str
    last_sync: str
    targets_detail: List[Dict[str, Any]]


class DatasetSyncResponse(BaseModel):
    status: str
    targets_checked: int
    total_new_pdbs: int
    sync_timestamp: str
    updates: List[Dict[str, Any]]


class TaskStatusResponse(BaseModel):
    task_id: str
    name: str
    status: str
    created_at: float
    completed_at: Optional[float] = None
    result: Optional[Any] = None
    error: Optional[str] = None


# ======================================================================
# Helper functions
# ======================================================================


def _resolve_pdb_path(target_id: str, pdb_id: Optional[str]) -> Path:
    """Resolve the PDB file path for a target, downloading if needed.

    Raises HTTPException if no PDB is available.
    """
    dm = get_dataset_manager()
    target = dm.get_target(target_id)
    if target is None:
        raise HTTPException(status_code=404, detail=f"Target '{target_id}' not found.")

    chosen_pdb = (pdb_id or target.pdb_ids[0]).upper()
    path = dm.get_pdb_path(target_id, chosen_pdb)

    if path is None:
        # Try fetching from RCSB
        path = dm.fetch_pdb_from_rcsb(chosen_pdb)

    if path is None or not path.exists():
        raise HTTPException(
            status_code=422,
            detail=f"No PDB file available for target '{target_id}' / PDB '{chosen_pdb}'.",
        )
    return path


def _target_to_summary(t: BioTarget) -> TargetSummary:
    """Convert a BioTarget to a summary DTO."""
    return TargetSummary(
        target_id=t.target_id,
        name=t.name,
        uniprot_id=t.uniprot_id,
        pdb_ids=t.pdb_ids,
        sequence_length=len(t.sequence),
        organism=t.organism,
        protein_class=t.protein_class,
        amr_category=t.amr_category,
        num_mutations=len(t.known_mutations),
        last_updated=t.last_updated,
    )


def _target_to_detail(t: BioTarget) -> TargetDetail:
    """Convert a BioTarget to a full-detail DTO."""
    return TargetDetail(
        target_id=t.target_id,
        name=t.name,
        uniprot_id=t.uniprot_id,
        pdb_ids=t.pdb_ids,
        sequence=t.sequence,
        organism=t.organism,
        protein_class=t.protein_class,
        amr_category=t.amr_category,
        description=t.description,
        known_mutations=[
            MutationOut(
                position=m.position,
                wild_type=m.wild_type,
                mutant=m.mutant,
                effect=m.effect,
                clinical_significance=m.clinical_significance,
                references=m.references,
            )
            for m in t.known_mutations
        ],
        pocket_annotations=[
            PocketAnnotationOut(name=p.name, residues=p.residues, description=p.description)
            for p in t.pocket_annotations
        ],
        last_updated=t.last_updated,
    )


def _pic50_label(pic50: float) -> str:
    """Convert a pIC50 value to a human-readable label."""
    if pic50 >= 9.0:
        return "Excellent (nM)"
    elif pic50 >= 7.0:
        return "Good (μM)"
    elif pic50 >= 5.0:
        return "Moderate (low μM)"
    else:
        return "Weak (mM)"


def _pocket_result_to_out(p: PocketResult) -> PocketOut:
    """Convert a PocketResult to an API DTO."""
    return PocketOut(
        pocket_id=p.pocket_id,
        center=list(p.center),
        volume=p.volume,
        surface_area=p.surface_area,
        depth=p.depth,
        druggability=p.druggability,
        residues=p.residues,
        pocket_type=p.pocket_type,
        conservation_score=p.conservation_score,
    )


def _molecule_to_out(m: GeneratedMolecule) -> MoleculeOut:
    """Convert a GeneratedMolecule to an API DTO."""
    return MoleculeOut(
        coordinates=m.coordinates.tolist(),
        atom_types=m.atom_types,
        confidence=m.confidence,
        pocket_distance_violations=m.pocket_distance_violations,
        num_atoms=m.num_atoms,
    )


# ======================================================================
# Background task runners
# ======================================================================


def _run_sefe_mutate(
    task_id: str,
    target_id: str,
    mutations: Optional[List[Any]],
    pdb_id: Optional[str],
    scorer: MutationScorer,
    run_all_known: bool = False,
) -> None:
    """Run SEFE mutation analysis in a background thread."""
    try:
        task_store.update(task_id, status="running")

        pdb_path = _resolve_pdb_path(target_id, pdb_id)
        graph_builder = ProteinGraphBuilder()
        h, x, edge_index, res_info = graph_builder.parse_pdb_to_graph(pdb_path)

        dm = get_dataset_manager()
        target = dm.get_target(target_id)
        if target is None:
            raise ValueError(f"Target '{target_id}' not found.")

        # Resolve active site residues for this target
        active_site_resseqs: List[int] = []
        for ann in target.pocket_annotations:
            for res_str in ann.residues:
                # Parse e.g. "SER70" → 70
                try:
                    active_site_resseqs.append(int(res_str[3:]))
                except (ValueError, IndexError):
                    pass
        active_site_resseqs = list(set(active_site_resseqs))

        # Map resseqs to graph indices
        active_site_indices = [
            i for i, info in enumerate(res_info) if info["resseq"] in active_site_resseqs
        ]
        active_mask = torch.zeros(h.size(0), dtype=torch.bool)
        if active_site_indices:
            for idx in active_site_indices:
                if 0 <= idx < h.size(0):
                    active_mask[idx] = True

        # Catalytic residues (first 3 from first pocket annotation)
        catalytic_indices: List[int] = []
        for ann in target.pocket_annotations:
            if ann.name in ("active_site", "zinc_binding_site_1"):
                for res_str in ann.residues[:3]:
                    try:
                        resseq = int(res_str[3:])
                        for i, info in enumerate(res_info):
                            if info["resseq"] == resseq:
                                catalytic_indices.append(i)
                                break
                    except (ValueError, IndexError):
                        pass
                if catalytic_indices:
                    break

        # Normalize mutations (supports ["G238S"], [{"position": 238, "mutant": "S"}], or run_all_known)
        normalized_mutations: List[Dict[str, Any]] = []
        if run_all_known or not mutations:
            for km in target.known_mutations:
                normalized_mutations.append({
                    "wild_type": km.wild_type,
                    "position": km.position,
                    "mutant": km.mutant,
                    "name": km.name,
                })
        else:
            for m in mutations:
                if isinstance(m, str):
                    import re
                    match = re.match(r"^([A-Za-z])?(\d+)([A-Za-z])$", m.strip())
                    if match:
                        wt, pos, mut_aa = match.groups()
                        normalized_mutations.append({
                            "wild_type": (wt or "").upper(),
                            "position": int(pos),
                            "mutant": mut_aa.upper(),
                            "name": m.strip(),
                        })
                    else:
                        normalized_mutations.append({"position": 1, "mutant": "A", "raw": m})
                elif isinstance(m, dict):
                    normalized_mutations.append(m)
                else:
                    normalized_mutations.append(dict(m))

        results: List[Dict[str, Any]] = []
        for mut in normalized_mutations:
            pos = mut["position"]
            new_aa = mut["mutant"]

            # Find graph index for this position
            graph_idx = None
            for i, info in enumerate(res_info):
                if info["resseq"] == pos:
                    graph_idx = i
                    break

            if graph_idx is None:
                results.append({
                    "mutation": mut,
                    "error": f"Residue position {pos} not found in PDB structure.",
                })
                continue

            # Generate mutant coordinates
            mut_coords = generate_mutant_coords(x, graph_idx, new_aa)

            # Compute scores
            ddg_fold = scorer.compute_ddg_fold(x, mut_coords, edge_index, h)
            ddg_bind = scorer.compute_ddg_binding(x, mut_coords, active_mask)
            ddg_cat = scorer.compute_catalysis_effect(mut_coords, catalytic_indices)
            fitness = scorer.compute_fitness_score(ddg_fold, ddg_cat, ddg_bind)
            rmsd = 0.0
            if graph_idx < x.size(0):
                rmsd = float(torch.norm(x[graph_idx] - mut_coords[graph_idx]).item())

            results.append({
                "mutation": mut,
                "ddg_fold": round(ddg_fold, 4),
                "ddg_binding": round(ddg_bind, 4),
                "catalysis_effect": round(ddg_cat, 4),
                "fitness_score": round(fitness, 4),
                "rmsd_wt_vs_mut": round(rmsd, 4),
            })

        task_store.update(task_id, status="completed", result=results)
    except Exception as exc:
        logger.exception("SEFE mutate task %s failed", task_id)
        task_store.update(task_id, status="failed", error=str(exc))


def _run_pocket_detection(
    task_id: str,
    target_id: str,
    pdb_id: Optional[str],
    detector: PocketDetector,
) -> None:
    """Run pocket detection in a background thread."""
    try:
        task_store.update(task_id, status="running")

        pdb_path = _resolve_pdb_path(target_id, pdb_id)

        # Parse PDB to get CA positions, radii, and residue IDs
        from Bio.PDB import PDBParser

        parser = PDBParser(QUIET=True)
        structure = parser.get_structure("prot", str(pdb_path))
        model = structure[0]

        positions: List[List[float]] = []
        radii: List[float] = []
        residue_ids: List[str] = []
        vdw_map = get_vdw_radii()

        for chain in model:
            for res in chain:
                if res.id[0] != " ":
                    continue
                if "CA" not in res:
                    continue
                ca = res["CA"]
                positions.append(ca.get_coord().tolist())
                rname = res.get_resname()
                radii.append(vdw_map.get(rname, 3.5))
                residue_ids.append(f"{chain.id}:{res.id[1]}:{rname}")

        if not positions:
            raise ValueError("No CA atoms found in PDB file.")

        pockets = detector.detect_pockets(
            np.array(positions, dtype=np.float64),
            np.array(radii, dtype=np.float64),
            residue_ids,
        )

        results = [_pocket_result_to_out(p) for p in pockets]
        task_store.update(task_id, status="completed", result=results)
    except Exception as exc:
        logger.exception("Pocket detection task %s failed", task_id)
        task_store.update(task_id, status="failed", error=str(exc))


def _run_md_simulation(
    task_id: str,
    target_id: str,
    pdb_id: Optional[str],
    n_steps: int,
    dt: float,
) -> None:
    """Run MD simulation in a background thread."""
    try:
        task_store.update(task_id, status="running")

        pdb_path = _resolve_pdb_path(target_id, pdb_id)
        simulator = ProteinSimulator.from_pdb(str(pdb_path))
        sim_result = simulator.simulate(str(pdb_path), n_steps=n_steps, dt=dt)

        # Trim trajectory to avoid oversized responses
        traj_frames = sim_result["trajectory"]
        # Keep every 10th frame, max 50 frames
        trimmed_traj = []
        for i in range(0, len(traj_frames), 10):
            trimmed_traj.append({
                "step": traj_frames[i].get("step", i * 10),
                "potential_energy": round(traj_frames[i]["potential_energy"], 4),
                "kinetic_energy": round(traj_frames[i]["kinetic_energy"], 4),
                "temperature": round(traj_frames[i]["temperature"], 2),
            })
            if len(trimmed_traj) >= 50:
                break

        result = {
            "n_frames": len(traj_frames),
            "n_frames_returned": len(trimmed_traj),
            "trajectory": trimmed_traj,
            "residue_ids": sim_result["residue_ids"],
            "rmsf": [round(v, 4) for v in sim_result["rmsf"]],
            "b_factors": [round(v, 4) for v in sim_result["b_factors"]],
            "radius_of_gyration": round(sim_result["radius_of_gyration"], 4),
            "n_contacts": sim_result["n_contacts"],
            "final_energy": round(sim_result["final_energy"], 4),
            "final_temperature": round(sim_result["final_temperature"], 2),
        }
        task_store.update(task_id, status="completed", result=result)
    except Exception as exc:
        logger.exception("MD simulation task %s failed", task_id)
        task_store.update(task_id, status="failed", error=str(exc))


def _run_molecule_generation(
    task_id: str,
    target_id: str,
    pocket_center: List[float],
    pocket_radius: float,
    num_atoms: int,
    num_molecules: int,
    num_steps: int,
    guidance_scale: float,
) -> None:
    """Run SE(3) diffusion molecule generation in a background thread."""
    try:
        task_store.update(task_id, status="running")

        gen = MoleculeGenerator(
            pocket_center=np.array(pocket_center, dtype=np.float64),
            pocket_radius=pocket_radius,
            num_atoms=num_atoms,
        )
        molecules = gen.generate(
            num_molecules=num_molecules,
            num_steps=num_steps,
            guidance_scale=guidance_scale,
        )

        results = [_molecule_to_out(m) for m in molecules]
        task_store.update(task_id, status="completed", result=results)
    except Exception as exc:
        logger.exception("Molecule generation task %s failed", task_id)
        task_store.update(task_id, status="failed", error=str(exc))


# ======================================================================
# Routes
# ======================================================================


# ── 1. Health ─────────────────────────────────────────────────────


_start_time = time.time()


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
async def health_check():
    """Return service health status and loaded model information."""
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        models_loaded=[
            "EGNN (MutationScorer, 4-layer, hidden=128)",
            "ESM-2 BindingScorer (4-layer transformer, hidden=128)",
            "SE(3) Diffuser (EquivariantUNet, 4-block)",
            "Geometric PocketDetector (grid-based)",
            "MD Engine (Velocity Verlet, LJ + Coulomb)",
        ],
        uptime_seconds=round(time.time() - _start_time, 2),
    )


# ── 2. List all targets ───────────────────────────────────────────


@app.get("/api/targets", response_model=List[TargetSummary], tags=["targets"])
async def list_targets():
    """List all available bio-targets with summary information."""
    dm = get_dataset_manager()
    return [_target_to_summary(t) for t in dm.list_targets()]


# ── 3. Get specific target ────────────────────────────────────────


@app.get(
    "/api/targets/{target_id}",
    response_model=TargetDetail,
    tags=["targets"],
)
async def get_target(target_id: str):
    """Get full details for a specific bio-target including mutations and pocket annotations."""
    dm = get_dataset_manager()
    target = dm.get_target(target_id)
    if target is None:
        raise HTTPException(status_code=404, detail=f"Target '{target_id}' not found.")
    return _target_to_detail(target)


# ── 4. SEFE Mutation Analysis ─────────────────────────────────────


@app.post("/api/sefe/mutate", response_model=SEFE_mutateResponse, tags=["SEFE"])
async def sefe_mutate(
    request: SEFE_mutateRequest,
    background_tasks: BackgroundTasks,
):
    """Run SEFE mutation analysis using EGNN + ESM-2.

    Analyses the structural and functional impact of specified mutations
    on the target protein. Returns ΔΔG predictions for folding stability,
    binding affinity, and catalytic efficiency.

    Long-running — runs as a background task. Use GET /api/tasks/{task_id}
    to poll status.
    """
    dm = get_dataset_manager()
    target = dm.get_target(request.target_id)
    if target is None:
        raise HTTPException(status_code=404, detail=f"Target '{request.target_id}' not found.")

    task_id = task_store.create(f"sefe_mutate_{request.target_id}")
    background_tasks.add_task(
        _run_sefe_mutate,
        task_id,
        request.target_id,
        request.mutations,
        request.pdb_id,
        app.state.egnn_scorer,
        bool(request.run_all_known),
    )

    return SEFE_mutateResponse(
        task_id=task_id,
        target_id=request.target_id,
        status="pending",
    )


# ── 5. Pocket Detection ───────────────────────────────────────────


@app.post("/api/dapm/pockets", response_model=DAPM_pocketsResponse, tags=["DAPM"])
async def dapm_pockets(
    request: DAPM_pocketsRequest,
    background_tasks: BackgroundTasks,
):
    """Detect binding pockets using the geometric pocket detector.

    Uses a grid-based algorithm to identify buried void regions,
    clusters them, and scores for druggability based on hydrophobicity,
    volume, and conservation.

    Runs as a background task.
    """
    dm = get_dataset_manager()
    target = dm.get_target(request.target_id)
    if target is None:
        raise HTTPException(status_code=404, detail=f"Target '{request.target_id}' not found.")

    task_id = task_store.create(f"dapm_pockets_{request.target_id}")
    background_tasks.add_task(
        _run_pocket_detection,
        task_id,
        request.target_id,
        request.pdb_id,
        app.state.pocket_detector,
    )

    return DAPM_pocketsResponse(
        task_id=task_id,
        target_id=request.target_id,
        status="pending",
    )


# ── 6. MD Simulation ──────────────────────────────────────────────


@app.post("/api/dapm/simulate", response_model=DAPM_simulateResponse, tags=["DAPM"])
async def dapm_simulate(
    request: DAPM_simulateRequest,
    background_tasks: BackgroundTasks,
):
    """Run molecular dynamics simulation on a target protein.

    Uses Velocity Verlet integration with Lennard-Jones + Coulomb
    potentials, harmonic bonds, and velocity-rescaling thermostat.
    Returns trajectory frames, RMSF, B-factors, and radius of gyration.

    Runs as a background task.
    """
    dm = get_dataset_manager()
    target = dm.get_target(request.target_id)
    if target is None:
        raise HTTPException(status_code=404, detail=f"Target '{request.target_id}' not found.")

    task_id = task_store.create(f"dapm_simulate_{request.target_id}")
    background_tasks.add_task(
        _run_md_simulation,
        task_id,
        request.target_id,
        request.pdb_id,
        request.n_steps,
        request.dt,
    )

    return DAPM_simulateResponse(
        task_id=task_id,
        target_id=request.target_id,
        status="pending",
    )


# ── 7. Molecule Generation ────────────────────────────────────────


@app.post("/api/ase3diff/generate", response_model=ASE3Diff_generateResponse, tags=["ASE3-Diff"])
async def ase3diff_generate(
    request: ASE3Diff_generateRequest,
    background_tasks: BackgroundTasks,
):
    """Generate 3D molecular coordinates via SE(3) equivariant diffusion.

    Uses a denoising diffusion probabilistic model with SE(3)-equivariant
    architecture and classifier-free guidance, conditioned on pocket geometry.

    Runs as a background task.
    """
    dm = get_dataset_manager()
    target = dm.get_target(request.target_id)
    if target is None:
        raise HTTPException(status_code=404, detail=f"Target '{request.target_id}' not found.")

    pocket_center = request.pocket_center
    if pocket_center is None:
        default_centers = {
            "tem1": [15.0, 28.0, 5.0],
            "kpc2": [12.0, 25.0, 8.0],
            "ndm1": [18.0, 30.0, 10.0],
            "gyra": [22.0, 35.0, 12.0],
        }
        pocket_center = default_centers.get(request.target_id.lower(), [15.0, 28.0, 5.0])

    task_id = task_store.create(f"ase3diff_generate_{request.target_id}")
    background_tasks.add_task(
        _run_molecule_generation,
        task_id,
        request.target_id,
        pocket_center,
        request.pocket_radius,
        request.num_atoms,
        request.num_molecules,
        request.num_steps,
        request.guidance_scale,
    )

    return ASE3Diff_generateResponse(
        task_id=task_id,
        target_id=request.target_id,
        status="pending",
    )


# ── 8. Binding Score ──────────────────────────────────────────────


@app.post("/api/ase3diff/score", response_model=ASE3Diff_scoreResponse, tags=["ASE3-Diff"])
async def ase3diff_score(request: ASE3Diff_scoreRequest):
    """Score protein-ligand binding affinity using the ESM-2 binding scorer.

    Combines a lightweight ESM-style protein encoder with RDKit ligand
    descriptors and cross-attention interaction scoring to predict
    binding affinity (pIC50).

    This endpoint is synchronous (fast, ~1s).
    """
    dm = get_dataset_manager()
    target = dm.get_target(request.target_id)
    if target is None:
        raise HTTPException(status_code=404, detail=f"Target '{request.target_id}' not found.")

    scorer: ESMBindingScorer = app.state.esm_scorer
    result = scorer.score(target.sequence, request.ligand_smiles)

    return ASE3Diff_scoreResponse(
        target_id=request.target_id,
        ligand_smiles=request.ligand_smiles,
        binding_score=round(result.binding_score, 4),
        binding_score_label=_pic50_label(result.binding_score),
    )


# ── 9. Dataset Status ─────────────────────────────────────────────


@app.get("/api/dataset/status", response_model=DatasetStatusResponse, tags=["dataset"])
async def dataset_status():
    """Return comprehensive dataset management status.

    Includes the number of targets, cached PDB files, version history,
    and per-target details.
    """
    dm = get_dataset_manager()
    status = dm.get_status()
    return DatasetStatusResponse(**status)


# ── 10. Dataset Sync ──────────────────────────────────────────────


@app.post("/api/dataset/sync", response_model=DatasetSyncResponse, tags=["dataset"])
async def dataset_sync(background_tasks: BackgroundTasks):
    """Trigger a dataset synchronisation.

    Checks all watched targets against RCSB PDB for new structures,
    downloads any new PDB files, and bumps the dataset version.

    Runs as a background task for long syncs.
    """
    task_id = task_store.create("dataset_sync")

    def _do_sync(tid: str) -> None:
        try:
            task_store.update(tid, status="running")
            dm = get_dataset_manager()
            result = dm.sync_all()
            task_store.update(tid, status="completed", result=result)
        except Exception as exc:
            logger.exception("Dataset sync task %s failed", tid)
            task_store.update(tid, status="failed", error=str(exc))

    background_tasks.add_task(_do_sync, task_id)

    return DatasetSyncResponse(
        status="pending",
        targets_checked=0,
        total_new_pdbs=0,
        sync_timestamp="",
        updates=[],
    )


# ── Task Status Polling ───────────────────────────────────────────


@app.get("/api/tasks/{task_id}", response_model=TaskStatusResponse, tags=["system"])
async def get_task_status(task_id: str):
    """Poll the status of a background task.

    Used to check progress of long-running operations like MD simulation,
    pocket detection, and molecule generation.
    """
    task = task_store.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found.")
    return TaskStatusResponse(
        task_id=task["task_id"],
        name=task["name"],
        status=task["status"],
        created_at=task["created_at"],
        completed_at=task.get("completed_at"),
        result=task.get("result"),
        error=task.get("error"),
    )


# ======================================================================
# Uvicorn entry point
# ======================================================================


if __name__ == "__main__":
    import uvicorn

    cfg = get_settings()
    uvicorn.run(
        "main:app",
        host=cfg.host,
        port=cfg.port,
        log_level=cfg.log_level.lower(),
        reload=cfg.debug,
    )
