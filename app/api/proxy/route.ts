import { NextRequest, NextResponse, after } from 'next/server'
import { detectBot } from '@/lib/botDetect'
import { getCachedPage, setCachedPage } from '@/lib/kv'
import { renderPage, htmlToMarkdown } from '@/lib/renderer'
import { captureDiagnostics } from '@/lib/diagnostics'
import { getOpsConfig } from '@/lib/app-config'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CACHE_TTL = 86400 // fallback when ops config is unavailable
const BASE_HEADERS = { 'X-Robots-Tag': 'noindex', 'X-Powered-By': 'RenderFast' }

function dbBotType(t: string | null): 'search' | 'ai' | 'social' | 'unknown' {
  return t === 'search' || t === 'ai' || t === 'social' ? t : 'unknown'
}

interface Owner {
  siteId: string
  siteRenderCount: number
  userId: string
  renderCount: number
  renderLimit: number
}

// Resolve the registered site (and its owner) for a target domain. The optional
// token (api_key) is used to disambiguate if the same domain exists for >1 user.
async function resolveOwner(domain: string, token: string | null): Promise<Owner | null> {
  // Match the host with or without a leading "www." so example.com and
  // www.example.com resolve to the same registered site.
  const bare = domain.replace(/^www\./, '')
  const candidates = Array.from(new Set([domain, bare, `www.${bare}`]))

  const { data: sites } = await supabaseAdmin
    .from('sites')
    .select('id, user_id, render_count')
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
    .select('render_count, render_limit')
    .eq('id', site.user_id)
    .maybeSingle()

  return {
    siteId: site.id,
    siteRenderCount: site.render_count ?? 0,
    userId: site.user_id,
    renderCount: user?.render_count ?? 0,
    renderLimit: user?.render_limit ?? 0,
  }
}

export async function GET(req: NextRequest) {
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

  // Over the monthly render limit → fall back to origin (no error to the bot).
  if (owner.renderLimit > 0 && owner.renderCount >= owner.renderLimit) {
    return NextResponse.redirect(targetUrl, 302)
  }

  const wantsMarkdown =
    bot.botType === 'ai' && (req.headers.get('accept') ?? '').includes('text/markdown')

  // ── Cache hit ────────────────────────────────────────────────────────────────
  const cached = await getCachedPage(domain, targetUrl)
  if (cached) {
    logRender(owner, domain, targetUrl, bot, ua, req, wantsMarkdown, true, 0, 200)
    revalidateIfExpired(domain, targetUrl)
    return serve(cached, wantsMarkdown, 'HIT', 200)
  }

  // ── Cache miss: render now ──────────────────────────────────────────────────
  const { html, renderTimeMs, statusCode, error } = await renderPage(targetUrl)
  if (error || !html) {
    return NextResponse.redirect(targetUrl, 302)
  }

  const { cacheTtlSeconds } = await getOpsConfig()
  await setCachedPage(domain, targetUrl, html, cacheTtlSeconds)
  await persistRender(owner, domain, parsed, html, renderTimeMs, statusCode, cacheTtlSeconds)
  logRender(owner, domain, targetUrl, bot, ua, req, wantsMarkdown, false, renderTimeMs, statusCode)

  // ── Render Diagnostics (isolated, non-blocking) ──────────────────────────────
  // Runs after the response is sent; never affects what the crawler receives.
  after(() => captureDiagnostics({ siteId: owner.siteId, url: targetUrl, renderedHtml: html, renderTimeMs }))

  return serve(html, wantsMarkdown, 'MISS', statusCode)
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function serve(html: string, wantsMarkdown: boolean, cacheStatus: 'HIT' | 'MISS', status: number) {
  const body = wantsMarkdown ? htmlToMarkdown(html) : html
  const contentType = wantsMarkdown ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8'
  return new NextResponse(body, {
    status,
    headers: { ...BASE_HEADERS, 'Content-Type': contentType, 'X-Cache-Status': cacheStatus },
  })
}

// Bill the render: bump counters + write cache_entries metadata.
async function persistRender(
  owner: Owner,
  domain: string,
  parsed: URL,
  html: string,
  renderTimeMs: number,
  statusCode: number,
  ttlSeconds: number = CACHE_TTL
) {
  try {
    await supabaseAdmin
      .from('users')
      .update({ render_count: owner.renderCount + 1 })
      .eq('id', owner.userId)

    await supabaseAdmin
      .from('sites')
      .update({ render_count: owner.siteRenderCount + 1 })
      .eq('id', owner.siteId)

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
        is_mobile: false,
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

// Background re-render when the DB record says the cache expired.
function revalidateIfExpired(domain: string, url: string) {
  ;(async () => {
    try {
      const { data } = await supabaseAdmin
        .from('cache_entries')
        .select('expires_at')
        .eq('url', url)
        .maybeSingle()
      if (data?.expires_at && new Date(data.expires_at) > new Date()) return

      const { html, error } = await renderPage(url)
      if (!error && html) {
        const { cacheTtlSeconds } = await getOpsConfig()
        await setCachedPage(domain, url, html, cacheTtlSeconds)
        await supabaseAdmin
          .from('cache_entries')
          .update({
            cached_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + cacheTtlSeconds * 1000).toISOString(),
          })
          .eq('url', url)
      }
    } catch {
      // never blocks the served response
    }
  })()
}
