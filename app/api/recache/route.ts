import { NextRequest, NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { renderPage } from '@/lib/renderer'
import { setCachedPage } from '@/lib/kv'
import { captureValidators } from '@/lib/revalidate'
import { getOpsConfig } from '@/lib/app-config'
import { normalizeUrl, isRenderableUrl } from '@/lib/url-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Instant recache-on-publish webhook. A site's CMS/plugin POSTs the URL(s) that
// just changed; we re-render them immediately and overwrite the cache — so bots
// see fresh content without waiting for the scheduled sitemap re-check or the
// background change-detection window. This is PURELY ADDITIVE: it does not alter
// the smart-revalidation flow; it just force-refreshes the specific URLs given,
// keeping cache_entries (cached_at/expires_at/validators) consistent so the
// existing revalidation logic continues to behave exactly as before.
//
// Auth: x-api-key (account key, same as the WordPress plugin handshake).
// Security/cost: each URL is bound to one of the caller's OWN registered domains;
// foreign URLs are rejected (no arbitrary rendering on our Cloudflare budget).

const MAX_URLS = 50
const DEADLINE_MS = 52_000 // leave headroom under maxDuration for the final writes
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const bareHost = (h: string) => h.replace(/^www\./, '')

interface Owner {
  id: string
  render_count: number
  render_limit: number
}
interface Item {
  url: string // normalized
  host: string // URL hostname (used for the KV cache key — matches the proxy)
  siteId: string
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) return NextResponse.json({ error: 'x-api-key required' }, { status: 401 })

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, render_count, render_limit')
    .eq('api_key', apiKey)
    .maybeSingle()
  if (!user) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const raw: unknown[] = Array.isArray(body?.urls) ? body.urls : body?.url ? [body.url] : []
  if (raw.length === 0) {
    return NextResponse.json({ error: 'Provide "url" (string) or "urls" (array)' }, { status: 400 })
  }

  // Caller's registered domains → bind every URL to one of them (SSRF/cost safe).
  const { data: sites } = await supabaseAdmin.from('sites').select('id, domain').eq('user_id', user.id)
  const siteByHost = new Map<string, string>()
  for (const s of sites ?? []) siteByHost.set(bareHost(s.domain.toLowerCase()), s.id)

  const accepted: Item[] = []
  const skipped: { url: string; reason: string }[] = []
  const seen = new Set<string>()

  for (const u of raw.slice(0, MAX_URLS * 3)) {
    if (accepted.length >= MAX_URLS) break
    let parsed: URL
    try {
      parsed = new URL(String(u))
    } catch {
      skipped.push({ url: String(u), reason: 'invalid url' })
      continue
    }
    const norm = normalizeUrl(parsed.toString())
    if (seen.has(norm)) continue
    seen.add(norm)

    if (!isRenderableUrl(norm)) {
      skipped.push({ url: norm, reason: 'non-renderable (junk/asset/admin path)' })
      continue
    }
    const host = new URL(norm).hostname
    const siteId = siteByHost.get(bareHost(host.toLowerCase()))
    if (!siteId) {
      skipped.push({ url: norm, reason: 'domain not registered to this account' })
      continue
    }
    accepted.push({ url: norm, host, siteId })
  }

  if (accepted.length === 0) {
    return NextResponse.json({ accepted: 0, skipped }, { status: 400 })
  }

  // Respond immediately so publishing isn't blocked; render in the background.
  after(() => recache(user as Owner, accepted))

  return NextResponse.json({ ok: true, accepted: accepted.length, skipped }, { status: 202 })
}

async function recache(user: Owner, items: Item[]) {
  const deadline = Date.now() + DEADLINE_MS
  const { cacheTtlSeconds, queueThrottleMs, hardCacheTtlDays } = await getOpsConfig()
  const hardTtl = hardCacheTtlDays * 86400
  let budget = user.render_limit > 0 ? Math.max(0, user.render_limit - user.render_count) : Infinity
  let rendered = 0
  const overflow: Item[] = []

  for (const it of items) {
    // Out of time or quota → hand the rest to the existing caching queue.
    if (Date.now() >= deadline || budget <= 0) {
      overflow.push(it)
      continue
    }
    try {
      const parsed = new URL(it.url)
      const { html, renderTimeMs, statusCode, error } = await renderPage(it.url)
      if (error || !html) continue

      // Write the SAME KV key the proxy reads (host + normalized url).
      await setCachedPage(it.host, it.url, html, hardTtl)
      const v = await captureValidators(it.url)
      await supabaseAdmin.from('cache_entries').upsert(
        {
          site_id: it.siteId,
          user_id: user.id,
          url: it.url,
          url_hash: `${it.host}:${parsed.pathname}${parsed.search}`,
          status_code: statusCode,
          html_size_bytes: Buffer.byteLength(html, 'utf8'),
          render_time_ms: renderTimeMs,
          cached_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + cacheTtlSeconds * 1000).toISOString(),
          is_mobile: false,
          ...(v ?? {}),
        },
        { onConflict: 'url_hash' }
      )
      await supabaseAdmin.from('renders').insert({
        site_id: it.siteId,
        user_id: user.id,
        url: it.url,
        bot_name: 'Recache',
        bot_type: 'unknown',
        status_code: statusCode,
        render_time_ms: renderTimeMs,
        cache_hit: false,
        user_agent: 'RenderForAI Recache Webhook',
        ip_address: null,
      })

      rendered++
      budget--
      await sleep(queueThrottleMs) // pace renders to respect Cloudflare's rate limit
    } catch {
      // one bad URL must not abort the batch
    }
  }

  // Bump the owner's render_count once for the batch.
  if (rendered > 0) {
    await supabaseAdmin
      .from('users')
      .update({ render_count: user.render_count + rendered })
      .eq('id', user.id)
  }

  // Overflow (deadline/quota) → enqueue for the existing queue drainer + cron.
  if (overflow.length > 0) {
    await supabaseAdmin
      .from('caching_queue')
      .insert(overflow.map((o) => ({ site_id: o.siteId, user_id: user.id, url: o.url, priority: 10, status: 'pending' })))
  }
}
