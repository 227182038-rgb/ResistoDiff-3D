import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { DEMO_DIFFUSION_CANDIDATES } from '@/lib/resistodiff-data'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const analysisId = searchParams.get('analysisId') ?? ''

    if (analysisId) {
      // Fetch diffusion results for a specific analysis run
      const dbResults = await db.diffusionResult.findMany({
        where: { analysisId },
        orderBy: { createdAt: 'desc' },
      })

      if (dbResults.length > 0) {
        const results = dbResults.map((d) => ({
          id: d.id,
          smiles: d.generatedSmiles,
          qedScore: d.qedScore,
          saScore: d.saScore,
          lipinskiViolations: d.lipinskiViolations,
          mw: d.mw,
          logP: d.logP,
          hbd: d.hbd,
          hba: d.hba,
          tpsa: d.tpsa,
          pocketId: d.pocketId,
          iterations: d.iterations,
        }))
        return NextResponse.json(results)
      }
    }

    // No specific analysisId or no DB results - fetch recent ASE3DIFF runs
    const recentRuns = await db.analysisRun.findMany({
      where: {
        module: 'ASE3DIFF',
        status: 'completed',
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
      include: {
        diffusionResults: {
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (recentRuns.length > 0 && recentRuns[0].diffusionResults.length > 0) {
      const results = recentRuns[0].diffusionResults.map((d) => ({
        id: d.id,
        smiles: d.generatedSmiles,
        qedScore: d.qedScore,
        saScore: d.saScore,
        lipinskiViolations: d.lipinskiViolations,
        mw: d.mw,
        logP: d.logP,
        hbd: d.hbd,
        hba: d.hba,
        tpsa: d.tpsa,
        pocketId: d.pocketId,
        iterations: d.iterations,
      }))
      return NextResponse.json(results)
    }

    // Fall back to demo diffusion candidates
    return NextResponse.json(DEMO_DIFFUSION_CANDIDATES)
  } catch (error) {
    console.error('Failed to fetch diffusion results:', error)

    // Fall back to demo data on DB error
    return NextResponse.json(DEMO_DIFFUSION_CANDIDATES)
  }
}
