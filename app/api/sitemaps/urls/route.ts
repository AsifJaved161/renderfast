import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Per-site sitemap URLs with their render status. Merges the caching_queue
// (pending/rendering/completed/failed) with cache_entries (HTTP code, timing).
export async function GET(req: NextRequest) {
  try {
    const uid = req.headers.get('x-user-id')
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const { searchParams } = req.nextUrl
    const siteId = searchParams.get('site_id')
    if (!siteId) return NextResponse.json({ error: 'site_id required' }, { status: 400 })

    // Ownership check.
    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id')
      .eq('id', siteId)
      .eq('user_id', uid)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '25', 10))
    const status = searchParams.get('status')

    // Per-status counts for the summary bar.
    const statuses = ['pending', 'rendering', 'completed', 'failed'] as const
    const counts: Record<string, number> = { pending: 0, rendering: 0, completed: 0, failed: 0, total: 0 }
    await Promise.all(
      statuses.map(async (s) => {
        const { count } = await supabaseAdmin
          .from('caching_queue')
          .select('id', { count: 'exact', head: true })
          .eq('site_id', siteId)
          .eq('status', s)
        counts[s] = count ?? 0
      })
    )
    counts.total = counts.pending + counts.rendering + counts.completed + counts.failed

    // Page of queue rows.
    let q = supabaseAdmin
      .from('caching_queue')
      .select('id, url, status, error_message, attempts, created_at, completed_at', { count: 'exact' })
      .eq('site_id', siteId)
      .order('created_at', { ascending: true })
      .range((page - 1) * limit, page * limit - 1)
    if (status) q = q.eq('status', status)
    const { data: rows, count } = await q

    // Cache metadata (status code / render time) for the URLs on this page.
    const pageUrls = (rows ?? []).map((r) => r.url)
    const cacheByUrl = new Map<string, { status_code: number | null; render_time_ms: number | null; cached_at: string }>()
    if (pageUrls.length) {
      const { data: cache } = await supabaseAdmin
        .from('cache_entries')
        .select('url, status_code, render_time_ms, cached_at')
        .eq('site_id', siteId)
        .in('url', pageUrls)
      for (const c of cache ?? []) cacheByUrl.set(c.url, c)
    }

    const urls = (rows ?? []).map((r) => {
      const c = cacheByUrl.get(r.url)
      return {
        id: r.id,
        url: r.url,
        status: r.status as 'pending' | 'rendering' | 'completed' | 'failed',
        statusCode: c?.status_code ?? null,
        renderTimeMs: c?.render_time_ms ?? null,
        cached: !!c,
        error: r.error_message ?? null,
        attempts: r.attempts ?? 0,
        completedAt: r.completed_at ?? null,
      }
    })

    return NextResponse.json({ urls, page, limit, total: count ?? 0, counts })
  } catch (e) {
    console.error('[SITEMAP_URLS]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
