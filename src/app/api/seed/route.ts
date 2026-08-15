import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PROTEIN_TARGETS } from '@/lib/resistodiff-data'

export async function POST() {
  try {
    let count = 0

    for (const target of PROTEIN_TARGETS) {
      // Upsert to avoid duplicates on re-seed
      await db.proteinTarget.upsert({
        where: { id: target.id },
        update: {
          name: target.name,
          uniprotId: target.uniprotId,
          pdbId: target.pdbId,
          geneName: target.geneName,
          organism: target.organism,
          targetClass: target.targetClass,
          sequenceLength: target.sequenceLength,
          description: target.description,
        },
        create: {
          id: target.id,
          name: target.name,
          uniprotId: target.uniprotId,
          pdbId: target.pdbId,
          geneName: target.geneName,
          organism: target.organism,
          targetClass: target.targetClass,
          sequenceLength: target.sequenceLength,
          description: target.description,
        },
      })
      count++
    }

    return NextResponse.json({ success: true, count })
  } catch (error) {
    console.error('Failed to seed database:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to seed database',
      },
      { status: 500 }
    )
  }
}
