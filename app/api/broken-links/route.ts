import { NextRequest, NextResponse } from 'next/server'
import axios from 'axios'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UA = 'RenderForAIBot/1.0 (+https://renderforai.com)'
const MAX_CHECK = 150 // URLs per scan (keeps within the function timeout)
const CONCURRENCY = 12

function userId(req: NextRequest) {
  return req.headers.get('x-user-id')
}

// Resolve a URL's live HTTP status. HEAD first; fall back to GET for servers
// that block HEAD. Returns 0 on a network/DNS error.
async function checkStatus(url: string): Promise<number> {
  const cfg = {
    timeout: 12000,
    validateStatus: () => true as const,
    maxRedirects: 3,
    headers: { 'User-Agent': UA },
  }
  try {
    const head = await axios.head(url, cfg)
    if ([403, 405, 501].includes(head.status)) {
      const get = await axios.get(url, { ...cfg, responseType: 'text', maxContentLength: 2 * 1024 * 1024 })
      return get.status
    }
    return head.status
  } catch {
    try {
      const get = await axios.get(url, { ...cfg, responseType: 'text', maxContentLength: 2 * 1024 * 1024 })
      return get.status
    } catch {
      return 0
    }
  }
}

// ── GET /api/broken-links?site_id= — list for the user's sites ───────────────
export async function GET(req: NextRequest) {
  const uid = userId(req)
  if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

  const siteId = req.nextUrl.searchParams.get('site_id')

  // Restrict to sites owned by this user.
  const { data: sites } = await supabaseAdmin
    .from('sites')
    .select('id')
    .eq('user_id', uid)
  const siteIds = (sites ?? []).map((s) => s.id)
  if (siteIds.length === 0) return NextResponse.json({ data: [] })

  // A requested site_id is honoured only if the user owns it — otherwise this
  // would return another account's broken links.
  if (siteId && !siteIds.includes(siteId)) return NextResponse.json({ data: [] })
  const filterIds = siteId ? [siteId] : siteIds

  let query = supabaseAdmin
    .from('broken_links')
    .select('*')
    .in('site_id', filterIds)
    .order('detected_at', { ascending: false })

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// ── POST /api/broken-links — scan a site's cached URLs ───────────────────────
export async function POST(req: NextRequest) {
  const uid = userId(req)
  if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { site_id } = body
  if (!site_id) return NextResponse.json({ error: 'site_id required' }, { status: 400 })

  // Confirm ownership.
  const { data: site } = await supabaseAdmin
    .from('sites')
    .select('id')
    .eq('id', site_id)
    .eq('user_id', uid)
    .single()
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  // Source URLs = sitemap URLs (caching_queue) ∪ already-rendered (cache_entries).
  const [{ data: queued }, { data: entries }] = await Promise.all([
    supabaseAdmin.from('caching_queue').select('url').eq('site_id', site_id).limit(2000),
    supabaseAdmin.from('cache_entries').select('url').eq('site_id', site_id).limit(2000),
  ])
  const urlSet = new Set<string>()
  ;(queued ?? []).forEach((r) => urlSet.add(r.url))
  ;(entries ?? []).forEach((r) => urlSet.add(r.url))
  const urls = Array.from(urlSet).slice(0, MAX_CHECK)

  if (urls.length === 0) {
    return NextResponse.json({
      scanned: 0,
      broken: 0,
      links: [],
      message: 'No URLs to check yet — fetch the sitemap for this site first.',
    })
  }

  // Check in small concurrent batches to stay within the timeout.
  const broken: { url: string; status_code: number }[] = []
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (url) => ({ url, code: await checkStatus(url) }))
    )
    for (const r of results) {
      if (r.code === 0 || r.code >= 400) broken.push({ url: r.url, status_code: r.code })
    }
  }

  // Don't duplicate URLs already flagged & still open.
  const { data: openRows } = await supabaseAdmin
    .from('broken_links')
    .select('url')
    .eq('site_id', site_id)
    .eq('resolved', false)
  const have = new Set((openRows ?? []).map((r) => r.url))

  const toInsert = broken
    .filter((b) => !have.has(b.url))
    .map((b) => ({
      site_id,
      url: b.url,
      status_code: b.status_code,
      detected_at: new Date().toISOString(),
      resolved: false,
    }))

  if (toInsert.length > 0) {
    await supabaseAdmin.from('broken_links').insert(toInsert)
  }

  return NextResponse.json({
    scanned: urls.length,
    broken: broken.length,
    newlyFound: toInsert.length,
    links: broken,
  })
}

// ── PATCH /api/broken-links?id= — mark resolved ──────────────────────────────
export async function PATCH(req: NextRequest) {
  const uid = userId(req)
  if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Ownership: only update the row if its site belongs to this user (broken_links
  // has no user_id column, so scope by the user's site ids).
  const { data: sites } = await supabaseAdmin
    .from('sites')
    .select('id')
    .eq('user_id', uid)
  const siteIds = (sites ?? []).map((s) => s.id)
  if (siteIds.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await supabaseAdmin
    .from('broken_links')
    .update({ resolved: true })
    .eq('id', id)
    .in('site_id', siteIds)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
