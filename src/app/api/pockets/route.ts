import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { DEMO_POCKETS } from '@/lib/resistodiff-data'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const proteinId = searchParams.get('proteinId') ?? 'tem1'

    // Try to find pocket results from recent DAPM analysis runs in the database
    const analysisRuns = await db.analysisRun.findMany({
      where: {
        proteinId,
        module: 'DAPM',
        status: 'completed',
      },
      orderBy: { createdAt: 'desc' },
      take: 1,
      include: {
        pockets: true,
      },
    })

    const latestRun = analysisRuns[0]

    if (latestRun && latestRun.pockets.length > 0) {
      // Return DB pocket data in the frontend-friendly format
      const results = latestRun.pockets.map((p) => ({
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
      return NextResponse.json(results)
    }

    // Fall back to demo pocket data
    const demoPockets = DEMO_POCKETS[proteinId] ?? DEMO_POCKETS['tem1'] ?? []
    return NextResponse.json(demoPockets)
  } catch (error) {
    console.error('Failed to fetch pocket results:', error)

    // Fall back to demo data on DB error
    const proteinId = new URL(request.url).searchParams.get('proteinId') ?? 'tem1'
    const demoPockets = DEMO_POCKETS[proteinId] ?? DEMO_POCKETS['tem1'] ?? []
    return NextResponse.json(demoPockets)
  }
}
