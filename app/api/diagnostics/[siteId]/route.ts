import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// How many recent rows to pull (covers ~the latest run of each URL on a site).
const SCAN_LIMIT = 400

interface DiagRow {
  url: string
  rendered_at: string
  console_errors: string[]
  failed_requests: { url: string; resourceType: string; reason: string }[]
  content_diff_percentage: number
  missing_seo_elements: { element: string; jsOnly: boolean }[]
  render_succeeded: boolean
  render_time_ms: number | null
}

// Per-URL health score (0–100) from the latest diagnostic for that URL.
function urlHealthScore(r: DiagRow): number {
  let score = 100
  if (!r.render_succeeded) score -= 40
  score -= Math.min(40, r.content_diff_percentage * 0.4) // content invisible to no-JS bots
  score -= (r.missing_seo_elements?.length ?? 0) * 8 // each missing critical SEO element
  score -= Math.min(10, (r.console_errors?.length ?? 0)) * 2
  score -= Math.min(10, (r.failed_requests?.length ?? 0)) * 2
  return Math.max(0, Math.round(score))
}

// ── GET /api/diagnostics/:siteId ─────────────────────────────────────────────
// Returns the latest diagnostic summary for a site, formatted for the dashboard:
// overall health score, URLs with issues, content diff %, and top errors.
export async function GET(req: NextRequest, ctx: { params: Promise<{ siteId: string }> }) {
  try {
    const uid = req.headers.get('x-user-id')
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const { siteId } = await ctx.params

    // Ownership check — user can only read diagnostics for their own site.
    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id, domain')
      .eq('id', siteId)
      .eq('user_id', uid)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const { data: rows } = await supabaseAdmin
      .from('render_diagnostics')
      .select(
        'url, rendered_at, console_errors, failed_requests, content_diff_percentage, missing_seo_elements, render_succeeded, render_time_ms'
      )
      .eq('site_id', siteId)
      .order('rendered_at', { ascending: false })
      .limit(SCAN_LIMIT)

    const all = (rows ?? []) as DiagRow[]

    // Keep only the most-recent diagnostic per URL (rows already sorted desc).
    const latestByUrl = new Map<string, DiagRow>()
    for (const r of all) if (!latestByUrl.has(r.url)) latestByUrl.set(r.url, r)
    const latest = [...latestByUrl.values()]

    if (latest.length === 0) {
      return NextResponse.json({
        domain: site.domain,
        healthScore: null,
        urlsChecked: 0,
        urlsWithIssues: [],
        topErrors: [],
        message: 'No diagnostics yet — they are captured the next time a crawler triggers a render.',
      })
    }

    // Per-URL scores → overall health score (average).
    const scored = latest.map((r) => ({
      url: r.url,
      score: urlHealthScore(r),
      contentDiffPercentage: r.content_diff_percentage,
      renderSucceeded: r.render_succeeded,
      renderTimeMs: r.render_time_ms,
      missingSeoElements: (r.missing_seo_elements ?? []).map((m) => m.element),
      consoleErrorCount: r.console_errors?.length ?? 0,
      failedRequestCount: r.failed_requests?.length ?? 0,
      renderedAt: r.rendered_at,
    }))

    const healthScore = Math.round(scored.reduce((s, u) => s + u.score, 0) / scored.length)

    // URLs that need attention, worst first.
    const urlsWithIssues = scored
      .filter(
        (u) =>
          u.score < 90 ||
          u.contentDiffPercentage > 20 ||
          u.consoleErrorCount > 0 ||
          u.failedRequestCount > 0 ||
          !u.renderSucceeded
      )
      .sort((a, b) => a.score - b.score)

    // Aggregate the most frequent console errors across all URLs.
    const errCounts = new Map<string, number>()
    for (const r of latest) {
      for (const e of r.console_errors ?? []) {
        errCounts.set(e, (errCounts.get(e) ?? 0) + 1)
      }
    }
    const topErrors = [...errCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([message, count]) => ({ message, count }))

    return NextResponse.json({
      domain: site.domain,
      healthScore,
      urlsChecked: scored.length,
      urlsWithIssues,
      topErrors,
    })
  } catch (e) {
    console.error('[DIAGNOSTICS_GET]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
