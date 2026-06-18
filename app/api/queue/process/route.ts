import { NextRequest, NextResponse } from 'next/server'
import { drainQueue } from '@/lib/queue-drain'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ── POST — manual "Process Queue" (logged-in user) or x-cron-secret ──────────
export async function POST(req: NextRequest) {
  const uid = req.headers.get('x-user-id')
  const cronOk = req.headers.get('x-cron-secret') === process.env.CRON_SECRET
  if (!uid && !cronOk) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Scope to the user's own queue when called from the dashboard.
  const result = await drainQueue({ userId: uid ?? undefined, deadlineMs: 45_000, maxUrls: 60 })
  return NextResponse.json(result)
}

// ── GET — Vercel Cron (sends Authorization: Bearer ${CRON_SECRET}) ────────────
// Drains the whole platform queue a chunk at a time, every run.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await drainQueue({ deadlineMs: 50_000, maxUrls: 100 })
  return NextResponse.json(result)
}
