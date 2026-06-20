import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { recheckSitemap } from '@/lib/sitemap'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_PER_CRON = 10

// ── GET — Vercel Cron: re-check every sitemap that is "due" per its interval ──
// Fires daily; a sitemap is processed only once its check_interval_days elapse.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: rows } = await supabaseAdmin
    .from('sitemaps')
    .select('site_id, user_id, last_crawled_at, check_interval_days, sites(domain)')
    .order('last_crawled_at', { ascending: true, nullsFirst: true })
    .limit(100)

  const now = Date.now()
  let processed = 0
  let queued = 0

  for (const s of (rows ?? []) as any[]) {
    if (processed >= MAX_PER_CRON) break
    const intervalMs = (s.check_interval_days ?? 5) * 86400_000
    const due = !s.last_crawled_at || now - new Date(s.last_crawled_at).getTime() >= intervalMs
    if (!due) continue
    const domain = s.sites?.domain
    if (!domain) continue
    try {
      const r = await recheckSitemap(s.site_id, s.user_id, domain)
      queued += r.queued
      processed++
    } catch (e) {
      console.error('[SITEMAP_RECHECK_CRON]:', s.site_id, e)
    }
  }

  return NextResponse.json({ processed, queued })
}

// ── POST — user "Check now" (and optionally save the re-check interval) ───────
export async function POST(req: NextRequest) {
  try {
    const uid = req.headers.get('x-user-id')
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const { site_id, interval_days } = await req.json().catch(() => ({}))
    if (!site_id) return NextResponse.json({ error: 'site_id required' }, { status: 400 })

    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('domain')
      .eq('id', site_id)
      .eq('user_id', uid)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    // Save a new interval (1–90 days) if provided.
    if (typeof interval_days === 'number' && interval_days >= 1 && interval_days <= 90) {
      await supabaseAdmin
        .from('sitemaps')
        .update({ check_interval_days: Math.round(interval_days) })
        .eq('site_id', site_id)
    }

    const result = await recheckSitemap(site_id, uid, site.domain)
    return NextResponse.json(result)
  } catch (e) {
    console.error('[SITEMAP_RECHECK_POST]:', e)
    return NextResponse.json({ error: 'Re-check failed' }, { status: 500 })
  }
}
