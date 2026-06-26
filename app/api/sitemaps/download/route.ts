import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { isRenderableUrl } from '@/lib/url-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_URLS = 50000 // sitemap protocol limit per file

// Escape the five XML-significant characters in a URL before embedding in <loc>.
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// GET /api/sitemaps/download?site_id= — build & return a sitemap.xml from the
// pages we've actually rendered for this site (cache_entries). Owner-gated.
export async function GET(req: NextRequest) {
  try {
    const uid = req.headers.get('x-user-id')
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const siteId = req.nextUrl.searchParams.get('site_id')
    if (!siteId) return NextResponse.json({ error: 'site_id required' }, { status: 400 })

    // Ownership.
    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id, domain')
      .eq('id', siteId)
      .eq('user_id', uid)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    // Rendered pages = the canonical set of URLs to expose in the sitemap.
    const { data: rows } = await supabaseAdmin
      .from('cache_entries')
      .select('url, cached_at')
      .eq('site_id', siteId)
      .eq('user_id', uid)
      .order('cached_at', { ascending: false })
      .limit(MAX_URLS)

    // De-dupe + drop junk/asset URLs (same filter the renderer/queue use).
    const seen = new Set<string>()
    const urls: { loc: string; lastmod: string | null }[] = []
    for (const r of rows ?? []) {
      if (!isRenderableUrl(r.url) || seen.has(r.url)) continue
      seen.add(r.url)
      urls.push({ loc: r.url, lastmod: r.cached_at })
    }

    const body =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls
        .map(
          (u) =>
            `  <url><loc>${xmlEscape(u.loc)}</loc>` +
            (u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString().slice(0, 10)}</lastmod>` : '') +
            `</url>`
        )
        .join('\n') +
      `\n</urlset>\n`

    const filename = `sitemap-${site.domain.replace(/^www\./, '')}.xml`
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e) {
    console.error('[SITEMAP_DOWNLOAD]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
