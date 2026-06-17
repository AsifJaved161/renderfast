import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/gsc — connection status (placeholder) ───────────────────────────
export async function GET() {
  try {
    return NextResponse.json({ connected: false, message: 'GSC not connected' })
  } catch (error) {
    console.error('[GSC_GET]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── POST /api/gsc — OAuth initiation (placeholder) ───────────────────────────
export async function POST() {
  try {
    return NextResponse.json(
      { message: 'Google Search Console integration coming soon' },
      { status: 501 }
    )
  } catch (error) {
    console.error('[GSC_POST]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
