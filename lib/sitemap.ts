import axios from 'axios'
import { parseStringPromise } from 'xml2js'
import { supabaseAdmin } from '@/lib/supabase'
import { getOpsConfig } from '@/lib/app-config'
import { normalizeUrl, isRenderableUrl } from '@/lib/url-utils'

// Keep batches sane for free-tier DBs / function timeouts.
const MAX_CHILD_SITEMAPS = 20
const UA = 'RenderFastBot/1.0 (+https://renderfast.vercel.app)'

export interface SitemapResult {
  sitemapUrl: string | null
  found: number
  queued: number
}

interface SitemapPage {
  loc: string
  lastmod: string | null
}

// Pull <loc> (+ <lastmod>) out of a urlset (pages) or sitemapindex (children).
function extractLocs(parsed: any): { pages: SitemapPage[]; sitemaps: string[] } {
  const pages: SitemapPage[] = []
  const sitemaps: string[] = []
  if (parsed?.urlset?.url) {
    for (const u of parsed.urlset.url) {
      if (u?.loc?.[0]) pages.push({ loc: String(u.loc[0]).trim(), lastmod: u?.lastmod?.[0] ? String(u.lastmod[0]).trim() : null })
    }
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

// Crawl the sitemap(s) for a domain → Map of normalized renderable URL → lastmod.
// Follows one level of sitemap-index children. Returns the sitemap URL used.
async function crawlSitemap(
  domain: string,
  maxUrls: number
): Promise<{ urls: Map<string, string | null>; sitemapUrl: string | null }> {
  const candidates = await discoverSitemapUrls(domain)
  const urls = new Map<string, string | null>()
  let usedSitemap: string | null = null

  const add = (pages: SitemapPage[]): boolean => {
    let added = false
    for (const p of pages) {
      if (urls.size >= maxUrls) break
      if (!isRenderableUrl(p.loc)) continue
      const url = normalizeUrl(p.loc)
      if (!urls.has(url)) {
        urls.set(url, p.lastmod)
        added = true
      }
    }
    return added
  }

  for (const sm of candidates) {
    if (urls.size >= maxUrls) break
    try {
      const { pages, sitemaps: childMaps } = extractLocs(await fetchXml(sm))
      if (add(pages)) usedSitemap = usedSitemap ?? sm
      for (const child of childMaps.slice(0, MAX_CHILD_SITEMAPS)) {
        if (urls.size >= maxUrls) break
        try {
          if (add(extractLocs(await fetchXml(child)).pages)) usedSitemap = usedSitemap ?? sm
        } catch {
          /* skip bad child sitemap */
        }
      }
    } catch {
      /* try next candidate */
    }
  }

  return { urls, sitemapUrl: usedSitemap ?? candidates[0] ?? `https://${domain}/sitemap.xml` }
}

// Insert URLs into the queue, skipping any already present for the site.
async function queueUrls(siteId: string, userId: string, urlList: string[]): Promise<number> {
  if (urlList.length === 0) return 0
  const { data: existingRows } = await supabaseAdmin
    .from('caching_queue')
    .select('url')
    .eq('site_id', siteId)
    .in('status', ['pending', 'rendering'])
    .limit(5000)
  const have = new Set((existingRows ?? []).map((r: { url: string }) => r.url))

  const toInsert = urlList
    .filter((u) => !have.has(u))
    .map((url) => ({ site_id: siteId, user_id: userId, url, status: 'pending' as const, priority: 5 }))

  for (let i = 0; i < toInsert.length; i += 500) {
    await supabaseAdmin.from('caching_queue').insert(toInsert.slice(i, i + 500))
  }
  return toInsert.length
}

// Discover a site's sitemap, record it, and queue ALL its page URLs (first time).
export async function discoverAndQueueSitemap(
  siteId: string,
  userId: string,
  domain: string
): Promise<SitemapResult> {
  const { sitemapMaxUrls: MAX_URLS } = await getOpsConfig()
  const { urls, sitemapUrl } = await crawlSitemap(domain, MAX_URLS)
  const urlList = [...urls.keys()]
  const ok = urlList.length > 0

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

  const queued = ok ? await queueUrls(siteId, userId, urlList) : 0
  return { sitemapUrl, found: urlList.length, queued }
}

// Re-crawl the sitemap and queue ONLY URLs that are new or whose <lastmod> is
// newer than our cached copy — so unchanged pages are never re-rendered.
export async function recheckSitemap(
  siteId: string,
  userId: string,
  domain: string
): Promise<SitemapResult> {
  const { sitemapMaxUrls: MAX_URLS } = await getOpsConfig()
  const { urls, sitemapUrl } = await crawlSitemap(domain, MAX_URLS)
  const urlArr = [...urls.keys()]

  // When did we last cache each of these URLs?
  const cachedAt = new Map<string, string>()
  for (let i = 0; i < urlArr.length; i += 200) {
    const chunk = urlArr.slice(i, i + 200)
    const { data } = await supabaseAdmin
      .from('cache_entries')
      .select('url, cached_at')
      .eq('site_id', siteId)
      .in('url', chunk)
    for (const r of (data ?? []) as { url: string; cached_at: string }[]) cachedAt.set(r.url, r.cached_at)
  }

  // Queue: brand-new URLs, or pages whose lastmod is newer than our cache.
  const toQueue: string[] = []
  for (const [url, lastmod] of urls) {
    const cAt = cachedAt.get(url)
    if (!cAt) {
      toQueue.push(url) // never cached → render it
    } else if (lastmod && new Date(lastmod).getTime() > new Date(cAt).getTime()) {
      toQueue.push(url) // sitemap says it changed since we cached → re-render
    }
  }

  const queued = await queueUrls(siteId, userId, toQueue)

  await supabaseAdmin
    .from('sitemaps')
    .update({ last_crawled_at: new Date().toISOString(), urls_found: urls.size, status: 'active' })
    .eq('site_id', siteId)
    .eq('sitemap_url', sitemapUrl)

  return { sitemapUrl, found: urls.size, queued }
}
