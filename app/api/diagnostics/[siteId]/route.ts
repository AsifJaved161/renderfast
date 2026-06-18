import { NextRequest, NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { isRenderConfigured } from '@/lib/renderer'
import { processDiagnosticsJob, isUrlOnDomain, reclaimIfStale } from '@/lib/diagnostics-worker'
import { getOpsConfig } from '@/lib/app-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// How many recent rows to pull (covers ~the latest run of each URL on a site).
const SCAN_LIMIT = 400
// Re-scan caps.
const RESCAN_COOLDOWN_MS = 10 * 60 * 1000 // 1 scan per site / 10 min
const MAX_ACTIVE_JOBS_PER_USER = 3 // cap concurrent/pending jobs across all sites

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

    // Total pages we've ever rendered for this domain (denominator for "X of Y").
    const { count: totalRendered } = await supabaseAdmin
      .from('cache_entries')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)

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
        totalRendered: totalRendered ?? 0,
        urlsWithIssues: [],
        topErrors: [],
        message: 'No diagnostics yet — click Re-scan to render this domain’s URLs and analyse them.',
      })
    }

    // Per-URL scores → overall health score (average). Raw error arrays are
    // included so the dashboard accordion can show full detail on expand.
    const scored = latest.map((r) => ({
      url: r.url,
      score: urlHealthScore(r),
      contentDiffPercentage: r.content_diff_percentage,
      renderSucceeded: r.render_succeeded,
      renderTimeMs: r.render_time_ms,
      missingSeoElements: (r.missing_seo_elements ?? []).map((m) => m.element),
      consoleErrors: r.console_errors ?? [],
      failedRequests: r.failed_requests ?? [],
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
      totalRendered: totalRendered ?? scored.length,
      urlsWithIssues,
      topErrors,
    })
  } catch (e) {
    console.error('[DIAGNOSTICS_GET]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── POST /api/diagnostics/:siteId — enqueue a re-scan (does NOT render) ───────
// Validates ownership/quota/rate-limits, builds a SSRF-safe URL list, creates a
// job row, kicks the worker off in the background, and returns immediately.
export async function POST(req: NextRequest, ctx: { params: Promise<{ siteId: string }> }) {
  try {
    const uid = req.headers.get('x-user-id')
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const { siteId } = await ctx.params

    // 0) Rendering must be configured — otherwise renderPage() returns a stub,
    //    which would burn render quota and store misleading diagnostics.
    if (!(await isRenderConfigured())) {
      return NextResponse.json(
        { error: 'Rendering isn’t configured yet. Connect Cloudflare to enable diagnostics scans (see CLOUDFLARE_SETUP.md).' },
        { status: 503 }
      )
    }

    // 1) Ownership — identical to the GET endpoint; not bypassable (uid comes
    //    from the verified session via middleware, never from the client).
    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id, domain')
      .eq('id', siteId)
      .eq('user_id', uid)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    // 2) Dedupe — if a job for this site is already queued/running, return it
    //    instead of creating another (the real protection against double-submits).
    //    BUT first check staleness: a "running" job whose worker died is reclaimed
    //    (marked failed) so it no longer blocks a fresh scan.
    const { data: active } = await supabaseAdmin
      .from('diagnostics_jobs')
      .select('id, status, total_count, done_count, created_at, started_at')
      .eq('site_id', siteId)
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (active && !(await reclaimIfStale(active))) {
      // Genuinely active (not stale) → block and return the in-flight job.
      return NextResponse.json({ job: active, deduped: true }, { status: 200 })
    }
    // If it was stale, reclaimIfStale() marked it failed → fall through and enqueue.

    // 3) Per-user cap — limit concurrent/pending jobs across ALL their sites.
    const { count: activeForUser } = await supabaseAdmin
      .from('diagnostics_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uid)
      .in('status', ['queued', 'running'])
    if ((activeForUser ?? 0) >= MAX_ACTIVE_JOBS_PER_USER) {
      return NextResponse.json(
        { error: `Too many active scans (max ${MAX_ACTIVE_JOBS_PER_USER}). Wait for them to finish.` },
        { status: 429 }
      )
    }

    // 4) Per-site cooldown — at most one scan per site per RESCAN_COOLDOWN_MS.
    //    Stale-reclaimed jobs (stalled_timeout) are ignored: the worker died and
    //    produced no results, so they must not impose a cooldown on the retry.
    const { data: lastJob } = await supabaseAdmin
      .from('diagnostics_jobs')
      .select('finished_at, created_at, error_message')
      .eq('site_id', siteId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const lastCounts = !!lastJob && lastJob.error_message !== 'stalled_timeout'
    const lastAt = lastJob ? new Date(lastJob.finished_at ?? lastJob.created_at).getTime() : 0
    const waitMs = RESCAN_COOLDOWN_MS - (Date.now() - lastAt)
    if (lastCounts && waitMs > 0) {
      return NextResponse.json(
        { error: `Recently scanned. Try again in ${Math.ceil(waitMs / 60000)} min.`, retryAfterMs: waitMs },
        { status: 429 }
      )
    }

    // 5) Quota — block if already over the monthly render limit (no free bypass).
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('render_count, render_limit')
      .eq('id', uid)
      .maybeSingle()
    if (user && user.render_limit > 0 && user.render_count >= user.render_limit) {
      return NextResponse.json({ error: 'Monthly render limit reached. Upgrade your plan.' }, { status: 403 })
    }

    // 6) Build the URL list (our own DB rows) and SSRF-filter to the site domain.
    //    The per-scan cap is admin-configurable (Platform Settings → render queue).
    const { maxRescanUrls } = await getOpsConfig()
    let urls: string[] = []
    const { data: cached } = await supabaseAdmin
      .from('cache_entries')
      .select('url')
      .eq('site_id', siteId)
      .order('cached_at', { ascending: false })
      .limit(maxRescanUrls * 2)
    urls = (cached ?? []).map((r: { url: string }) => r.url)

    if (urls.length === 0) {
      const { data: queued } = await supabaseAdmin
        .from('caching_queue')
        .select('url')
        .eq('site_id', siteId)
        .limit(maxRescanUrls * 2)
      urls = (queued ?? []).map((r: { url: string }) => r.url)
    }

    urls = Array.from(new Set(urls.filter((u) => isUrlOnDomain(u, site.domain)))).slice(0, maxRescanUrls)

    if (urls.length === 0) {
      return NextResponse.json({
        error: 'No URLs to scan yet — add the domain’s sitemap from the Sitemaps page first.',
      }, { status: 400 })
    }

    // 7) Create the job and kick the worker off in the background.
    const { data: job, error } = await supabaseAdmin
      .from('diagnostics_jobs')
      .insert({
        site_id: siteId,
        user_id: uid,
        urls,
        status: 'queued',
        total_count: urls.length,
        done_count: 0,
      })
      .select('id, status, total_count, done_count, created_at')
      .single()
    if (error || !job) {
      // 23505 = the partial-unique index fired → a concurrent request already
      // created an active job for this site. Return that one (race-proof dedupe).
      if ((error as { code?: string } | null)?.code === '23505') {
        const { data: existing } = await supabaseAdmin
          .from('diagnostics_jobs')
          .select('id, status, total_count, done_count, created_at')
          .eq('site_id', siteId)
          .in('status', ['queued', 'running'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (existing) return NextResponse.json({ job: existing, deduped: true }, { status: 200 })
      }
      return NextResponse.json({ error: error?.message ?? 'Failed to enqueue scan' }, { status: 500 })
    }

    after(() => processDiagnosticsJob(job.id))

    return NextResponse.json({ job }, { status: 202 })
  } catch (e) {
    console.error('[DIAGNOSTICS_POST]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
