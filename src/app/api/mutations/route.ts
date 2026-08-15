import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { KNOWN_MUTATIONS } from '@/lib/resistodiff-data'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const proteinId = searchParams.get('proteinId') ?? ''
    const limit = parseInt(searchParams.get('limit') ?? '50', 10)

    // Find the protein in the database
    const protein = await db.proteinTarget.findUnique({
      where: proteinId ? { id: proteinId } : undefined,
    })

    // Query mutation results from the database
    const whereClause = protein
      ? {
          analysis: {
            proteinId: protein.id,
            module: 'SEFE',
          },
        }
      : {
          analysis: {
            module: 'SEFE',
          },
        }

    const dbMutations = await db.mutationResult.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    })

    // If database has results, return them
    if (dbMutations.length > 0) {
      return NextResponse.json(dbMutations)
    }

    // Fall back to demo data
    if (proteinId && KNOWN_MUTATIONS[proteinId]) {
      return NextResponse.json(KNOWN_MUTATIONS[proteinId])
    }

    // No data found - return empty array
    return NextResponse.json([])
  } catch (error) {
    console.error('Failed to fetch mutation results:', error)

    // Fall back to demo data on DB error
    const proteinId = new URL(request.url).searchParams.get('proteinId') ?? 'tem1'
    if (KNOWN_MUTATIONS[proteinId]) {
      return NextResponse.json(KNOWN_MUTATIONS[proteinId])
    }

    return NextResponse.json(
      { error: 'Failed to fetch mutation results' },
      { status: 500 }
    )
  }
}
