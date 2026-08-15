import { NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/dataset/status`, {
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({
      backend_offline: true,
      targets: [
        { id: 'tem1', name: 'TEM-1 Beta-Lactamase', has_pdb: false, has_sequence: true, n_mutations: 8, n_pockets: 3, last_updated: null },
        { id: 'kpc2', name: 'KPC-2 Beta-Lactamase', has_pdb: false, has_sequence: true, n_mutations: 6, n_pockets: 2, last_updated: null },
        { id: 'ndm1', name: 'NDM-1 Metallo-BL', has_pdb: false, has_sequence: true, n_mutations: 5, n_pockets: 2, last_updated: null },
        { id: 'gyra', name: 'DNA Gyrase A', has_pdb: false, has_sequence: true, n_mutations: 6, n_pockets: 3, last_updated: null },
      ],
      dataset_version: 'simulated',
      total_size_mb: 0,
      last_sync: null,
    })
  }
}

export async function POST() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/dataset/sync`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 503 })
  }
}