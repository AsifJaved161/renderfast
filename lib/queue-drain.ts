// ─────────────────────────────────────────────────────────────────────────────
// Caching-queue drainer — renders 'pending' URLs (→ KV cache + cache_entries),
// in batches, until empty / a max count / a wall-clock deadline. Shared by:
//   • POST /api/sites (auto-render right after a sitemap is queued)
//   • POST/GET /api/queue/process (manual "Process Queue" + Vercel cron)
// Bounded so a single invocation always finishes inside the function timeout.
// ─────────────────────────────────────────────────────────────────────────────
import { setCachedPage } from '@/lib/kv'
import { renderPage } from '@/lib/renderer'
import { getOpsConfig } from '@/lib/app-config'
import { normalizeUrl, isRenderableUrl } from '@/lib/url-utils'
import { captureValidators } from '@/lib/revalidate'
import { supabaseAdmin } from '@/lib/supabase'
import { getSiteSettings, toRenderOptions, isExcludedPath, pathExpiryDays } from '@/lib/site-settings'

const BATCH = 5

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const isRateLimited = (err?: string) => !!err && /rate.?limit/i.test(err)

export interface DrainOpts {
  userId?: string // limit to one user's queue
  siteId?: string // limit to one site's queue
  maxUrls?: number // hard cap on URLs rendered this run
  deadlineMs?: number // stop once this much wall-clock has elapsed
}

export async function drainQueue(
  opts: DrainOpts = {}
): Promise<{ processed: number; failed: number; rateLimited: boolean }> {
  const maxUrls = opts.maxUrls ?? 60
  const deadline = Date.now() + (opts.deadlineMs ?? 45_000)
  // Admin-configurable: pacing between renders (Cloudflare rate limit) + how long
  // KV keeps a page (freshness is driven by change-detection, not this TTL).
  const { cacheTtlSeconds, queueThrottleMs, hardCacheTtlDays } = await getOpsConfig()
  const hardTtlSeconds = hardCacheTtlDays * 86400

  let processed = 0
  let failed = 0
  let rateLimited = false

  while (processed + failed < maxUrls && Date.now() < deadline && !rateLimited) {
    let q = supabaseAdmin
      .from('caching_queue')
      .select('id, url, site_id, user_id, attempts')
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(BATCH)
    if (opts.userId) q = q.eq('user_id', opts.userId)
    if (opts.siteId) q = q.eq('site_id', opts.siteId)

    const { data: items } = await q
    if (!items || items.length === 0) break // queue drained

    for (const item of items) {
      if (Date.now() >= deadline || processed + failed >= maxUrls) break

      // Low-value URL (search/admin/api/feed/cart…) → never render it; drop it
      // from the queue (the bot gets origin via the proxy anyway).
      if (!isRenderableUrl(item.url)) {
        await supabaseAdmin.from('caching_queue').delete().eq('id', item.id)
        continue
      }

      // Per-site advanced settings (render overrides, excluded paths, expiry).
      const settings = await getSiteSettings(item.site_id)
      if (isExcludedPath(item.url, settings.excludedPaths)) {
        await supabaseAdmin.from('caching_queue').delete().eq('id', item.id)
        continue
      }

      // Normalize away tracking params so the cache key matches the proxy's.
      const renderUrl = normalizeUrl(item.url)
      let domain = ''
      let parsed: URL | null = null
      try {
        parsed = new URL(renderUrl)
        domain = parsed.hostname
      } catch {
        /* invalid URL → fail below */
      }

      // Efficiency: skip URLs that are already freshly cached — a render is the
      // expensive, rate-limited resource, so never spend one on a still-valid
      // page. Marks the item done from the existing cache.
      const { data: fresh } = await supabaseAdmin
        .from('cache_entries')
        .select('expires_at')
        .eq('site_id', item.site_id)
        .eq('url', renderUrl)
        .maybeSingle()
      if (fresh?.expires_at && new Date(fresh.expires_at) > new Date()) {
        await supabaseAdmin
          .from('caching_queue')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', item.id)
        processed++
        continue // no render, no throttle
      }

      // Claim the item so parallel drainers don't double-render it.
      await supabaseAdmin.from('caching_queue').update({ status: 'rendering' }).eq('id', item.id)

      const result = parsed ? await renderPage(renderUrl, toRenderOptions(settings)) : null

      // Rate-limited → transient: put it back to 'pending' and stop this run so
      // the cron / next call retries later instead of burning the whole queue.
      if (result && isRateLimited(result.error)) {
        await supabaseAdmin.from('caching_queue').update({ status: 'pending' }).eq('id', item.id)
        rateLimited = true
        break
      }

      if (!parsed || !result || result.error || !result.html) {
        failed++
        await supabaseAdmin
          .from('caching_queue')
          .update({
            status: 'failed',
            error_message: result?.error ?? 'Invalid URL or empty render',
            attempts: (item.attempts ?? 0) + 1,
          })
          .eq('id', item.id)
        await sleep(queueThrottleMs)
        continue
      }

      // Per-path cache-expiry override (soft check window), else platform default.
      const expiryDays = pathExpiryDays(renderUrl, settings.pathExpiry)
      const softTtlSeconds = expiryDays != null ? expiryDays * 86400 : cacheTtlSeconds

      // KV persists for the hard TTL; freshness is driven by change-detection.
      await setCachedPage(domain, renderUrl, result.html, hardTtlSeconds)
      const v = await captureValidators(renderUrl)
      await supabaseAdmin.from('cache_entries').upsert(
        {
          site_id: item.site_id,
          user_id: item.user_id,
          url: renderUrl,
          url_hash: `${domain}:${parsed.pathname}${parsed.search}`,
          status_code: result.statusCode,
          html_size_bytes: Buffer.byteLength(result.html, 'utf8'),
          render_time_ms: result.renderTimeMs,
          cached_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + softTtlSeconds * 1000).toISOString(),
          is_mobile: settings.emulateMobile,
          ...(v ?? {}),
        },
        { onConflict: 'url_hash' }
      )
      await supabaseAdmin
        .from('caching_queue')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', item.id)

      processed++
      await sleep(queueThrottleMs) // pace renders to respect Cloudflare's rate limit
    }
  }

  return { processed, failed, rateLimited }
}
