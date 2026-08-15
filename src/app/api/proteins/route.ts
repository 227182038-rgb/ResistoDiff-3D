import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PROTEIN_TARGETS } from '@/lib/resistodiff-data'

export async function GET() {
  try {
    const proteins = await db.proteinTarget.findMany({
      orderBy: { createdAt: 'asc' },
    })

    // If database is empty, fall back to demo data
    if (proteins.length === 0) {
      return NextResponse.json(PROTEIN_TARGETS)
    }

    return NextResponse.json(proteins)
  } catch (error) {
    console.error('Failed to fetch protein targets:', error)
    // Fall back to demo data on any DB error
    return NextResponse.json(PROTEIN_TARGETS)
  }
}
