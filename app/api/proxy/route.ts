import { NextRequest, NextResponse, after } from 'next/server'
import { detectBot } from '@/lib/botDetect'
import { getCachedPage, setCachedPage } from '@/lib/kv'
import { renderPage, htmlToMarkdown } from '@/lib/renderer'
import { captureDiagnostics } from '@/lib/diagnostics'
import { getOpsConfig } from '@/lib/app-config'
import { normalizeUrl, isRenderableUrl } from '@/lib/url-utils'
import { captureValidators, originChanged, fingerprint } from '@/lib/revalidate'
import { getServableLlmsTxt } from '@/lib/llms-txt'
import { getApprovedSchemas, injectSchemas, persistAlreadyPresent } from '@/lib/schema-inject'
import { isSchemaEnabledForSite } from '@/lib/schema-settings'
import { supabaseAdmin } from '@/lib/supabase'
import type { Plan } from '@/lib/supabase'
import { incrementRenderCounts } from '@/lib/render-billing'
import { getSiteSettings, toRenderOptions, isExcludedPath, pathExpiryDays } from '@/lib/site-settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CACHE_TTL = 86400 // fallback when ops config is unavailable
const BASE_HEADERS = { 'X-Robots-Tag': 'noindex', 'X-Powered-By': 'RenderForAI' }

function dbBotType(t: string | null): 'search' | 'ai' | 'social' | 'unknown' {
  return t === 'search' || t === 'ai' || t === 'social' ? t : 'unknown'
}

interface Owner {
  siteId: string
  siteRenderCount: number
  userId: string
  renderCount: number
  renderLimit: number
  plan: Plan // owner's plan — drives the schema-markup feature gate
  status: string // 'active' | 'pending' | 'inactive' — 'inactive' = prerendering paused
}

// Short-lived in-memory cache for owner lookups. The proxy hot path resolves the
// same domain over and over; without this, every cache HIT pays 2 sequential
// Supabase round-trips before it can serve the bot. Sites/limits change rarely,
// so a few seconds of staleness is fine — and cache HITS never spend a render,
// so a slightly stale count can't cause over-rendering. Mirrors getCloudflareConfig().
const OWNER_TTL_MS = 15_000
const ownerCache = new Map<string, { owner: Owner | null; at: number }>()

async function resolveOwner(domain: string, token: string | null): Promise<Owner | null> {
  const key = `${domain}|${token ?? ''}`
  const hit = ownerCache.get(key)
  if (hit && Date.now() - hit.at < OWNER_TTL_MS) return hit.owner
  const owner = await resolveOwnerFromDb(domain, token)
  if (ownerCache.size > 5000) ownerCache.clear() // crude bound; rebuilds in seconds
  ownerCache.set(key, { owner, at: Date.now() })
  return owner
}

