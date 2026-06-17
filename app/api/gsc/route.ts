import { NextRequest, NextResponse } from 'next/server'
import { isGscConfigured, getConnection, deleteConnection } from '@/lib/gsc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/gsc — connection status ─────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const uid = req.headers.get('x-user-id')
    if (!uid) return NextResponse.json({ connected: false })

    if (!isGscConfigured()) {
      return NextResponse.json({ connected: false, configured: false, message: 'GSC OAuth not configured' })
    }

    const conn = await getConnection(uid)
    return NextResponse.json({
      connected: !!conn,
      configured: true,
      email: conn?.google_email ?? null,
    })
  } catch (error) {
    console.error('[GSC_GET]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── DELETE /api/gsc — disconnect ─────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const uid = req.headers.get('x-user-id')
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })
    await deleteConnection(uid)
    return NextResponse.json({ disconnected: true })
  } catch (error) {
    console.error('[GSC_DELETE]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
