import { NextRequest, NextResponse } from 'next/server'
import { setCachedPage, deleteCachedPage, clearDomainCache } from '@/lib/kv'
import { renderPage } from '@/lib/renderer'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CACHE_TTL = 86400

// ── GET /api/cache?page=1&limit=20&site_id= — paginated cache_entries ─────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '20', 10))
  const siteId = searchParams.get('site_id')

  let query = supabaseAdmin
    .from('cache_entries')
    .select('*', { count: 'exact' })
    .order('cached_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  if (siteId) query = query.eq('site_id', siteId)

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data, page, limit, total: count ?? 0 })
}

// ── POST /api/cache — manually render + cache a URL ──────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { url, site_id, user_id, is_mobile } = body
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }
  const domain = parsed.hostname

  const { html, renderTimeMs, statusCode, error } = await renderPage(url, !!is_mobile)
  if (error || !html) {
    return NextResponse.json({ error: error ?? 'Render failed' }, { status: 502 })
  }

  await setCachedPage(domain, url, html, CACHE_TTL)

  await supabaseAdmin.from('cache_entries').upsert(
    {
      site_id: site_id ?? null,
      user_id: user_id ?? null,
      url,
      url_hash: `${domain}:${parsed.pathname}${parsed.search}`,
      status_code: statusCode,
      html_size_bytes: Buffer.byteLength(html, 'utf8'),
      render_time_ms: renderTimeMs,
      cached_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + CACHE_TTL * 1000).toISOString(),
      is_mobile: !!is_mobile,
    },
    { onConflict: 'url_hash' }
  )

  return NextResponse.json({ success: true, url, statusCode, renderTimeMs })
}

// ── DELETE — single url, or ?action=clear-all&site_id= ───────────────────────
export async function DELETE(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const action = searchParams.get('action')
  const url = searchParams.get('url')

  // Clear all entries for a site
  if (action === 'clear-all') {
    const siteId = searchParams.get('site_id')
    if (!siteId) {
      return NextResponse.json({ error: 'site_id required' }, { status: 400 })
    }
    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('domain')
      .eq('id', siteId)
      .single()

    let cleared = 0
    if (site?.domain) cleared = await clearDomainCache(site.domain)
    await supabaseAdmin.from('cache_entries').delete().eq('site_id', siteId)

    return NextResponse.json({ success: true, cleared })
  }

  // Delete a single URL
  if (url) {
    let domain: string
    try {
      domain = new URL(url).hostname
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }
    await deleteCachedPage(domain, url)
    await supabaseAdmin.from('cache_entries').delete().eq('url', url)
    return NextResponse.json({ success: true, cleared: 1 })
  }

  return NextResponse.json(
    { error: 'Provide ?url= or ?action=clear-all&site_id=' },
    { status: 400 }
  )
}
