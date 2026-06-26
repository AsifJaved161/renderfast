import { XMLParser } from 'fast-xml-parser'
import { supabaseAdmin } from '@/lib/supabase'
import { getOpsConfig } from '@/lib/app-config'
import { normalizeUrl, isRenderableUrl } from '@/lib/url-utils'

// Keep batches sane for free-tier DBs / function timeouts.
const MAX_CHILD_SITEMAPS = 20
const UA = 'RenderForAIBot/1.0 (+https://renderforai.com)'

// <url>/<sitemap> are forced to arrays so single-entry sitemaps parse the same
// as multi-entry ones; parseTagValue:false keeps <loc>/<lastmod> as raw strings
// (no numeric coercion), matching the previous xml2js behaviour.
const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === 'url' || name === 'sitemap',
})

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
// fast-xml-parser yields <loc>/<lastmod> as strings directly (the `url`/`sitemap`
// wrappers are forced to arrays via the parser config above).
function extractLocs(parsed: any): { pages: SitemapPage[]; sitemaps: string[] } {
  const pages: SitemapPage[] = []
  const sitemaps: string[] = []
  const urls = parsed?.urlset?.url
  if (Array.isArray(urls)) {
    for (const u of urls) {
      if (u?.loc) pages.push({ loc: String(u.loc).trim(), lastmod: u?.lastmod != null ? String(u.lastmod).trim() : null })
    }
  }
  const childMaps = parsed?.sitemapindex?.sitemap
  if (Array.isArray(childMaps)) {
    for (const s of childMaps) if (s?.loc) sitemaps.push(String(s.loc).trim())
  }
  return { pages, sitemaps }
}

async function fetchXml(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/xml,text/xml,*/*' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return xmlParser.parse(await res.text())
}

// Find candidate sitemap URLs: robots.txt "Sitemap:" lines, else common defaults.
async function discoverSitemapUrls(domain: string): Promise<string[]> {
  const base = `https://${domain}`
  const found: string[] = []
  try {
    const r = await fetch(`${base}/robots.txt`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000),
    })
    if (r.ok) {
      for (const line of (await r.text()).split(/\r?\n/)) {
        const m = line.match(/^\s*sitemap:\s*(\S+)/i)
        if (m) found.push(m[1].trim())
      }
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

// Queue URLs for rendering without creating duplicates: insert brand-new URLs,
// reset already-finished (completed/failed) rows back to pending, and leave
// rows that are still pending/rendering untouched.
async function queueUrls(siteId: string, userId: string, urlList: string[]): Promise<number> {
  if (urlList.length === 0) return 0

  // Look up existing queue rows for exactly these URLs.
  const existing = new Map<string, { id: string; status: string }>()
  for (let i = 0; i < urlList.length; i += 200) {
    const chunk = urlList.slice(i, i + 200)
    const { data } = await supabaseAdmin
      .from('caching_queue')
      .select('id, url, status')
      .eq('site_id', siteId)
      .in('url', chunk)
    for (const r of (data ?? []) as { id: string; url: string; status: string }[]) {
      existing.set(r.url, { id: r.id, status: r.status })
    }
  }

  const toInsert: { site_id: string; user_id: string; url: string; status: 'pending'; priority: number }[] = []
  const toResetIds: string[] = []
  for (const url of urlList) {
    const e = existing.get(url)
    if (!e) toInsert.push({ site_id: siteId, user_id: userId, url, status: 'pending', priority: 5 })
    else if (e.status === 'completed' || e.status === 'failed') toResetIds.push(e.id)
    // pending / rendering → already queued, leave it
  }

  for (let i = 0; i < toInsert.length; i += 500) {
    await supabaseAdmin.from('caching_queue').insert(toInsert.slice(i, i + 500))
  }
  for (let i = 0; i < toResetIds.length; i += 500) {
    await supabaseAdmin
      .from('caching_queue')
      .update({ status: 'pending', error_message: null, completed_at: null, attempts: 0 })
      .in('id', toResetIds.slice(i, i + 500))
  }

  return toInsert.length + toResetIds.length
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

  // Mark the site's sitemap as just crawled (by site_id so it's always recorded,
  // even if the discovered sitemap_url differs — prevents the cron re-looping it).
  await supabaseAdmin
    .from('sitemaps')
    .update({ last_crawled_at: new Date().toISOString(), urls_found: urls.size, status: 'active' })
    .eq('site_id', siteId)

  return { sitemapUrl, found: urls.size, queued }
}
