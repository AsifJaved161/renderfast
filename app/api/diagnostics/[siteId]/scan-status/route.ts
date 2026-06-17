import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { reclaimIfStale } from '@/lib/diagnostics-worker'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/diagnostics/:siteId/scan-status ─────────────────────────────────
// Returns the most recent scan job for the site so the Re-scan button can poll
// "Queued → Scanning 4/15 → Done". Ownership-checked; only ever the caller's data.
export async function GET(req: NextRequest, ctx: { params: Promise<{ siteId: string }> }) {
  try {
    const uid = req.headers.get('x-user-id')
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const { siteId } = await ctx.params

    // Ownership — user can only see jobs for a site they own.
    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id')
      .eq('id', siteId)
      .eq('user_id', uid)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const { data: job } = await supabaseAdmin
      .from('diagnostics_jobs')
      .select('id, status, total_count, done_count, error_message, created_at, started_at, finished_at')
      .eq('site_id', siteId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Stale-job timeout (inline, no cron): if an "active" job has exceeded the
    // threshold, mark it failed so the caller sees a terminal state and can retry.
    if (job && (await reclaimIfStale(job))) {
      job.status = 'failed'
      job.error_message = 'stalled_timeout'
      job.finished_at = new Date().toISOString()
    }

    const active = !!job && (job.status === 'queued' || job.status === 'running')
    return NextResponse.json({ job: job ?? null, active })
  } catch (e) {
    console.error('[DIAGNOSTICS_SCAN_STATUS]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
