import { NextRequest, NextResponse } from 'next/server'
import { setCachedPage, deleteCachedPage, clearDomainCache } from '@/lib/kv'
import { renderPage } from '@/lib/renderer'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CACHE_TTL = 86400

function userId(req: NextRequest) {
  return req.headers.get('x-user-id')
}

// Junk URL patterns that should never appear in the cache list/stats (search
// results, /api, admin, feeds, config/non-HTML files, cart actions). Old entries
// rendered before URL-filtering existed are hidden here and expire on their own.
const JUNK_PATTERNS = [
  '%?s=%', '%&s=%', '%/api/%', '%/wp-admin/%', '%/wp-json/%', '%/wp-login%',
  '%xmlrpc.php%', '%/feed%', '%/cart%', '%/checkout%', '%/my-account%',
  '%?add-to-cart=%', '%?replytocom=%', '%.env%', '%.json', '%.xml',
]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function excludeJunk<T extends { not: (...a: any[]) => T }>(q: T): T {
  for (const p of JUNK_PATTERNS) q = q.not('url', 'ilike', p)
  return q
}

// Confirm a site belongs to the user (returns its domain, or null).
async function ownedSiteDomain(siteId: string, uid: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('sites')
    .select('domain')
    .eq('id', siteId)
    .eq('user_id', uid)
    .maybeSingle()
  return data?.domain ?? null
}

// ── GET /api/cache — list (paginated) OR ?summary=true (aggregate stats) ──────
export async function GET(req: NextRequest) {
  const uid = userId(req)
  if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const siteId = searchParams.get('site_id')

  // ── Aggregate stats for the cards ──────────────────────────────────────────
  if (searchParams.get('summary') === 'true') {
    let countQ = supabaseAdmin
      .from('cache_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uid)
    if (siteId) countQ = countQ.eq('site_id', siteId)
    countQ = excludeJunk(countQ)
    const { count } = await countQ

    let sizeQ = supabaseAdmin
      .from('cache_entries')
      .select('html_size_bytes, cached_at, expires_at')
      .eq('user_id', uid)
      .limit(5000)
    if (siteId) sizeQ = sizeQ.eq('site_id', siteId)
    sizeQ = excludeJunk(sizeQ)
    const { data: rows } = await sizeQ

    let totalSizeBytes = 0
    let ttlSum = 0
    let ttlCount = 0
    for (const r of rows ?? []) {
      totalSizeBytes += r.html_size_bytes ?? 0
      if (r.expires_at && r.cached_at) {
        ttlSum += new Date(r.expires_at).getTime() - new Date(r.cached_at).getTime()
        ttlCount++
      }
    }
    const avgTtlHours = ttlCount ? ttlSum / ttlCount / 3_600_000 : 0

    // Hit rate from the last 30 days of renders.
    const since = new Date(Date.now() - 30 * 86400_000).toISOString()
    let hitsQ = supabaseAdmin
      .from('renders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uid)
      .eq('cache_hit', true)
      .gte('created_at', since)
    let totQ = supabaseAdmin
      .from('renders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uid)
      .gte('created_at', since)
    if (siteId) {
      hitsQ = hitsQ.eq('site_id', siteId)
      totQ = totQ.eq('site_id', siteId)
    }
    const [{ count: hits }, { count: totalRenders }] = await Promise.all([hitsQ, totQ])
    const hitRate = totalRenders ? Math.round(((hits ?? 0) / totalRenders) * 100) : 0

    return NextResponse.json({
      summary: { total: count ?? 0, totalSizeBytes, avgTtlHours, hitRate },
    })
  }

  // ── Paginated list ─────────────────────────────────────────────────────────
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '20', 10))

  let query = supabaseAdmin
    .from('cache_entries')
    .select('*', { count: 'exact' })
    .eq('user_id', uid)
    .order('cached_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)
  if (siteId) query = query.eq('site_id', siteId)
  query = excludeJunk(query)

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data, page, limit, total: count ?? 0 })
}

// ── POST /api/cache — manually render + (re)cache a URL ──────────────────────
export async function POST(req: NextRequest) {
  const uid = userId(req)
  if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { url, site_id, is_mobile } = body
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  // If a site is specified, it must belong to this user.
  if (site_id && !(await ownedSiteDomain(site_id, uid))) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }

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
      user_id: uid,
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

// ── DELETE — single ?url=, or ?action=clear-all&site_id= ─────────────────────
export async function DELETE(req: NextRequest) {
  const uid = userId(req)
  if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const action = searchParams.get('action')
  const url = searchParams.get('url')

  // Clear all entries for one of the user's sites.
  if (action === 'clear-all') {
    const siteId = searchParams.get('site_id')
    if (!siteId) return NextResponse.json({ error: 'site_id required' }, { status: 400 })

    const domain = await ownedSiteDomain(siteId, uid)
    if (!domain) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    let cleared = 0
    try {
      cleared = await clearDomainCache(domain)
    } catch {
      /* continue with DB cleanup even if KV clear fails */
    }
    await supabaseAdmin.from('cache_entries').delete().eq('site_id', siteId).eq('user_id', uid)
    return NextResponse.json({ success: true, cleared })
  }

  // Delete a single cached URL (only if owned by this user).
  if (url) {
    let domain: string
    try {
      domain = new URL(url).hostname
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }
    const { data: entry } = await supabaseAdmin
      .from('cache_entries')
      .select('id')
      .eq('url', url)
      .eq('user_id', uid)
      .maybeSingle()
    if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await deleteCachedPage(domain, url)
    await supabaseAdmin.from('cache_entries').delete().eq('id', entry.id)
    return NextResponse.json({ success: true, cleared: 1 })
  }

  return NextResponse.json(
    { error: 'Provide ?url= or ?action=clear-all&site_id=' },
    { status: 400 }
  )
}
