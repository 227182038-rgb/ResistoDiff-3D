import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  simulateMutationAnalysis,
  simulateDiffusionGeneration,
  DEMO_POCKETS,
  KNOWN_MUTATIONS,
  PROTEIN_TARGETS,
} from '@/lib/resistodiff-data'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

type AnalysisModule = 'SEFE' | 'DAPM' | 'ASE3DIFF'

interface AnalyzeRequestBody {
  proteinId: string
  module: AnalysisModule
  mutations?: string[]
  pocketId?: number
  diffusionParams?: {
    candidates: number
    steps: number
    temperature: number
    guidanceScale: number
  }
  simulationParams?: {
    nSteps: number
    dt: number
    temperature: number
  }
}

/** Check if Python backend is reachable */
async function isBackendAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: AnalyzeRequestBody = await request.json()
    const { proteinId, module, mutations, pocketId, diffusionParams, simulationParams } = body

    if (!proteinId || !module) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: proteinId, module' },
        { status: 400 }
      )
    }

    const startTime = Date.now()

    // Try real backend first
    const backendAlive = await isBackendAlive()

    if (backendAlive) {
      return handleWithBackend(body, startTime)
    }

    // Fallback to simulated data
    return await handleWithSimulation(body, startTime)
  } catch (error) {
    console.error('Analysis failed:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

/** Route to real Python backend */
async function handleWithBackend(body: AnalyzeRequestBody, startTime: number) {
  const { proteinId, module, mutations, pocketId, diffusionParams, simulationParams } = body

  let backendPath = ''
  let backendBody: Record<string, unknown> = { target_id: proteinId }

  switch (module) {
    case 'SEFE':
      backendPath = '/api/sefe/mutate'
      if (mutations && mutations.length > 0) backendBody.mutations = mutations
      else backendBody.run_all_known = true
      break
    case 'DAPM':
      if (simulationParams) {
        // Simulation mode
        backendPath = '/api/dapm/simulate'
        backendBody = {
          target_id: proteinId,
          n_steps: simulationParams.nSteps || 500,
          temperature: simulationParams.temperature || 300,
        }
      } else {
        // Pocket detection mode
        backendPath = '/api/dapm/pockets'
      }
      break
    case 'ASE3DIFF':
      backendPath = '/api/ase3diff/generate'
      backendBody = {
        target_id: proteinId,
        pocket_id: pocketId || 1,
        num_molecules: diffusionParams?.candidates || 6,
        num_steps: diffusionParams?.steps || 50,
        guidance_scale: diffusionParams?.guidanceScale || 5.0,
      }
      break
  }

  try {
    const res = await fetch(`${BACKEND_URL}${backendPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backendBody),
    })
    const data = await res.json()

    if (!res.ok) {
      return NextResponse.json({ success: false, error: data.detail, backend: true }, { status: res.status })
    }

    // If it's a background task, return task_id for polling
    if (data.task_id) {
      return NextResponse.json({
        success: true,
        taskId: data.task_id,
        backend: true,
        message: `Task ${data.task_id} submitted. Poll /api/tasks/${data.task_id} for results.`,
      })
    }

    // If it's a synchronous result (like binding score)
    return NextResponse.json({ success: true, results: data, backend: true })
  } catch (err) {
    console.error('Backend request failed, falling back to simulation:', err)
    return await handleWithSimulation(body, startTime)
  }
}

/** Fallback: use client-side simulated data */
async function handleWithSimulation(body: AnalyzeRequestBody, startTime: number) {
  const { proteinId, module, mutations, pocketId, diffusionParams } = body

  // Find or create the protein target in DB
  let protein = await db.proteinTarget.findUnique({ where: { id: proteinId } })
  if (!protein) {
    const demoTarget = PROTEIN_TARGETS.find((p) => p.id === proteinId)
    if (demoTarget) {
      protein = await db.proteinTarget.create({
        data: {
          id: demoTarget.id, name: demoTarget.name, uniprotId: demoTarget.uniprotId,
          pdbId: demoTarget.pdbId, geneName: demoTarget.geneName, organism: demoTarget.organism,
          targetClass: demoTarget.targetClass, sequenceLength: demoTarget.sequenceLength,
          description: demoTarget.description,
        },
      })
    } else {
      return NextResponse.json({ success: false, error: `Protein target '${proteinId}' not found` }, { status: 404 })
    }
  }

  const analysisRun = await db.analysisRun.create({
    data: {
      proteinId: protein.id, module, status: 'running',
      parameters: JSON.stringify({ mutations, pocketId, diffusionParams }),
    },
  })

  let results: unknown = null

  switch (module) {
    case 'SEFE': {
      const inputMutations = mutations?.length ? mutations : (KNOWN_MUTATIONS[proteinId]?.map(m => m.mutation) ?? [])
      const mutationResults = simulateMutationAnalysis(proteinId, inputMutations)
      for (const mut of mutationResults) {
        await db.mutationResult.create({
          data: {
            analysisId: analysisRun.id, mutation: mut.mutation, position: mut.position,
            wildType: mut.wildType, mutantType: mut.mutantType,
            ddgFold: mut.ddgFold, ddgCatalysis: mut.ddgCatalysis, ddgBinding: mut.ddgBinding,
            fitnessScore: mut.fitnessScore, esm2Score: mut.esm2Score,
            coevolScore: mut.coevolScore, isCompensatory: mut.isCompensatory,
          },
        })
      }
      results = mutationResults
      break
    }
    case 'DAPM': {
      const demoPockets = DEMO_POCKETS[proteinId] ?? DEMO_POCKETS['tem1'] ?? []
      for (const pocket of demoPockets) {
        await db.pocketResult.create({
          data: {
            analysisId: analysisRun.id, pocketId: pocket.pocketId,
            center_x: pocket.centerX, center_y: pocket.centerY, center_z: pocket.centerZ,
            volume: pocket.volume, surfaceArea: pocket.surfaceArea, depth: pocket.depth,
            druggability: pocket.druggability, residues: pocket.residues.join(','),
            pocketType: pocket.pocketType, conservation: pocket.conservation,
          },
        })
      }
      results = demoPockets
      break
    }
    case 'ASE3DIFF': {
      const steps = diffusionParams?.steps ?? 50
      const targetPocketId = pocketId ?? 1
      const candidates = simulateDiffusionGeneration(steps, targetPocketId)
      for (const candidate of candidates) {
        await db.diffusionResult.create({
          data: {
            analysisId: analysisRun.id, pocketId: targetPocketId, iterations: steps,
            generatedSmiles: candidate.smiles, qedScore: candidate.qedScore, saScore: candidate.saScore,
            lipinskiViolations: candidate.lipinskiViolations, mw: candidate.mw, logP: candidate.logP,
            hbd: candidate.hbd, hba: candidate.hba, tpsa: candidate.tpsa,
          },
        })
      }
      results = candidates
      break
    }
  }

  const runtimeMs = Date.now() - startTime
  await db.analysisRun.update({
    where: { id: analysisRun.id },
    data: { status: 'completed', results: JSON.stringify(results), runtimeMs },
  })

  return NextResponse.json({ success: true, runId: analysisRun.id, results, backend: false })
}