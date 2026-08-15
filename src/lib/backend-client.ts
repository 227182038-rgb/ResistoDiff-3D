// ============================================================================
// ResistoDiff-3D: Backend API Client
// Connects Next.js frontend to the Python FastAPI backend
// ============================================================================

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

interface TaskResponse {
  task_id: string;
  status: TaskStatus;
  progress?: number;
  result?: unknown;
  error?: string;
}

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BACKEND_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail || `Backend error ${res.status}`);
  }
  return res.json();
}

export async function pollTask(taskId: string, onProgress?: (p: number) => void): Promise<unknown> {
  const maxWait = 300_000; // 5 min
  const interval = 1000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const task: TaskResponse = await apiRequest(`/api/tasks/${taskId}`);
    if (onProgress && task.progress) onProgress(task.progress);
    if (task.status === 'completed') return task.result;
    if (task.status === 'failed') throw new Error(task.error || 'Task failed');
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error('Task timed out');
}

// --- Health ---
export async function checkBackendHealth() {
  return apiRequest<{ status: string; models_loaded: string[] }>('/api/health');
}

// --- Targets ---
export interface BackendTarget {
  id: string;
  name: string;
  uniprot_id: string;
  pdb_id: string;
  gene_name: string;
  organism: string;
  target_class: string;
  sequence: string;
  sequence_length: number;
  description: string;
  key_residues: string[];
  resistance_mechanism: string;
  known_mutations: Array<{
    position: number;
    wild_type: string;
    mutant: string;
    effect: string;
    clinical_significance: string;
  }>;
  pocket_annotations: Array<{
    pocket_id: number;
    center: [number, number, number];
    type: string;
    residues: string[];
    description: string;
  }>;
  pdb_file: string | null;
}

export async function fetchTargets() {
  return apiRequest<BackendTarget[]>('/api/targets');
}

export async function fetchTarget(id: string) {
  return apiRequest<BackendTarget>(`/api/targets/${id}`);
}

// --- SEFE Mutation Analysis ---
export interface MutationAnalysisRequest {
  target_id: string;
  mutations?: string[];  // e.g. ["E104K", "G238S"]
  run_all_known?: boolean;
}

export interface MutationAnalysisResult {
  task_id: string;
  status: string;
}

export async function runMutationAnalysis(req: MutationAnalysisRequest) {
  return apiRequest<MutationAnalysisResult>('/api/sefe/mutate', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// --- DAPM Pocket Detection ---
export interface PocketDetectionRequest {
  target_id: string;
  probe_radius?: number;
  min_volume?: number;
  grid_spacing?: number;
}

export async function runPocketDetection(req: PocketDetectionRequest) {
  return apiRequest<{ task_id: string; status: string }>('/api/dapm/pockets', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// --- DAPM Molecular Simulation ---
export interface SimulationRequest {
  target_id: string;
  n_steps?: number;
  dt?: number;
  temperature?: number;
  save_every?: number;
}

export async function runMolecularSimulation(req: SimulationRequest) {
  return apiRequest<{ task_id: string; status: string }>('/api/dapm/simulate', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// --- A-SE3Diff Molecule Generation ---
export interface DiffusionRequest {
  target_id: string;
  pocket_id: number;
  num_molecules?: number;
  num_steps?: number;
  guidance_scale?: number;
  num_atoms?: number;
}

export async function runDiffusionGeneration(req: DiffusionRequest) {
  return apiRequest<{ task_id: string; status: string }>('/api/ase3diff/generate', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// --- A-SE3Diff Binding Score ---
export interface BindingScoreRequest {
  target_id: string;
  ligand_smiles: string;
}

export interface BindingScoreResult {
  binding_score: number;
  protein_embedding: number[];
  ligand_embedding: number[];
  attention_weights: number[][];
}

export async function runBindingScore(req: BindingScoreRequest) {
  return apiRequest<BindingScoreResult>('/api/ase3diff/score', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// --- Dataset Management ---
export interface DatasetStatus {
  targets: Array<{
    id: string;
    name: string;
    has_pdb: boolean;
    has_sequence: boolean;
    n_mutations: number;
    n_pockets: number;
    last_updated: string | null;
  }>;
  dataset_version: string;
  total_size_mb: number;
  last_sync: string | null;
}

export async function fetchDatasetStatus() {
  return apiRequest<DatasetStatus>('/api/dataset/status');
}

export async function triggerDatasetSync() {
  return apiRequest<{ task_id: string; status: string }>('/api/dataset/sync', {
    method: 'POST',
  });
}