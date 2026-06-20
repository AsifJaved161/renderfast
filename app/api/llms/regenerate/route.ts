import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateAndStoreLlmsTxt } from '@/lib/llms-txt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Per-run cap so a single cron invocation stays within the function time limit.
const MAX_PER_CRON = 25
// Regenerate a site's llms.txt at most this often (weekly). The cron can fire
// more frequently than this; each site is only refreshed once its content ages
// past the interval — simple, self-pacing, no real-time regeneration needed.
const REGEN_INTERVAL_MS = 7 * 86400_000

// ── GET — Vercel Cron: regenerate stale llms.txt for active sites ────────────
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Active sites + their current cache state (one query each, then mapped).
  const { data: sites } = await supabaseAdmin
    .from('sites')
    .select('id')
    .eq('status', 'active')
    .limit(1000)

  const { data: caches } = await supabaseAdmin
    .from('llms_txt_cache')
    .select('site_id, generated_at, auto_enabled')

  const cacheBySite = new Map((caches ?? []).map((c) => [c.site_id, c]))
  const now = Date.now()

  let processed = 0
  let skipped = 0

  for (const s of sites ?? []) {
    if (processed >= MAX_PER_CRON) break
    const c = cacheBySite.get(s.id)

    // Site opted out of auto-serving → never regenerate.
    if (c && c.auto_enabled === false) {
      skipped++
      continue
    }

    // Fresh enough → leave it. (No row, or aged past the interval → regenerate.)
    const stale = !c || !c.generated_at || now - new Date(c.generated_at).getTime() >= REGEN_INTERVAL_MS
    if (!stale) {
      skipped++
      continue
    }

    try {
      await generateAndStoreLlmsTxt(s.id)
      processed++
    } catch (e) {
      console.error('[LLMS_REGEN_CRON]:', s.id, e)
    }
  }

  return NextResponse.json({ processed, skipped })
}
