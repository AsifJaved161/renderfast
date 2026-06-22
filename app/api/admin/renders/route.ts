import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, adminAuthError } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Named-bot filter values map to bot_name substrings; the rest are bot_type categories.
const NAMED_BOTS: Record<string, string> = {
  googlebot: '%google%',
  gptbot: '%gpt%',
  bingbot: '%bing%',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()

    const { searchParams } = req.nextUrl
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '50', 10))
    const userQuery = searchParams.get('user_id')?.trim() // email, name, or raw id
    const domain = searchParams.get('domain')?.trim()
    const cache = searchParams.get('cache') // 'hit' | 'miss'
    const botType = searchParams.get('bot_type')?.trim()
    const start = searchParams.get('start')
    const end = searchParams.get('end')

    // ── Resolve a user filter (email/name → ids) ────────────────────────────────
    // The admin types an EMAIL, but renders.user_id is a UUID — a raw .eq() would
    // throw "invalid input syntax for type uuid". Resolve to ids first; also
    // accept a pasted user id directly.
    let userIdFilter: string[] | null = null
    if (userQuery) {
      const { data: matchedUsers } = await supabaseAdmin
        .from('users')
        .select('id')
        .ilike('email', `%${userQuery}%`)
      const ids = (matchedUsers ?? []).map((u) => u.id)
      if (UUID_RE.test(userQuery) && !ids.includes(userQuery)) ids.push(userQuery)
      userIdFilter = ids
      if (userIdFilter.length === 0) {
        return NextResponse.json({ renders: [], total: 0, page, stats: await platformStats() })
      }
    }

    // ── Resolve a domain filter to a set of site IDs ────────────────────────────
    let siteIdFilter: string[] | null = null
    if (domain) {
      const { data: matchedSites } = await supabaseAdmin
        .from('sites')
        .select('id')
        .ilike('domain', `%${domain}%`)
      siteIdFilter = (matchedSites ?? []).map((s) => s.id)
      // No matching domain → no possible renders; short-circuit.
      if (siteIdFilter.length === 0) {
        return NextResponse.json({ renders: [], total: 0, page, stats: await platformStats() })
      }
    }

    // ── Build the paged renders query ───────────────────────────────────────────
    // Count mode: 'exact' when filtered (small, index-bounded sets → cheap and
    // accurate). Unfiltered, the firehose can be millions of rows, so an exact
    // count per request (×auto-refresh) would scan the whole table — use the
    // planner's 'estimated' count instead.
    const anyFilter = !!(userQuery || domain || cache || botType || start || end)
    let query = supabaseAdmin
      .from('renders')
      .select(
        'id, url, site_id, user_id, bot_name, bot_type, cache_hit, status_code, render_time_ms, created_at',
        { count: anyFilter ? 'exact' : 'estimated' }
      )
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (userIdFilter) query = query.in('user_id', userIdFilter)
    if (siteIdFilter) query = query.in('site_id', siteIdFilter)
    if (cache === 'hit') query = query.eq('cache_hit', true)
    else if (cache === 'miss') query = query.eq('cache_hit', false)
    if (start) query = query.gte('created_at', start)
    if (end) query = query.lte('created_at', end)

    if (botType) {
      if (NAMED_BOTS[botType]) {
        query = query.ilike('bot_name', NAMED_BOTS[botType])
      } else if (botType === 'others') {
        query = query
          .not('bot_name', 'ilike', '%google%')
          .not('bot_name', 'ilike', '%gpt%')
          .not('bot_name', 'ilike', '%bing%')
      } else {
        // search | ai | social | unknown
        query = query.eq('bot_type', botType)
      }
    }

    const { data: rows, count, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // ── Resolve domains + user emails for just this page (batched) ──────────────
    const siteIds = [...new Set((rows ?? []).map((r) => r.site_id).filter(Boolean))]
    const userIds = [...new Set((rows ?? []).map((r) => r.user_id).filter(Boolean))]

    const [{ data: siteRows }, { data: userRows }] = await Promise.all([
      siteIds.length
        ? supabaseAdmin.from('sites').select('id, domain').in('id', siteIds)
        : Promise.resolve({ data: [] as { id: string; domain: string }[] }),
      userIds.length
        ? supabaseAdmin.from('users').select('id, email').in('id', userIds)
        : Promise.resolve({ data: [] as { id: string; email: string }[] }),
    ])

    const domainById = new Map((siteRows ?? []).map((s) => [s.id, s.domain]))
    const emailById = new Map((userRows ?? []).map((u) => [u.id, u.email]))

    const renders = (rows ?? []).map((r) => ({
      id: r.id,
      url: r.url,
      domain: domainById.get(r.site_id) ?? '—',
      user_email: emailById.get(r.user_id) ?? '—',
      bot_name: r.bot_name,
      bot_type: r.bot_type,
      cache_hit: r.cache_hit,
      status_code: r.status_code,
      render_time_ms: r.render_time_ms,
      created_at: r.created_at,
    }))

    return NextResponse.json({
      renders,
      total: count ?? 0,
      page,
      stats: await platformStats(),
    })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ── Platform-wide summary (unfiltered, so the stat cards stay stable) ──────────
async function platformStats() {
  const now = new Date()
  const todayStart = new Date(now.toISOString().slice(0, 10)).toISOString()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const weekStart = new Date(now.getTime() - 7 * 86400_000).toISOString()

  const headCount = async (build?: (q: any) => any) => {
    let q = supabaseAdmin.from('renders').select('id', { count: 'exact', head: true })
    if (build) q = build(q)
    const { count } = await q
    return count ?? 0
  }

  // All counts are date-windowed so they use the created_at index — no
  // full-table scans (important: this runs on every load + 10s auto-refresh).
  // Hit rate is computed over the last 7 days (a meaningful, cheap window).
  const [today, thisMonth, week, weekHits] = await Promise.all([
    headCount((q) => q.gte('created_at', todayStart)),
    headCount((q) => q.gte('created_at', monthStart)),
    headCount((q) => q.gte('created_at', weekStart)),
    headCount((q) => q.gte('created_at', weekStart).eq('cache_hit', true)),
  ])

  const platformHitRate = week ? Math.round((weekHits / week) * 100) : 0

  // Average over the most recent renders (bounded for performance).
  const { data: timed } = await supabaseAdmin
    .from('renders')
    .select('render_time_ms')
    .not('render_time_ms', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1000)
  const times = (timed ?? []).map((r) => r.render_time_ms as number)
  const avgRenderTime = times.length
    ? Math.round(times.reduce((s, t) => s + t, 0) / times.length)
    : 0

  return {
    today,
    this_month: thisMonth,
    platform_hit_rate: platformHitRate,
    avg_render_time: avgRenderTime,
  }
}
