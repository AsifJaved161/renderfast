import { NextRequest, NextResponse } from 'next/server'
import { detectBot } from '@/lib/botDetect'
import { getCachedPage, setCachedPage } from '@/lib/kv'
import { renderPage, htmlToMarkdown } from '@/lib/renderer'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CACHE_TTL = 86400
const BASE_HEADERS = { 'X-Robots-Tag': 'noindex', 'X-Powered-By': 'RenderFast' }

function dbBotType(t: string | null): 'search' | 'ai' | 'social' | 'unknown' {
  return t === 'search' || t === 'ai' || t === 'social' ? t : 'unknown'
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

  // ── Non-bot: passthrough ────────────────────────────────────────────────────
  if (!bot.isBot) {
    return NextResponse.json(
      { passthrough: true, message: 'Not a bot — serve original page' },
      { status: 200, headers: BASE_HEADERS }
    )
  }

  const wantsMarkdown =
    bot.botType === 'ai' && (req.headers.get('accept') ?? '').includes('text/markdown')

  // ── Bot: check KV cache ─────────────────────────────────────────────────────
  const cached = await getCachedPage(domain, targetUrl)
  if (cached) {
    logVisit(domain, targetUrl, bot, ua, req, wantsMarkdown)

    // Stale-while-revalidate: re-render in the background if expired in DB
    revalidateIfExpired(domain, targetUrl)

    if (wantsMarkdown) {
      return new NextResponse(htmlToMarkdown(cached), {
        status: 200,
        headers: { ...BASE_HEADERS, 'Content-Type': 'text/markdown; charset=utf-8', 'X-Cache-Status': 'HIT' },
      })
    }
    return new NextResponse(cached, {
      status: 200,
      headers: { ...BASE_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'X-Cache-Status': 'HIT' },
    })
  }

  // ── Cache miss: render now ──────────────────────────────────────────────────
  const { html, statusCode, error } = await renderPage(targetUrl)
  if (error || !html) {
    return NextResponse.redirect(targetUrl, 302)
  }

  await setCachedPage(domain, targetUrl, html, CACHE_TTL)
  logVisit(domain, targetUrl, bot, ua, req, wantsMarkdown)

  if (wantsMarkdown) {
    return new NextResponse(htmlToMarkdown(html), {
      status: statusCode,
      headers: { ...BASE_HEADERS, 'Content-Type': 'text/markdown; charset=utf-8', 'X-Cache-Status': 'MISS' },
    })
  }
  return new NextResponse(html, {
    status: statusCode,
    headers: { ...BASE_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'X-Cache-Status': 'MISS' },
  })
}

// ── Background re-render when the DB record says the cache expired ────────────
function revalidateIfExpired(domain: string, url: string) {
  ;(async () => {
    try {
      const { data } = await supabaseAdmin
        .from('cache_entries')
        .select('expires_at')
        .eq('url', url)
        .single()
      if (data?.expires_at && new Date(data.expires_at) > new Date()) return

      const { html, error } = await renderPage(url)
      if (!error && html) {
        await setCachedPage(domain, url, html, CACHE_TTL)
        await supabaseAdmin
          .from('cache_entries')
          .update({
            cached_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + CACHE_TTL * 1000).toISOString(),
          })
          .eq('url', url)
      }
    } catch {
      // never blocks the served response
    }
  })()
}

function logVisit(
  domain: string,
  url: string,
  bot: ReturnType<typeof detectBot>,
  ua: string,
  req: NextRequest,
  servedMarkdown: boolean
) {
  ;(async () => {
    try {
      const { data: site } = await supabaseAdmin
        .from('sites')
        .select('id')
        .eq('domain', domain)
        .single()
      if (!site) return
      await supabaseAdmin.from('bot_visits').insert({
        site_id: site.id,
        url,
        bot_name: bot.botName,
        bot_type: dbBotType(bot.botType),
        user_agent: ua,
        ip_address: req.headers.get('x-forwarded-for'),
        served_markdown: servedMarkdown,
      })
    } catch {
      // analytics must never block the response
    }
  })()
}
