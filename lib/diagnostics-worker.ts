// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics scan worker.
//
// There is no long-lived worker process on Vercel, so a job is processed in the
// background via `after()` right after it is enqueued (same pattern the rest of
// the codebase uses). processDiagnosticsJob() is also safe to call again later
// (e.g. from a cron) — it atomically claims a 'queued' job so it can't run twice.
//
// Runs ONLY with the service-role client (supabaseAdmin); never import this into
// client code.
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseAdmin } from '@/lib/supabase'
import { renderPage } from '@/lib/renderer'
import { runDiagnostics } from '@/lib/diagnostics'
import { getOpsConfig } from '@/lib/app-config'

// A job is considered stale (its worker instance died mid-run) once it has been
// active this long without finishing. Tune here. Applied inline wherever job
// status is read — no cron needed.
export const STALE_JOB_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

interface StaleCheckJob {
  id: string
  status: string
  started_at?: string | null
  created_at?: string | null
}

// If the job is active but has exceeded the stale timeout, mark it 'failed'
// (reason: stalled_timeout) and return true so callers can unblock a new scan.
// Covers a 'running' job whose started_at is old, and a 'queued' job that was
// never picked up (created_at old). No-op for fresh/terminal jobs.
export async function reclaimIfStale(job: StaleCheckJob | null | undefined): Promise<boolean> {
  if (!job) return false
  const now = Date.now()
  const staleRunning =
    job.status === 'running' &&
    !!job.started_at &&
    now - new Date(job.started_at).getTime() > STALE_JOB_TIMEOUT_MS
  const staleQueued =
    job.status === 'queued' &&
    !!job.created_at &&
    now - new Date(job.created_at).getTime() > STALE_JOB_TIMEOUT_MS
  if (!staleRunning && !staleQueued) return false

  await supabaseAdmin
    .from('diagnostics_jobs')
    .update({
      status: 'failed',
      error_message: 'stalled_timeout',
      finished_at: new Date().toISOString(),
    })
    .eq('id', job.id)
    .in('status', ['queued', 'running']) // only if still active (don't clobber a real finish)
  return true
}

// SSRF guard: a URL may only be rendered if its host is the site's own domain
// (www-tolerant). Anything else (internal IPs, other sites) is rejected.
export function isUrlOnDomain(url: string, domain: string): boolean {
  let host: string
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    host = u.hostname.toLowerCase()
  } catch {
    return false
  }
  const bare = domain.toLowerCase().replace(/^www\./, '')
  return host === bare || host === `www.${bare}`
}

// Process one diagnostics job: render its URLs (bounded concurrency), capture
// diagnostics per URL, enforce the render quota, and update progress.
export async function processDiagnosticsJob(jobId: string): Promise<void> {
  // ── Atomically claim the job (queued → running) ──────────────────────────────
  // If another invocation already claimed it, the update matches 0 rows and we
  // bail out — this prevents double-processing on rapid/duplicate triggers.
  const { data: claimed } = await supabaseAdmin
    .from('diagnostics_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'queued')
    .select('id, site_id, user_id, urls')
    .maybeSingle()

  if (!claimed) return // already running/done, or gone

  const job = claimed as { id: string; site_id: string; user_id: string; urls: string[] }

  try {
    // Resolve the site's domain (for the SSRF check) and the owner's quota.
    const [{ data: site }, { data: user }] = await Promise.all([
      supabaseAdmin.from('sites').select('domain, render_count').eq('id', job.site_id).maybeSingle(),
      supabaseAdmin.from('users').select('render_count, render_limit').eq('id', job.user_id).maybeSingle(),
    ])

    if (!site) {
      await finish(jobId, 'failed', 'Site no longer exists')
      return
    }

    const domain: string = site.domain
    const renderLimit: number = user?.render_limit ?? 0
    let renderCount: number = user?.render_count ?? 0
    const siteRenderBase: number = site.render_count ?? 0
    const { rescanConcurrency: CONCURRENCY } = await getOpsConfig()

    // Only render URLs that pass the SSRF check.
    const urls = (job.urls ?? []).filter((u) => isUrlOnDomain(u, domain))

    let done = 0
    let rendered = 0
    let quotaHit = false

    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      // Stop early if the account is out of render quota.
      if (renderLimit > 0 && renderCount + rendered >= renderLimit) {
        quotaHit = true
        break
      }

      const batch = urls.slice(i, i + CONCURRENCY)
      await Promise.all(
        batch.map(async (url) => {
          // Re-check quota inside the batch so we never exceed the limit.
          if (renderLimit > 0 && renderCount + rendered >= renderLimit) {
            quotaHit = true
            return
          }
          try {
            const { html, renderTimeMs } = await renderPage(url)
            rendered++ // a render happened → counts against quota
            // includeWebVitals: this is an explicit scan, so also fetch CrUX
            // Core Web Vitals (the hot proxy path leaves it off).
            await runDiagnostics({ siteId: job.site_id, url, renderedHtml: html ?? '', renderTimeMs, includeWebVitals: true })
          } catch (err) {
            console.error('[diagnostics-worker url]:', url, err)
          } finally {
            done++
          }
        })
      )

      // Persist progress after each batch (drives the "Scanning 4/15" UI).
      await supabaseAdmin.from('diagnostics_jobs').update({ done_count: done }).eq('id', jobId)
    }

    // Bill the renders against the same quota the dashboard shows.
    if (rendered > 0) {
      await supabaseAdmin
        .from('users')
        .update({ render_count: renderCount + rendered })
        .eq('id', job.user_id)
      await supabaseAdmin
        .from('sites')
        .update({ render_count: siteRenderBase + rendered })
        .eq('id', job.site_id)
      renderCount += rendered
    }

    await finish(jobId, 'done', quotaHit ? 'Stopped early — monthly render limit reached' : null)
  } catch (err) {
    console.error('[diagnostics-worker job]:', jobId, err)
    await finish(jobId, 'failed', err instanceof Error ? err.message : 'Scan failed')
  }
}

// Mark a job terminal (done/failed) with a finish timestamp.
async function finish(jobId: string, status: 'done' | 'failed', errorMessage: string | null) {
  await supabaseAdmin
    .from('diagnostics_jobs')
    .update({ status, error_message: errorMessage, finished_at: new Date().toISOString() })
    .eq('id', jobId)
}
