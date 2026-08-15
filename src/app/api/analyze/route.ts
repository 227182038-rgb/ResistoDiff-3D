import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  simulateMutationAnalysis,
  simulateDiffusionGeneration,
  DEMO_POCKETS,
  KNOWN_MUTATIONS,
  PROTEIN_TARGETS,
} from '@/lib/resistodiff-data'

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
}

export async function POST(request: NextRequest) {
  try {
    const body: AnalyzeRequestBody = await request.json()
    const { proteinId, module, mutations, pocketId, diffusionParams } = body

    if (!proteinId || !module) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: proteinId, module' },
        { status: 400 }
      )
    }

    if (!['SEFE', 'DAPM', 'ASE3DIFF'].includes(module)) {
      return NextResponse.json(
        { success: false, error: 'Invalid module. Must be SEFE, DAPM, or ASE3DIFF' },
        { status: 400 }
      )
    }

    const startTime = Date.now()

    // Find or look up the protein
    let protein = await db.proteinTarget.findUnique({
      where: { id: proteinId },
    })

    // If not in DB, check demo data and create it on-the-fly
    if (!protein) {
      const demoTarget = PROTEIN_TARGETS.find((p) => p.id === proteinId)
      if (demoTarget) {
        protein = await db.proteinTarget.create({
          data: {
            id: demoTarget.id,
            name: demoTarget.name,
            uniprotId: demoTarget.uniprotId,
            pdbId: demoTarget.pdbId,
            geneName: demoTarget.geneName,
            organism: demoTarget.organism,
            targetClass: demoTarget.targetClass,
            sequenceLength: demoTarget.sequenceLength,
            description: demoTarget.description,
          },
        })
      } else {
        return NextResponse.json(
          { success: false, error: `Protein target '${proteinId}' not found` },
          { status: 404 }
        )
      }
    }

    // Create the analysis run record
    const analysisRun = await db.analysisRun.create({
      data: {
        proteinId: protein.id,
        module,
        status: 'running',
        parameters: JSON.stringify({
          mutations,
          pocketId,
          diffusionParams,
        }),
      },
    })

    let results: unknown = null

    switch (module) {
      case 'SEFE': {
        // Run mutation analysis
        const inputMutations =
          mutations && mutations.length > 0
            ? mutations
            : KNOWN_MUTATIONS[proteinId]?.map((m) => m.mutation) ?? []

        const mutationResults = simulateMutationAnalysis(proteinId, inputMutations)

        // Persist mutation results to DB
        for (const mut of mutationResults) {
          await db.mutationResult.create({
            data: {
              analysisId: analysisRun.id,
              mutation: mut.mutation,
              position: mut.position,
              wildType: mut.wildType,
              mutantType: mut.mutantType,
              ddgFold: mut.ddgFold,
              ddgCatalysis: mut.ddgCatalysis,
              ddgBinding: mut.ddgBinding,
              fitnessScore: mut.fitnessScore,
              esm2Score: mut.esm2Score,
              coevolScore: mut.coevolScore,
              isCompensatory: mut.isCompensatory,
            },
          })
        }

        results = mutationResults
        break
      }

      case 'DAPM': {
        // Return pocket data from demo or DB
        const dbPockets = await db.pocketResult.findMany({
          where: { analysisId: analysisRun.id },
        })

        if (dbPockets.length > 0) {
          results = dbPockets.map((p) => ({
            pocketId: p.pocketId,
            centerX: p.center_x,
            centerY: p.center_y,
            centerZ: p.center_z,
            volume: p.volume,
            surfaceArea: p.surfaceArea,
            depth: p.depth,
            druggability: p.druggability,
            residues: p.residues.split(','),
            pocketType: p.pocketType,
            conservation: p.conservation,
          }))
        } else {
          // Fall back to demo pocket data
          const demoPockets = DEMO_POCKETS[proteinId] ?? DEMO_POCKETS['tem1'] ?? []

          // Persist demo pocket data for this run
          for (const pocket of demoPockets) {
            await db.pocketResult.create({
              data: {
                analysisId: analysisRun.id,
                pocketId: pocket.pocketId,
                center_x: pocket.centerX,
                center_y: pocket.centerY,
                center_z: pocket.centerZ,
                volume: pocket.volume,
                surfaceArea: pocket.surfaceArea,
                depth: pocket.depth,
                druggability: pocket.druggability,
                residues: pocket.residues.join(','),
                pocketType: pocket.pocketType,
                conservation: pocket.conservation,
              },
            })
          }

          results = demoPockets
        }
        break
      }

      case 'ASE3DIFF': {
        // Run diffusion generation
        const steps = diffusionParams?.steps ?? 50
        const targetPocketId = pocketId ?? 1
        const candidates = simulateDiffusionGeneration(steps, targetPocketId)

        // Persist diffusion results to DB
        for (const candidate of candidates) {
          await db.diffusionResult.create({
            data: {
              analysisId: analysisRun.id,
              pocketId: targetPocketId,
              iterations: steps,
              generatedSmiles: candidate.smiles,
              qedScore: candidate.qedScore,
              saScore: candidate.saScore,
              lipinskiViolations: candidate.lipinskiViolations,
              mw: candidate.mw,
              logP: candidate.logP,
              hbd: candidate.hbd,
              hba: candidate.hba,
              tpsa: candidate.tpsa,
            },
          })
        }

        results = candidates
        break
      }
    }

    const runtimeMs = Date.now() - startTime

    // Update the analysis run as completed
    await db.analysisRun.update({
      where: { id: analysisRun.id },
      data: {
        status: 'completed',
        results: JSON.stringify(results),
        runtimeMs,
      },
    })

    return NextResponse.json({
      success: true,
      runId: analysisRun.id,
      results,
    })
  } catch (error) {
    console.error('Analysis failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
