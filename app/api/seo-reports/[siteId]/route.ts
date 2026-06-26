import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeUrl } from '@/lib/url-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// How many diagnostic rows to scan (newest first). We keep the latest row per
// URL, so this bounds the work for very large sites to a recent sample.
const SCAN_LIMIT = 5000
const LOW_WORD_THRESHOLD = 200 // pages with fewer visible words are flagged

interface DiagRow {
  url: string
  rendered_at: string
  page_title: string | null
  canonical_url: string | null
  word_count: number | null
  content_hash: string | null
  inner_links: string[] | null
  hreflang_links: { lang: string; href: string }[] | null
  http_status: number | null
  console_errors: string[] | null
}

// Normalise a URL for cross-referencing (inner links ⇄ page urls ⇄ hreflang/
// canonical hrefs). Best-effort; falls back to the raw string.
function key(u: string | null | undefined): string {
  if (!u) return ''
  try {
    return normalizeUrl(u).replace(/\/$/, '').toLowerCase()
  } catch {
    return u.replace(/\/$/, '').toLowerCase()
  }
}

// GET /api/seo-reports/:siteId — technical-SEO reports built from the latest
// diagnostic per URL. Owner-gated.
export async function GET(req: NextRequest, ctx: { params: Promise<{ siteId: string }> }) {
  try {
    const uid = req.headers.get('x-user-id')
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const { siteId } = await ctx.params

    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id, domain')
      .eq('id', siteId)
      .eq('user_id', uid)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const { data: rows } = await supabaseAdmin
      .from('render_diagnostics')
      .select(
        'url, rendered_at, page_title, canonical_url, word_count, content_hash, inner_links, hreflang_links, http_status, console_errors'
      )
      .eq('site_id', siteId)
      .order('rendered_at', { ascending: false })
      .limit(SCAN_LIMIT)

    // Keep only the most recent diagnostic per URL.
    const latestByUrl = new Map<string, DiagRow>()
    for (const r of (rows ?? []) as DiagRow[]) {
      const k = key(r.url)
      if (!latestByUrl.has(k)) latestByUrl.set(k, r)
    }
    const pages = [...latestByUrl.values()]

    if (pages.length === 0) {
      return NextResponse.json({
        domain: site.domain,
        empty: true,
        message: 'No analysed pages yet — run a Bot Visibility scan or let bots crawl your site, then check back.',
        totals: { analyzedPages: 0, innerLinks: 0, pagesWithCanonical: 0, innerRedirects: 0 },
        duplicateTitles: [],
        duplicateContents: [],
        lowWordCount: [],
        jsErrors: [],
        missingHreflang: [],
        explorer: [],
      })
    }

    // A page is "canonicalised away" if its canonical points to a DIFFERENT url —
    // such pages are excluded from duplicate reports (intentional duplicates).
    const isCanonicalisedAway = (p: DiagRow) => !!p.canonical_url && key(p.canonical_url) !== key(p.url)

    // ── Duplicate titles ────────────────────────────────────────────────────────
    const titleGroups = new Map<string, string[]>()
    for (const p of pages) {
      if (isCanonicalisedAway(p)) continue
      const t = (p.page_title ?? '').trim() || '[empty title]'
      const arr = titleGroups.get(t) ?? []
      arr.push(p.url)
      titleGroups.set(t, arr)
    }
    const duplicateTitles = [...titleGroups.entries()]
      .filter(([, urls]) => urls.length > 1)
      .map(([title, urls]) => ({ title, count: urls.length, pages: urls.slice(0, 100) }))
      .sort((a, b) => b.count - a.count)

    // ── Duplicate contents ──────────────────────────────────────────────────────
    const contentGroups = new Map<string, string[]>()
    for (const p of pages) {
      if (isCanonicalisedAway(p) || !p.content_hash) continue
      const arr = contentGroups.get(p.content_hash) ?? []
      arr.push(p.url)
      contentGroups.set(p.content_hash, arr)
    }
    const duplicateContents = [...contentGroups.values()]
      .filter((urls) => urls.length > 1)
      .map((urls) => ({ sample: urls[0], count: urls.length, pages: urls.slice(0, 100) }))
      .sort((a, b) => b.count - a.count)

    // ── Low word count ──────────────────────────────────────────────────────────
    const lowWordCount = pages
      .filter((p) => typeof p.word_count === 'number' && (p.word_count ?? 0) < LOW_WORD_THRESHOLD)
      .map((p) => ({ url: p.url, wordCount: p.word_count ?? 0 }))
      .sort((a, b) => a.wordCount - b.wordCount)
      .slice(0, 200)

    // ── JavaScript errors ───────────────────────────────────────────────────────
    const jsErrors = pages
      .filter((p) => (p.console_errors?.length ?? 0) > 0)
      .map((p) => ({ url: p.url, count: p.console_errors!.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 200)

    // ── Missing hreflang confirmation links ──────────────────────────────────────
    // If page Y declares hreflang → X, then X must declare hreflang → Y back.
    const pageByKey = new Map(pages.map((p) => [key(p.url), p]))
    const ownHreflang = new Map<string, Set<string>>() // page key → set of target keys it points to
    for (const p of pages) {
      ownHreflang.set(key(p.url), new Set((p.hreflang_links ?? []).map((h) => key(h.href))))
    }
    const missingByPage = new Map<string, Set<string>>() // X key → set of Y urls X should point back to
    for (const y of pages) {
      for (const h of y.hreflang_links ?? []) {
        const xKey = key(h.href)
        if (xKey === key(y.url)) continue // self-reference
        if (!pageByKey.has(xKey)) continue // target not in our analysed set
        const xPoints = ownHreflang.get(xKey)
        if (!xPoints || !xPoints.has(key(y.url))) {
          const set = missingByPage.get(xKey) ?? new Set<string>()
          set.add(y.url)
          missingByPage.set(xKey, set)
        }
      }
    }
    const missingHreflang = [...missingByPage.entries()]
      .map(([k, set]) => ({ url: pageByKey.get(k)!.url, expectedFrom: [...set].slice(0, 50), count: set.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 200)

    // ── Referrers (who links to each page) + structure totals ─────────────────────
    const referrerCount = new Map<string, number>()
    let innerLinksTotal = 0
    for (const p of pages) {
      const links = p.inner_links ?? []
      innerLinksTotal += links.length
      for (const l of links) {
        const lk = key(l)
        if (pageByKey.has(lk)) referrerCount.set(lk, (referrerCount.get(lk) ?? 0) + 1)
      }
    }

    const explorer = pages
      .map((p) => ({
        url: p.url,
        httpStatus: p.http_status ?? null,
        title: p.page_title ?? null,
        canonical: p.canonical_url ?? null,
        innerLinks: (p.inner_links ?? []).length,
        referrers: referrerCount.get(key(p.url)) ?? 0,
      }))
      .sort((a, b) => b.referrers - a.referrers)

    const totals = {
      analyzedPages: pages.length,
      innerLinks: innerLinksTotal,
      pagesWithCanonical: pages.filter((p) => !!p.canonical_url).length,
      innerRedirects: pages.filter((p) => (p.http_status ?? 0) >= 300 && (p.http_status ?? 0) < 400).length,
    }

    return NextResponse.json({
      domain: site.domain,
      empty: false,
      totals,
      duplicateTitles,
      duplicateContents,
      lowWordCount,
      jsErrors,
      missingHreflang,
      explorer,
    })
  } catch (e) {
    console.error('[SEO_REPORTS]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
