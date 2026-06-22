import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { renderPage } from '@/lib/renderer'
import { setCachedPage } from '@/lib/kv'
import { captureValidators } from '@/lib/revalidate'
import { getOpsConfig } from '@/lib/app-config'
import { normalizeUrl } from '@/lib/url-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ── POST /api/onboarding/render — the new user's first render ─────────────────
// Renders the site's homepage so onboarding can show a real result, warms the
// cache, and marks the site active. Ownership-checked; respects render limit.
export async function POST(req: NextRequest) {
  try {
    const uid = req.headers.get('x-user-id')
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const siteId = String(body?.siteId ?? '')

    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id, domain, render_count')
      .eq('id', siteId)
      .eq('user_id', uid)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('render_count, render_limit')
      .eq('id', uid)
      .maybeSingle()
    if (user && user.render_limit > 0 && user.render_count >= user.render_limit) {
      return NextResponse.json({ ok: false, error: 'Monthly render limit reached.' }, { status: 403 })
    }

    const url = normalizeUrl(`https://${site.domain.replace(/^https?:\/\//, '')}/`)
    const host = new URL(url).hostname

    const { html, renderTimeMs, statusCode, error } = await renderPage(url)
    if (error || !html) {
      return NextResponse.json({ ok: false, error: error ?? 'Render failed', url }, { status: 200 })
    }

    const { cacheTtlSeconds, hardCacheTtlDays } = await getOpsConfig()
    const parsed = new URL(url)
    try {
      await setCachedPage(host, url, html, hardCacheTtlDays * 86400)
      const v = await captureValidators(url)
      await supabaseAdmin.from('cache_entries').upsert(
        {
          site_id: site.id,
          user_id: uid,
          url,
          url_hash: `${host}:${parsed.pathname}${parsed.search}`,
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
        site_id: site.id,
        user_id: uid,
        url,
        bot_name: 'Onboarding',
        bot_type: 'unknown',
        status_code: statusCode,
        render_time_ms: renderTimeMs,
        cache_hit: false,
        user_agent: 'RenderFast Onboarding',
        ip_address: null,
      })
      await supabaseAdmin.from('users').update({ render_count: (user?.render_count ?? site.render_count ?? 0) + 1 }).eq('id', uid)
      // First successful render → the site is live.
      await supabaseAdmin.from('sites').update({ status: 'active', render_count: (site.render_count ?? 0) + 1 }).eq('id', site.id)
    } catch {
      // persistence must not fail the onboarding result
    }

    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null

    return NextResponse.json({
      ok: true,
      url,
      title,
      htmlLength: html.length,
      renderTimeMs,
      statusCode,
    })
  } catch (e) {
    console.error('[ONBOARDING_RENDER]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
