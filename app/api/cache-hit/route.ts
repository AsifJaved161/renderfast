// Analytics beacon for EDGE-served cache hits.
//
// When the edge Worker (worker/edge.ts) serves a cached page straight from KV,
// it never touches this server — so the render/bot-visit rows that the normal
// /api/proxy path writes would be missing. The Worker fires a non-blocking POST
// here (via ctx.waitUntil) so those edge hits still show up in the dashboard.
//
// This mirrors logRender + logBotTraffic in /api/proxy. It records a cache HIT
// (cache_hit=true, render_time_ms = the edge serve time) and never spends a
// render, so it can't affect quotas.
import { NextRequest, NextResponse } from 'next/server'
import { detectBot } from '@/lib/botDetect'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function dbBotType(t: string | null): 'search' | 'ai' | 'social' | 'unknown' {
  return t === 'search' || t === 'ai' || t === 'social' ? t : 'unknown'
}

// Minimal owner lookup (www-insensitive). Mirrors resolveOwner in /api/proxy but
// only needs the ids for logging — no render-limit fields.
async function resolveSite(
  domain: string,
  token: string | null
): Promise<{ siteId: string; userId: string } | null> {
  const bare = domain.replace(/^www\./, '')
  const candidates = Array.from(new Set([domain, bare, `www.${bare}`]))
  const { data: sites } = await supabaseAdmin
    .from('sites')
    .select('id, user_id')
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
  return { siteId: site.id, userId: site.user_id }
}

export async function POST(req: NextRequest) {
  try {
    const { url, ua, token, serveMs, bytes } = await req.json()
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'url required' }, { status: 400 })
    }

    const bot = detectBot(ua)
    if (!bot.isBot) return new NextResponse(null, { status: 204 }) // only log real bots

    const domain = new URL(url).hostname
    const owner = await resolveSite(domain, token || null)
    if (!owner) return new NextResponse(null, { status: 204 }) // unregistered → skip

    const ip = req.headers.get('x-forwarded-for')
    const serveTime = Number.isFinite(serveMs) ? Math.max(0, Math.round(serveMs)) : null

    await Promise.all([
      supabaseAdmin.from('renders').insert({
        site_id: owner.siteId,
        user_id: owner.userId,
        url,
        bot_name: bot.botName,
        bot_type: dbBotType(bot.botType),
        status_code: 200,
        render_time_ms: serveTime,
        cache_hit: true,
        user_agent: ua ?? null,
        ip_address: ip,
      }),
      supabaseAdmin.from('bot_visits').insert({
        site_id: owner.siteId,
        url,
        bot_name: bot.botName,
        bot_type: dbBotType(bot.botType),
        user_agent: ua ?? null,
        ip_address: ip,
        served_markdown: false,
      }),
      supabaseAdmin.rpc('increment_bot_traffic', {
        p_site_id: owner.siteId,
        p_bot_name: bot.botName ?? 'other',
        p_bytes: Number.isFinite(bytes) ? Math.max(0, Math.round(bytes)) : 0,
      }),
    ])

    return new NextResponse(null, { status: 204 })
  } catch {
    // Analytics must never error loudly — drop quietly.
    return new NextResponse(null, { status: 204 })
  }
}
