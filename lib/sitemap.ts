import axios from 'axios'
import { parseStringPromise } from 'xml2js'
import { supabaseAdmin } from '@/lib/supabase'
import { getOpsConfig } from '@/lib/app-config'

// Keep batches sane for free-tier DBs / function timeouts.
const MAX_CHILD_SITEMAPS = 20
const UA = 'RenderFastBot/1.0 (+https://renderfast.vercel.app)'

export interface SitemapResult {
  sitemapUrl: string | null
  found: number
  queued: number
}

// Pull <loc> entries out of a urlset (pages) or sitemapindex (child sitemaps).
function extractLocs(parsed: any): { pages: string[]; sitemaps: string[] } {
  const pages: string[] = []
  const sitemaps: string[] = []
  if (parsed?.urlset?.url) {
    for (const u of parsed.urlset.url) if (u?.loc?.[0]) pages.push(String(u.loc[0]).trim())
  }
  if (parsed?.sitemapindex?.sitemap) {
    for (const s of parsed.sitemapindex.sitemap) if (s?.loc?.[0]) sitemaps.push(String(s.loc[0]).trim())
  }
  return { pages, sitemaps }
}

async function fetchXml(url: string) {
  const res = await axios.get(url, {
    timeout: 15000,
    headers: { 'User-Agent': UA, Accept: 'application/xml,text/xml,*/*' },
    maxContentLength: 12 * 1024 * 1024,
    responseType: 'text',
  })
  return parseStringPromise(res.data)
}

// Find candidate sitemap URLs: robots.txt "Sitemap:" lines, else common defaults.
async function discoverSitemapUrls(domain: string): Promise<string[]> {
  const base = `https://${domain}`
  const found: string[] = []
  try {
    const r = await axios.get(`${base}/robots.txt`, {
      timeout: 10000,
      headers: { 'User-Agent': UA },
      responseType: 'text',
    })
    for (const line of String(r.data).split(/\r?\n/)) {
      const m = line.match(/^\s*sitemap:\s*(\S+)/i)
      if (m) found.push(m[1].trim())
    }
  } catch {
    // robots.txt missing/blocked — fall back to defaults below
  }
  if (found.length === 0) {
    found.push(`${base}/sitemap.xml`, `${base}/sitemap_index.xml`)
  }
  return Array.from(new Set(found))
}

// Discover a site's sitemap, record it, and queue its page URLs for rendering.
export async function discoverAndQueueSitemap(
  siteId: string,
  userId: string,
  domain: string
): Promise<SitemapResult> {
  // Admin-configurable cap (Platform Settings → render queue).
  const { sitemapMaxUrls: MAX_URLS } = await getOpsConfig()
  const candidates = await discoverSitemapUrls(domain)
  const pages = new Set<string>()
  let usedSitemap: string | null = null

  for (const sm of candidates) {
    if (pages.size >= MAX_URLS) break
    try {
      const { pages: p, sitemaps: childMaps } = extractLocs(await fetchXml(sm))
      if (p.length) {
        usedSitemap = usedSitemap ?? sm
        p.forEach((u) => pages.add(u))
      }
      // Follow one level of sitemap-index children.
      for (const child of childMaps.slice(0, MAX_CHILD_SITEMAPS)) {
        if (pages.size >= MAX_URLS) break
        try {
          const cp = extractLocs(await fetchXml(child)).pages
          if (cp.length) {
            usedSitemap = usedSitemap ?? sm
            cp.forEach((u) => pages.add(u))
          }
        } catch {
          /* skip bad child sitemap */
        }
      }
    } catch {
      /* try next candidate */
    }
  }

  const urlList = Array.from(pages).slice(0, MAX_URLS)
  const sitemapUrl = usedSitemap ?? candidates[0] ?? `https://${domain}/sitemap.xml`
  const ok = urlList.length > 0

  // Upsert the sitemaps record for this site.
  const { data: existing } = await supabaseAdmin
    .from('sitemaps')
    .select('id')
    .eq('site_id', siteId)
    .eq('sitemap_url', sitemapUrl)
    .maybeSingle()

  const meta = {
    urls_found: urlList.length,
    last_crawled_at: new Date().toISOString(),
    status: (ok ? 'active' : 'error') as 'active' | 'error',
  }

  if (existing?.id) {
    await supabaseAdmin.from('sitemaps').update(meta).eq('id', existing.id)
  } else {
    await supabaseAdmin
      .from('sitemaps')
      .insert({ user_id: userId, site_id: siteId, sitemap_url: sitemapUrl, ...meta })
  }

  // Queue URLs that aren't already queued for this site.
  let queued = 0
  if (ok) {
    const { data: existingRows } = await supabaseAdmin
      .from('caching_queue')
      .select('url')
      .eq('site_id', siteId)
      .limit(5000)
    const have = new Set((existingRows ?? []).map((r: { url: string }) => r.url))

    const toInsert = urlList
      .filter((u) => !have.has(u))
      .map((url) => ({ site_id: siteId, user_id: userId, url, status: 'pending' as const, priority: 5 }))

    for (let i = 0; i < toInsert.length; i += 500) {
      await supabaseAdmin.from('caching_queue').insert(toInsert.slice(i, i + 500))
    }
    queued = toInsert.length
  }

  return { sitemapUrl, found: urlList.length, queued }
}
