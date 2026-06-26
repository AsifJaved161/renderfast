import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY = 86400_000

// Shape returned by the get_analytics_overview SQL function (migration 019).
interface AnalyticsOverview {
  summary: {
    totalBotRequests: number
    totalRenders: number
    uniqueUrls: number
    cacheHitRate: number
    avgResponseTime: number
    avgCacheServeTime: number
    avgRenderTime: number
  }
  renderTrend: { date: string; renders: number; cacheHits: number }[]
  botTimeline: { date: string; googlebot: number; gptbot: number; bingbot: number; others: number }[]
  botTypeSplit: { search: number; ai: number; social: number; unknown: number }
  topPages: { url: string; hits: number; uniqueBots: number; lastCrawled: string; cacheHit: boolean }[]
  topCrawlers: { botName: string; requests: number; percentage: number }[]
  statusSplit: { code: string; hits: number }[]
  responseByStatus: { code: string; avgMs: number }[]
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
    const startDate = searchParams.get('start_date') ?? new Date(Date.now() - 30 * DAY).toISOString()

    // Ownership: a requested site_id is honoured only if the user owns it. (The
    // SQL function re-scopes too, but this returns zeroed usage without leaking
    // the account's real figures for a site they don't own.)
    if (siteId) {
      const { data: owned } = await supabaseAdmin
        .from('sites')
        .select('id')
        .eq('id', siteId)
        .eq('user_id', uid)
        .maybeSingle()
      if (!owned) return NextResponse.json(emptyResponse(zeroUsage()))
    }

    // Paginated render history list — bounded by range/limit (no longer fetches
    // every row just to slice one page).
    let hq = supabaseAdmin
      .from('renders')
      .select('created_at, url, bot_name, bot_type, cache_hit, status_code, render_time_ms, user_agent')
      .eq('user_id', uid)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)
    if (siteId) hq = hq.eq('site_id', siteId)
    if (botType) hq = hq.eq('bot_type', botType)

    // Aggregation (SQL — returns only small rolled-up results), usage stats and
    // the history page, all in parallel.
    const [{ data: overview }, { data: user }, { data: historyRows }] = await Promise.all([
      supabaseAdmin.rpc('get_analytics_overview', {
        p_uid: uid,
        p_site_id: siteId,
        p_bot_type: botType,
        p_start: startDate,
        p_end: endDate,
      }),
      supabaseAdmin
        .from('users')
        .select('render_count, render_limit, monthly_reset_at')
        .eq('id', uid)
        .single(),
      hq,
    ])

    const usageStats = {
      renderCount: user?.render_count ?? 0,
      renderLimit: user?.render_limit ?? 1000,
      percentUsed: user?.render_limit
        ? Math.min(100, Math.round((user.render_count / user.render_limit) * 100))
        : 0,
      resetAt: user?.monthly_reset_at ?? new Date(Date.now() + 30 * DAY).toISOString(),
    }

    const o = overview as AnalyticsOverview | null

    // No activity yet → zeroed skeleton (keeps the charts from looking broken).
    if (!o || (o.summary.totalRenders === 0 && o.summary.totalBotRequests === 0)) {
      return NextResponse.json(emptyResponse(usageStats))
    }

    const renderHistory = (historyRows ?? []).map((r: any) => ({
      timestamp: r.created_at,
      url: r.url,
      botName: r.bot_name,
      botType: r.bot_type,
      cacheHit: r.cache_hit,
      statusCode: r.status_code,
      responseTime: r.render_time_ms,
      userAgent: r.user_agent,
    }))

    return NextResponse.json({
      summary: o.summary,
      botTimeline: o.botTimeline,
      topCrawlers: o.topCrawlers,
      botTypeSplit: o.botTypeSplit,
      topPages: o.topPages,
      renderHistory,
      renderTrend: o.renderTrend,
      statusSplit: o.statusSplit ?? [],
      responseByStatus: o.responseByStatus ?? [],
      usageStats,
    })
  } catch (error) {
    console.error('[ANALYTICS_GET]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Zeroed usage block — used when the requested site isn't owned by the user, so
// no per-account figures are revealed.
function zeroUsage() {
  return {
    renderCount: 0,
    renderLimit: 1000,
    percentUsed: 0,
    resetAt: new Date(Date.now() + 30 * DAY).toISOString(),
  }
}

// ── Zeroed structure when there is no data yet (real, not fake) ────────────────
function emptyResponse(usageStats: any) {
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
      avgCacheServeTime: 0,
      avgRenderTime: 0,
      totalRenders: 0,
    },
    botTimeline: days.map((date) => ({ date, googlebot: 0, gptbot: 0, bingbot: 0, others: 0 })),
    topCrawlers: [],
    botTypeSplit: { search: 0, ai: 0, social: 0, unknown: 0 },
    topPages: [],
    renderHistory: [],
    renderTrend: days.map((date) => ({ date, renders: 0, cacheHits: 0 })),
    statusSplit: [],
    responseByStatus: [],
    usageStats,
  }
}
