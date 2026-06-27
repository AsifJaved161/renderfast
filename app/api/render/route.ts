import { NextRequest, NextResponse } from 'next/server'
import { detectBot } from '@/lib/botDetect'
import {
  getCachedPage,
  setCachedPage,
  getRateLimitCount,
  incrementRateLimit,
} from '@/lib/kv'
import { renderPage } from '@/lib/renderer'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeUrl } from '@/lib/url-utils'
import { incrementRenderCounts } from '@/lib/render-billing'
import { getSiteSettings, toRenderOptions } from '@/lib/site-settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CACHE_TTL = 86400 // 24h
const RATE_LIMIT = 10 // requests/sec per API key

// Map detector types to the DB's bot_type enum.
function dbBotType(t: string | null): 'search' | 'ai' | 'social' | 'unknown' {
  return t === 'search' || t === 'ai' || t === 'social' ? t : 'unknown'
}

export async function POST(req: NextRequest) {
  // ── 1. Validate API key ─────────────────────────────────────────────────────
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) {
    return NextResponse.json({ error: 'x-api-key header required' }, { status: 401 })
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, render_count, render_limit')
    .eq('api_key', apiKey)
    .single()

  if (!user) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
  }

  // ── 2. Render limit ─────────────────────────────────────────────────────────
  if (user.render_count >= user.render_limit) {
    return NextResponse.json(
      { error: 'Render limit reached', limit: user.render_limit },
      { status: 429 }
    )
  }

  // ── 3. Rate limit (10 req/sec) ──────────────────────────────────────────────
  if ((await getRateLimitCount(apiKey)) >= RATE_LIMIT) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }
  await incrementRateLimit(apiKey, 1)

  // ── 4. Parse body ───────────────────────────────────────────────────────────
  const body = await req.json().catch(() => ({}))
  const rawUrl: string | undefined = body.url
  if (!rawUrl) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  let parsed: URL
  try {
    // Normalize (strip tracking params) so this shares ONE cache key with the
    // proxy — otherwise the same page would be rendered/cached twice.
    parsed = new URL(normalizeUrl(rawUrl))
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }
  const url = parsed.toString()
  const domain = parsed.hostname

  // Resolve the owning site: explicit site_id, else match the URL's domain to one
  // of this user's registered sites (www-insensitive). May stay null for a URL
  // not tied to a registered site — migration 024 makes those rows loggable.
  let siteId: string | null = typeof body.site_id === 'string' ? body.site_id : null
  if (!siteId) {
    const bare = domain.replace(/^www\./, '')
    const { data: s } = await supabaseAdmin
      .from('sites')
      .select('id')
      .eq('user_id', user.id)
      .in('domain', Array.from(new Set([domain, bare, `www.${bare}`])))
      .limit(1)
      .maybeSingle()
    siteId = s?.id ?? null
  }
  // Honor the site's render overrides (mobile/UA/headers/blocked) when known.
  const renderOpts = siteId ? toRenderOptions(await getSiteSettings(siteId)) : {}

  // ── 5. Cache check ──────────────────────────────────────────────────────────
  const cached = await getCachedPage(domain, url)
  if (cached) {
    return new NextResponse(cached, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Cache-Status': 'HIT',
      },
    })
  }

  // ── 6. Render (Cloudflare Browser Rendering) ────────────────────────────────
  const { html, renderTimeMs, statusCode, error, notConfigured } = await renderPage(url, renderOpts)
  if (notConfigured) {
    return NextResponse.json({ error: 'Rendering is not configured yet' }, { status: 503 })
  }
  if (error || !html) {
    return NextResponse.json({ error: error ?? 'Render failed', url }, { status: 502 })
  }

  // ── 7. Persist: KV cache + cache_entries metadata ───────────────────────────
  await setCachedPage(domain, url, html, CACHE_TTL)

  await supabaseAdmin.from('cache_entries').upsert(
    {
      site_id: siteId,
      user_id: user.id,
      url,
      url_hash: `${domain}:${parsed.pathname}${parsed.search}`,
      status_code: statusCode,
      html_size_bytes: Buffer.byteLength(html, 'utf8'),
      render_time_ms: renderTimeMs,
      cached_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + CACHE_TTL * 1000).toISOString(),
      is_mobile: false,
    },
    { onConflict: 'url_hash' }
  )

  // ── 8. Increment render_count + log render ──────────────────────────────────
  await incrementRenderCounts(user.id, siteId, 1)

  const ua = req.headers.get('user-agent') ?? ''
  const bot = detectBot(ua)
  await supabaseAdmin.from('renders').insert({
    site_id: siteId,
    user_id: user.id,
    url,
    bot_name: bot.botName,
    bot_type: dbBotType(bot.botType),
    status_code: statusCode,
    render_time_ms: renderTimeMs,
    cache_hit: false,
    user_agent: ua,
    ip_address: req.headers.get('x-forwarded-for'),
  })

  return new NextResponse(html, {
    status: statusCode,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Cache-Status': 'MISS',
      'X-Render-Time': String(renderTimeMs),
    },
  })
}
