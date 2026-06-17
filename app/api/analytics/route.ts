import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY = 86400_000

function dayKey(iso: string) {
  return iso.slice(0, 10) // YYYY-MM-DD
}

export async function GET(req: NextRequest) {
  try {
  const uid = req.headers.get('x-user-id')
  if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const siteId = searchParams.get('site_id')
  const botType = searchParams.get('bot_type')
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(200, parseInt(searchParams.get('limit') ?? '50', 10))
  const endDate = searchParams.get('end_date') ?? new Date().toISOString()
  const startDate =
    searchParams.get('start_date') ?? new Date(Date.now() - 30 * DAY).toISOString()

  // ── Fetch renders ───────────────────────────────────────────────────────────
  let rq = supabaseAdmin
    .from('renders')
    .select('*')
    .eq('user_id', uid)
    .gte('created_at', startDate)
    .lte('created_at', endDate)
    .order('created_at', { ascending: false })
  if (siteId) rq = rq.eq('site_id', siteId)
  if (botType) rq = rq.eq('bot_type', botType)
  const { data: renders = [] } = await rq

  // ── Fetch bot visits ────────────────────────────────────────────────────────
  let bq = supabaseAdmin
    .from('bot_visits')
    .select('*')
    .gte('created_at', startDate)
    .lte('created_at', endDate)
    .order('created_at', { ascending: false })
  if (siteId) bq = bq.eq('site_id', siteId)
  if (botType) bq = bq.eq('bot_type', botType)
  const { data: visits = [] } = await bq

  // ── Usage stats (always real) ────────────────────────────────────────────────
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('render_count, render_limit, monthly_reset_at')
    .eq('id', uid)
    .single()

  const usageStats = {
    renderCount: user?.render_count ?? 0,
    renderLimit: user?.render_limit ?? 1000,
    percentUsed: user?.render_limit
      ? Math.min(100, Math.round((user.render_count / user.render_limit) * 100))
      : 0,
    resetAt: user?.monthly_reset_at ?? new Date(Date.now() + 30 * DAY).toISOString(),
  }

  // ── No real data yet → return seed structure ─────────────────────────────────
  if ((renders?.length ?? 0) === 0 && (visits?.length ?? 0) === 0) {
    return NextResponse.json(demoResponse(usageStats))
  }

  const allRenders = renders ?? []
  const allVisits = visits ?? []

  // ── Summary ──────────────────────────────────────────────────────────────────
  const totalBotRequests = allVisits.length
  const uniqueUrls = new Set([...allVisits, ...allRenders].map((r: any) => r.url)).size
  const cacheHits = allRenders.filter((r: any) => r.cache_hit).length
  const cacheHitRate = allRenders.length
    ? Math.round((cacheHits / allRenders.length) * 100)
    : 0
  const timed = allRenders.filter((r: any) => r.render_time_ms != null)
  const avgResponseTime = timed.length
    ? Math.round(timed.reduce((s: number, r: any) => s + r.render_time_ms, 0) / timed.length)
    : 0

  const summary = {
    totalBotRequests,
    uniqueUrls,
    cacheHitRate,
    avgResponseTime,
    totalRenders: allRenders.length,
  }

  // ── Bot timeline (per day, grouped bot buckets) ──────────────────────────────
  const timelineMap = new Map<
    string,
    { date: string; googlebot: number; gptbot: number; bingbot: number; others: number }
  >()
  for (const v of allVisits) {
    const d = dayKey(v.created_at)
    const row =
      timelineMap.get(d) ?? { date: d, googlebot: 0, gptbot: 0, bingbot: 0, others: 0 }
    const name = (v.bot_name ?? '').toLowerCase()
    if (name.includes('google')) row.googlebot++
    else if (name.includes('gpt')) row.gptbot++
    else if (name.includes('bing')) row.bingbot++
    else row.others++
    timelineMap.set(d, row)
  }
  const botTimeline = [...timelineMap.values()].sort((a, b) => a.date.localeCompare(b.date))

  // ── Top crawlers ─────────────────────────────────────────────────────────────
  const crawlerCount = new Map<string, number>()
  for (const v of allVisits) {
    const n = v.bot_name ?? 'Unknown'
    crawlerCount.set(n, (crawlerCount.get(n) ?? 0) + 1)
  }
  const topCrawlers = [...crawlerCount.entries()]
    .map(([botName, requests]) => ({
      botName,
      requests,
      percentage: totalBotRequests ? Math.round((requests / totalBotRequests) * 100) : 0,
    }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 10)

  // ── Bot type split ───────────────────────────────────────────────────────────
  const botTypeSplit = { search: 0, ai: 0, social: 0, unknown: 0 }
  for (const v of allVisits) {
    const t = (v.bot_type ?? 'unknown') as keyof typeof botTypeSplit
    botTypeSplit[t in botTypeSplit ? t : 'unknown']++
  }

  // ── Top pages ────────────────────────────────────────────────────────────────
  const pageMap = new Map<
    string,
    { url: string; hits: number; bots: Set<string>; lastCrawled: string; cacheHit: boolean }
  >()
  for (const v of allVisits) {
    const row =
      pageMap.get(v.url) ??
      { url: v.url, hits: 0, bots: new Set<string>(), lastCrawled: v.created_at, cacheHit: false }
    row.hits++
    if (v.bot_name) row.bots.add(v.bot_name)
    if (v.created_at > row.lastCrawled) row.lastCrawled = v.created_at
    pageMap.set(v.url, row)
  }
  for (const r of allRenders) {
    const row = pageMap.get(r.url)
    if (row && r.cache_hit) row.cacheHit = true
  }
  const topPages = [...pageMap.values()]
    .map((p) => ({
      url: p.url,
      hits: p.hits,
      uniqueBots: p.bots.size,
      lastCrawled: p.lastCrawled,
      cacheHit: p.cacheHit,
    }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 10)

  // ── Render history (paginated) ───────────────────────────────────────────────
  const renderHistory = allRenders
    .slice((page - 1) * limit, page * limit)
    .map((r: any) => ({
      timestamp: r.created_at,
      url: r.url,
      botName: r.bot_name,
      botType: r.bot_type,
      cacheHit: r.cache_hit,
      statusCode: r.status_code,
      responseTime: r.render_time_ms,
      userAgent: r.user_agent,
    }))

  // ── Render trend (per day) ───────────────────────────────────────────────────
  const trendMap = new Map<string, { date: string; renders: number; cacheHits: number }>()
  for (const r of allRenders) {
    const d = dayKey(r.created_at)
    const row = trendMap.get(d) ?? { date: d, renders: 0, cacheHits: 0 }
    row.renders++
    if (r.cache_hit) row.cacheHits++
    trendMap.set(d, row)
  }
  const renderTrend = [...trendMap.values()].sort((a, b) => a.date.localeCompare(b.date))

  return NextResponse.json({
    summary,
    botTimeline,
    topCrawlers,
    botTypeSplit,
    topPages,
    renderHistory,
    renderTrend,
    usageStats,
  })
  } catch (error) {
    console.error('[ANALYTICS_GET]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── Demo/seed structure when there is no data yet ──────────────────────────────
function demoResponse(usageStats: any) {
  const today = new Date()
  const days = Array.from({ length: 7 }, (_, i) =>
    new Date(today.getTime() - (6 - i) * DAY).toISOString().slice(0, 10)
  )
  return {
    summary: {
      totalBotRequests: 0,
      uniqueUrls: 0,
      cacheHitRate: 0,
      avgResponseTime: 0,
      totalRenders: 0,
    },
    botTimeline: days.map((date) => ({ date, googlebot: 0, gptbot: 0, bingbot: 0, others: 0 })),
    topCrawlers: [],
    botTypeSplit: { search: 0, ai: 0, social: 0, unknown: 0 },
    topPages: [],
    renderHistory: [],
    renderTrend: days.map((date) => ({ date, renders: 0, cacheHits: 0 })),
    usageStats,
    demo: true,
  }
}
