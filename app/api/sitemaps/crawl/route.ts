import { NextRequest, NextResponse } from 'next/server'
import axios from 'axios'
import { parseStringPromise } from 'xml2js'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Recursively extract <loc> URLs from urlset or sitemapindex documents.
function extractLocs(parsed: any): string[] {
  const locs: string[] = []
  if (parsed?.urlset?.url) {
    for (const u of parsed.urlset.url) {
      if (u.loc?.[0]) locs.push(u.loc[0].trim())
    }
  }
  if (parsed?.sitemapindex?.sitemap) {
    for (const s of parsed.sitemapindex.sitemap) {
      if (s.loc?.[0]) locs.push(s.loc[0].trim())
    }
  }
  return locs
}

export async function POST(req: NextRequest) {
  const uid = req.headers.get('x-user-id')
  if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { sitemap_id, sitemap_url } = body
  if (!sitemap_id || !sitemap_url) {
    return NextResponse.json({ error: 'sitemap_id and sitemap_url required' }, { status: 400 })
  }

  // Look up the sitemap to get its site_id (and confirm ownership).
  const { data: sitemap } = await supabaseAdmin
    .from('sitemaps')
    .select('id, site_id, user_id')
    .eq('id', sitemap_id)
    .eq('user_id', uid)
    .single()

  if (!sitemap) {
    return NextResponse.json({ error: 'Sitemap not found' }, { status: 404 })
  }

  // Fetch + parse the XML.
  let urls: string[]
  try {
    const res = await axios.get(sitemap_url, {
      timeout: 20000,
      headers: { 'User-Agent': 'RenderFastBot/1.0' },
    })
    const parsed = await parseStringPromise(res.data)
    urls = extractLocs(parsed)
  } catch (err) {
    await supabaseAdmin.from('sitemaps').update({ status: 'error' }).eq('id', sitemap_id)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch sitemap' },
      { status: 502 }
    )
  }

  // Queue each URL.
  if (urls.length > 0) {
    const rows = urls.map((url) => ({
      site_id: sitemap.site_id,
      user_id: uid,
      url,
      status: 'pending' as const,
      priority: 5,
    }))
    await supabaseAdmin.from('caching_queue').insert(rows)
  }

  await supabaseAdmin
    .from('sitemaps')
    .update({
      urls_found: urls.length,
      last_crawled_at: new Date().toISOString(),
      status: 'active',
    })
    .eq('id', sitemap_id)

  return NextResponse.json({ queued: urls.length, urls })
}