// Resolve the registered site (and its owner) for a target domain. The optional
// token (api_key) is used to disambiguate if the same domain exists for >1 user.
async function resolveOwnerFromDb(domain: string, token: string | null): Promise<Owner | null> {
  // Match the host with or without a leading "www." so example.com and
  // www.example.com resolve to the same registered site.
  const bare = domain.replace(/^www\./, '')
  const candidates = Array.from(new Set([domain, bare, `www.${bare}`]))

  const { data: sites } = await supabaseAdmin
    .from('sites')
    .select('id, user_id, render_count, status')
    .in('domain', candidates)
  if (!sites || sites.length === 0) return null

  let site = sites[0]
  if (token && sites.length > 1) {
    const { data: u } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('api_key', token)
      .maybeSingle()
    if (u) site = sites.find((s) => s.user_id === u.id) ?? site
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('render_count, render_limit, plan')
    .eq('id', site.user_id)
    .maybeSingle()

  return {
    siteId: site.id,
    siteRenderCount: site.render_count ?? 0,
    userId: site.user_id,
    renderCount: user?.render_count ?? 0,
    renderLimit: user?.render_limit ?? 0,
    plan: (user?.plan as Plan) ?? 'free',
    status: site.status ?? 'active',
  }
}

// Resolve a registered site's id for a domain (www-insensitive). Lighter than
// resolveOwner — used by the /llms.txt path, which doesn't need owner/limits.
async function resolveSiteId(domain: string): Promise<string | null> {
  const bare = domain.replace(/^www\./, '')
  const candidates = Array.from(new Set([domain, bare, `www.${bare}`]))
  const { data } = await supabaseAdmin.from('sites').select('id').in('domain', candidates).limit(1)
  return data?.[0]?.id ?? null
}

// Build the text/plain /llms.txt response for a domain, or null to fall through
// (unregistered domain, or the site disabled auto-serving).
async function serveLlmsTxt(domain: string): Promise<NextResponse | null> {
  try {
    const siteId = await resolveSiteId(domain)
    if (!siteId) return null
    const content = await getServableLlmsTxt(siteId)
    if (content == null) return null
    return new NextResponse(content, {
      status: 200,
      headers: {
        ...BASE_HEADERS,
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Cache-Status': 'LLMS',
      },
    })
  } catch {
    return null // never break the proxy for an llms.txt hiccup — fall through
  }
}

export async function GET(req: NextRequest) {
  const reqStart = Date.now() // to measure how fast a cache HIT is served
  const { searchParams } = req.nextUrl
  const targetUrl = req.headers.get('x-target-url') ?? searchParams.get('url')
  if (!targetUrl) {
    return NextResponse.json({ error: 'Target URL required' }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }
  const domain = parsed.hostname

  // ── /llms.txt: serve the auto-generated file directly ────────────────────────
  // Bypasses render/cache AND bot detection — this path is the same for every
  // visitor. Returns null only when the site is unknown or has auto_enabled=false,
  // in which case we fall through and let the origin serve its own file.
  if (parsed.pathname.toLowerCase() === '/llms.txt') {
    const llms = await serveLlmsTxt(domain)
    if (llms) return llms
  }

  const ua = req.headers.get('user-agent') ?? ''
  const bot = detectBot(ua)

  // ── Non-bot: tell the integration to serve the original page ─────────────────
  if (!bot.isBot) {
    return NextResponse.json(
      { passthrough: true, message: 'Not a bot — serve original page' },
      { status: 200, headers: BASE_HEADERS }
    )
  }

  const token = req.headers.get('x-prerender-token') ?? req.headers.get('x-api-key')
  const owner = await resolveOwner(domain, token)

  // Unregistered domain → don't render foreign sites; send the bot to origin.
  if (!owner) {
    return NextResponse.redirect(targetUrl, 302)
  }

  // Prerendering paused for this site (crawler off) → serve nothing from us; the
  // bot just gets the origin page. No render, no cache serve, no quota spend.
  if (owner.status === 'inactive') {
    return NextResponse.redirect(targetUrl, 302)
  }

  // Over the monthly render limit → fall back to origin (no error to the bot).
  if (owner.renderLimit > 0 && owner.renderCount >= owner.renderLimit) {
    return NextResponse.redirect(targetUrl, 302)
  }

  // Low-value URL (search, /api, admin, feed, cart…) → don't spend a render;
  // send the bot straight to origin.
  if (!isRenderableUrl(targetUrl)) {
    return NextResponse.redirect(targetUrl, 302)
  }

  // Per-site advanced settings (excluded paths, custom UA/headers/mobile/block,
  // per-path cache expiry). Cached briefly so this stays off the DB hot path.
  const settings = await getSiteSettings(owner.siteId)
  if (isExcludedPath(targetUrl, settings.excludedPaths)) {
    return NextResponse.redirect(targetUrl, 302) // owner excluded this path from prerendering
  }

  // Normalize away tracking params so /p and /p?utm=… share one cache entry.
  const renderUrl = normalizeUrl(targetUrl)
  const renderParsed = new URL(renderUrl)

  const wantsMarkdown =
    bot.botType === 'ai' && (req.headers.get('accept') ?? '').includes('text/markdown')

  // ── Cache hit ────────────────────────────────────────────────────────────────
  const cached = await getCachedPage(domain, renderUrl)
  if (cached) {
    // Real time the bot waited to receive the cached page (KV fetch + serve) —
    // this is the "benefit" number shown to users, typically tens of ms.
    const serveMs = Date.now() - reqStart
    // Inject approved schema into the served HTML (not into the cache itself).
    // Markdown responses skip injection — JSON-LD is an HTML <head> concern.
    const servedHtml = wantsMarkdown ? cached : await applySchemas(cached, owner.siteId, renderUrl, owner.plan)
    const body = toBody(servedHtml, wantsMarkdown)
    logRender(owner, domain, renderUrl, bot, ua, req, wantsMarkdown, true, serveMs, 200)
    logBotTraffic(owner.siteId, bot.botName, Buffer.byteLength(body, 'utf8'))
    // after() keeps this alive past the response so it can't be killed mid-flight.
    // Pass siteId so revalidation re-renders with the same per-site options.
    after(() => revalidateChanged(domain, renderUrl, cached, owner.siteId))
    return serve(body, wantsMarkdown, 'HIT', 200)
  }

  // ── Cache miss: render now (with the site's render overrides) ────────────────
  const { html, renderTimeMs, statusCode, error } = await renderPage(renderUrl, toRenderOptions(settings))
  if (error || !html) {
    return NextResponse.redirect(targetUrl, 302)
  }

  const { cacheTtlSeconds, hardCacheTtlDays } = await getOpsConfig()
  // Per-path cache-expiry override (soft check window), else the platform default.
  const expiryDays = pathExpiryDays(renderUrl, settings.pathExpiry)
  const ttlSeconds = expiryDays != null ? expiryDays * 86400 : cacheTtlSeconds
  await setCachedPage(domain, renderUrl, html, hardCacheTtlDays * 86400) // persist RAW html; freshness via revalidation
  await persistRender(owner, domain, renderParsed, html, renderTimeMs, statusCode, ttlSeconds, !!settings.emulateMobile)
  // Inject approved schema into the served body only — the cache keeps the raw HTML.
  const servedHtml = wantsMarkdown ? html : await applySchemas(html, owner.siteId, renderUrl, owner.plan)
  const body = toBody(servedHtml, wantsMarkdown)
  logRender(owner, domain, renderUrl, bot, ua, req, wantsMarkdown, false, renderTimeMs, statusCode)
  logBotTraffic(owner.siteId, bot.botName, Buffer.byteLength(body, 'utf8'))

  // ── Background (non-blocking): ONE origin fetch feeds both diagnostics and
  //    the change-detection validators (no duplicate request). ─────────────────
  after(async () => {
    try {
      let rawHtml: string | null = null
      let etag: string | null = null
      let lastModified: string | null = null
      try {
        const res = await fetch(renderUrl, {
          headers: { 'User-Agent': 'RenderForAIBot/1.0 (+https://renderforai.com)', Accept: 'text/html' },
          signal: AbortSignal.timeout(12_000),
        })
        if (res.ok) {
          rawHtml = await res.text()
          etag = res.headers.get('etag')
          lastModified = res.headers.get('last-modified')
        }
      } catch {
        /* origin unreachable — diagnostics fall back, validators skipped */
      }

      captureDiagnostics({ siteId: owner.siteId, url: renderUrl, renderedHtml: html, renderTimeMs, rawHtml })
      if (rawHtml != null) {
        await supabaseAdmin
          .from('cache_entries')
          .update({ etag, last_modified: lastModified, content_hash: fingerprint(rawHtml) })
          .eq('url', renderUrl)
          .eq('user_id', owner.userId)
      }
    } catch {
      // background work must never throw (e.g. validator columns missing pre-migration)
    }
  })

  return serve(body, wantsMarkdown, 'MISS', statusCode)
}

// ── Helpers ────────────────────────────────────────────────────────────────────
// Convert the rendered HTML into the body actually served to the bot (HTML, or
// Markdown for AI crawlers that asked for it). Done once so the served byte size
// can be measured without re-running the markdown conversion.
function toBody(html: string, wantsMarkdown: boolean): string {
  return wantsMarkdown ? htmlToMarkdown(html) : html
}

// Inject any approved/edited JSON-LD for this page into the HTML we're about to
// serve. Operates on the SERVED string only (the cache still holds the raw,
// un-injected HTML), so caching is completely unaffected — this just augments
// the response. Skips types the page already declares (dedup) and persists the
// resulting "already present" flags in the background for the dashboard.
// Returns the original HTML untouched on any issue.
async function applySchemas(html: string, siteId: string, url: string, plan: Plan): Promise<string> {
  try {
    // Platform gate (global switch + plan gate + per-site override). Disabled →
    // serve the page untouched. Both reads are cached, so HITs stay fast.
    if (!(await isSchemaEnabledForSite(siteId, plan))) return html
    const rows = await getApprovedSchemas(siteId, url)
    if (rows.length === 0) return html
    const { html: out, flagUpdates } = injectSchemas(html, rows)
    if (flagUpdates.length > 0) {
      after(() => persistAlreadyPresent(siteId, url, flagUpdates))
    }
    return out
  } catch {
    return html // never block serving on schema injection
  }
}

function serve(body: string, wantsMarkdown: boolean, cacheStatus: 'HIT' | 'MISS', status: number) {
  const contentType = wantsMarkdown ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8'
  return new NextResponse(body, {
    status,
    headers: { ...BASE_HEADERS, 'Content-Type': contentType, 'X-Cache-Status': cacheStatus },
  })
}

// Fire-and-forget: bump the per-site/per-bot/per-day volume counters. Unknown or
// unclassified bots collapse into a single 'other' bucket (the RPC coalesces an
// empty/null name) so the table can never grow unbounded distinct rows. Never
// blocks or throws into the served response (e.g. table missing pre-migration).
function logBotTraffic(siteId: string, botName: string | null, bytes: number) {
  void supabaseAdmin
    .rpc('increment_bot_traffic', {
      p_site_id: siteId,
      p_bot_name: botName ?? 'other',
      p_bytes: bytes,
    })
    .then(() => {}, () => {})
}

// Bill the render: bump counters + write cache_entries metadata.
async function persistRender(
  owner: Owner,
  domain: string,
  parsed: URL,
  html: string,
  renderTimeMs: number,
  statusCode: number,
  ttlSeconds: number = CACHE_TTL,
  isMobile = false
) {
  try {
    // Atomic bill (user + site) — no read-then-write race on concurrent misses.
    await incrementRenderCounts(owner.userId, owner.siteId, 1)

    await supabaseAdmin.from('cache_entries').upsert(
      {
        site_id: owner.siteId,
        user_id: owner.userId,
        url: parsed.toString(),
        url_hash: `${domain}:${parsed.pathname}${parsed.search}`,
        status_code: statusCode,
        html_size_bytes: Buffer.byteLength(html, 'utf8'),
        render_time_ms: renderTimeMs,
        cached_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        is_mobile: isMobile,
      },
      { onConflict: 'url_hash' }
    )
  } catch {
    // billing/metadata must never break the served response
  }
}

// Write renders + bot_visits rows for analytics (never blocks the response).
function logRender(
  owner: Owner,
  domain: string,
  url: string,
  bot: ReturnType<typeof detectBot>,
  ua: string,
  req: NextRequest,
  servedMarkdown: boolean,
  cacheHit: boolean,
  renderTimeMs: number,
  statusCode: number
) {
  ;(async () => {
    try {
      const ip = req.headers.get('x-forwarded-for')
      await supabaseAdmin.from('renders').insert({
        site_id: owner.siteId,
        user_id: owner.userId,
        url,
        bot_name: bot.botName,
        bot_type: dbBotType(bot.botType),
        status_code: statusCode,
        render_time_ms: renderTimeMs || null,
        cache_hit: cacheHit,
        user_agent: ua,
        ip_address: ip,
      })
      await supabaseAdmin.from('bot_visits').insert({
        site_id: owner.siteId,
        url,
        bot_name: bot.botName,
        bot_type: dbBotType(bot.botType),
        user_agent: ua,
        ip_address: ip,
        served_markdown: servedMarkdown,
      })
    } catch {
      // analytics must never block the response
    }
  })()
}

// Smart background revalidation: once the soft check-window elapses, ask the
// origin (cheaply) whether the page CHANGED. Only re-render if it did — an
// unchanged page just gets its cache window + KV lifetime refreshed, saving the
// expensive render entirely. Never blocks the served response.
//
// siteId is passed so the re-render uses the same per-site options (mobile
// viewport, custom UA, headers, blocked resources) as the initial render —
// without it, revalidation would silently use global defaults.
async function revalidateChanged(
  domain: string,
  url: string,
  cachedHtml: string,
  siteId: string
): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('cache_entries')
      .select('expires_at, etag, last_modified, content_hash')
      .eq('url', url)
      .maybeSingle()
    if (!data) return
    // Not due for a check yet → nothing to do.
    if (data.expires_at && new Date(data.expires_at) > new Date()) return

    const { cacheTtlSeconds, hardCacheTtlDays } = await getOpsConfig()
    const hardTtl = hardCacheTtlDays * 86400
    const nextWindow = new Date(Date.now() + cacheTtlSeconds * 1000).toISOString()
    const changed = await originChanged(url, {
      etag: data.etag,
      last_modified: data.last_modified,
      content_hash: data.content_hash,
    })

    // Unchanged (or origin unreachable) → DON'T render. Refresh KV lifetime +
    // the next check window, keep serving the existing cache.
    if (changed === false || changed === null) {
      await setCachedPage(domain, url, cachedHtml, hardTtl)
      await supabaseAdmin.from('cache_entries').update({ expires_at: nextWindow }).eq('url', url)
      return
    }

    // Content changed → re-render with the same per-site options as the initial render.
    // Refresh settings in case they changed since the last render.
    const freshSettings = await getSiteSettings(siteId)
    const { html, error, renderTimeMs, statusCode } = await renderPage(url, toRenderOptions(freshSettings))
    if (!error && html) {
      await setCachedPage(domain, url, html, hardTtl)
      const v = await captureValidators(url)
      await supabaseAdmin
        .from('cache_entries')
        .update({
          cached_at: new Date().toISOString(),
          expires_at: nextWindow,
          html_size_bytes: Buffer.byteLength(html, 'utf8'),
          render_time_ms: renderTimeMs,
          status_code: statusCode,
          is_mobile: !!freshSettings.emulateMobile,
          ...(v ?? {}),
        })
        .eq('url', url)
    }
  } catch {
    // never blocks the served response
  }
}
