import { NextRequest, NextResponse } from 'next/server'
import axios from 'axios'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function userId(req: NextRequest) {
  return req.headers.get('x-user-id')
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

  let query = supabaseAdmin
    .from('broken_links')
    .select('*')
    .in('site_id', siteId ? [siteId] : siteIds)
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

  const { data: entries } = await supabaseAdmin
    .from('cache_entries')
    .select('url')
    .eq('site_id', site_id)

  const urls = (entries ?? []).map((e) => e.url)
  const broken: { url: string; status_code: number }[] = []

  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await axios.head(url, {
          timeout: 10000,
          validateStatus: () => true,
          headers: { 'User-Agent': 'RenderFastBot/1.0' },
        })
        if (res.status >= 400) broken.push({ url, status_code: res.status })
      } catch {
        broken.push({ url, status_code: 0 })
      }
    })
  )

  if (broken.length > 0) {
    await supabaseAdmin.from('broken_links').insert(
      broken.map((b) => ({
        site_id,
        url: b.url,
        status_code: b.status_code,
        detected_at: new Date().toISOString(),
        resolved: false,
      }))
    )
  }

  return NextResponse.json({ scanned: urls.length, broken: broken.length, links: broken })
}

// ── PATCH /api/broken-links?id= — mark resolved ──────────────────────────────
export async function PATCH(req: NextRequest) {
  const uid = userId(req)
  if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('broken_links')
    .update({ resolved: true })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
