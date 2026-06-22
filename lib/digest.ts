// ─────────────────────────────────────────────────────────────────────────────
// Email digest builder — aggregates a user's EXISTING data (renders, diagnostics,
// bot traffic) into the few headline numbers shown in the periodic email. Pure
// read-only; reuses getBotCostSummary. No new data is produced.
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseAdmin } from '@/lib/supabase'
import { getBotCostSummary } from '@/lib/bot-cost'

export interface UserDigest {
  days: number
  siteCount: number
  botRequests: number
  cacheHitRate: number // %
  healthScore: number | null // "Bot Visibility Score" (avg page health)
  aiCitation: number | null // AI Citation Readiness (avg %)
  costUsd: number // estimated bot-bandwidth cost handled this period
  hasActivity: boolean
}

// Same per-URL health formula the Bot Visibility page/API uses (kept in sync).
function urlHealthScore(r: {
  render_succeeded: boolean
  content_diff_percentage: number
  missing_seo_elements?: unknown[] | null
  console_errors?: unknown[] | null
  failed_requests?: unknown[] | null
}): number {
  let score = 100
  if (!r.render_succeeded) score -= 40
  score -= Math.min(40, (r.content_diff_percentage ?? 0) * 0.4)
  score -= (r.missing_seo_elements?.length ?? 0) * 8
  score -= Math.min(10, r.console_errors?.length ?? 0) * 2
  score -= Math.min(10, r.failed_requests?.length ?? 0) * 2
  return Math.max(0, Math.round(score))
}

export async function buildUserDigest(userId: string, days = 7): Promise<UserDigest | null> {
  const fromISO = new Date(Date.now() - days * 86400_000).toISOString()
  const fromDay = fromISO.slice(0, 10)
  const toDay = new Date().toISOString().slice(0, 10)

  const { data: sites } = await supabaseAdmin.from('sites').select('id').eq('user_id', userId)
  const siteIds = (sites ?? []).map((s) => s.id)
  if (siteIds.length === 0) return null

  // Bot requests + cache hit rate this period.
  const { data: renders } = await supabaseAdmin
    .from('renders')
    .select('cache_hit')
    .eq('user_id', userId)
    .gte('created_at', fromISO)
  const botRequests = renders?.length ?? 0
  const hits = (renders ?? []).filter((r) => r.cache_hit).length
  const cacheHitRate = botRequests ? Math.round((hits / botRequests) * 100) : 0

  // Health + AI citation from the latest diagnostic per URL.
  const { data: diag } = await supabaseAdmin
    .from('render_diagnostics')
    .select('url, rendered_at, render_succeeded, content_diff_percentage, missing_seo_elements, console_errors, failed_requests, ai_citation_score')
    .in('site_id', siteIds)
    .order('rendered_at', { ascending: false })
    .limit(400)
  const diagRows = diag ?? []
  const latestByUrl = new Map<string, (typeof diagRows)[number]>()
  for (const r of diagRows) if (!latestByUrl.has(r.url)) latestByUrl.set(r.url, r)
  const latest = [...latestByUrl.values()]
  const healthScore = latest.length
    ? Math.round(latest.reduce((s, r) => s + urlHealthScore(r), 0) / latest.length)
    : null
  const aiScores = latest.map((r) => r.ai_citation_score).filter((n): n is number => typeof n === 'number')
  const aiCitation = aiScores.length ? Math.round(aiScores.reduce((a, b) => a + b, 0) / aiScores.length) : null

  // Estimated bot-bandwidth cost handled this period (sum across sites).
  let costUsd = 0
  for (const id of siteIds) {
    try {
      const sum = await getBotCostSummary(id, { from: fromDay, to: toDay })
      costUsd += sum.totals.estimatedCostUsd
    } catch {
      /* ignore a single site's failure */
    }
  }
  costUsd = Math.round(costUsd * 100) / 100

  const hasActivity = botRequests > 0 || latest.length > 0 || costUsd > 0
  return {
    days,
    siteCount: siteIds.length,
    botRequests,
    cacheHitRate,
    healthScore,
    aiCitation,
    costUsd,
    hasActivity,
  }
}
