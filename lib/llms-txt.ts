// ─────────────────────────────────────────────────────────────────────────────
// llms.txt auto-generation.
//
// Produces the conventional llms.txt markdown for a site:
//
//   # {Site Name}
//   > {one-line description}
//   ## {Section}
//   - [{Page Title}]({url}): {short description}
//
// Data sources reuse the same pattern as the diagnostics re-scan: known rendered
// URLs come from cache_entries, falling back to caching_queue if the cache is
// empty. NOTE: RenderFast does not currently persist page <title>/meta text
// anywhere (render_diagnostics only records WHETHER those tags exist, not their
// content), so titles are derived from the URL slug and descriptions are omitted
// when absent. The shape below already reads a `title`/`description` column if
// one is ever added — it just falls back gracefully today.
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeUrl, isRenderableUrl } from '@/lib/url-utils'

// Cap so the file stays usable for large sites. Most-recently-rendered pages win
// (cache_entries is ordered by cached_at desc → freshest/most-relevant first).
const MAX_PAGES = 200

// ── Categorization — simple, pattern-based on the URL path (NOT AI). ──────────
// Ordered rules: the FIRST matching rule wins, so put more specific paths first.
// Anything that matches nothing lands in DEFAULT_SECTION ("Pages").
const SECTION_RULES: { test: RegExp; section: string }[] = [
  { test: /^\/(blog|news|articles?|posts?)(\/|$)/i, section: 'Blog' },
  { test: /^\/(docs?|documentation|guides?|manual|reference|reference\/api|api)(\/|$)/i, section: 'Documentation' },
  { test: /^\/(products?|features?|pricing|plans?|solutions?)(\/|$)/i, section: 'Product' },
  { test: /^\/(faqs?|help|support|knowledge-?base|kb)(\/|$)/i, section: 'Help' },
  { test: /^\/(about|company|team|contact|careers?|jobs?|legal|privacy|terms)(\/|$)/i, section: 'Company' },
]
const DEFAULT_SECTION = 'Pages'

// Section print order. Sections not listed here are appended after, alphabetically.
const SECTION_ORDER = ['Documentation', 'Product', 'Blog', 'Help', 'Company', DEFAULT_SECTION]

function sectionFor(path: string): string {
  for (const { test, section } of SECTION_RULES) if (test.test(path)) return section
  return DEFAULT_SECTION
}

// Cleaned-up title from a URL path (the fallback when no stored title exists):
// take the last meaningful path segment, decode it, strip any file extension,
// turn -/_ into spaces, and Title-Case the words. Root path → "Home".
function titleFromPath(path: string): string {
  const segments = path.split('/').filter(Boolean)
  const last = segments[segments.length - 1] ?? ''
  if (!last) return 'Home'
  let s = last
  try {
    s = decodeURIComponent(last)
  } catch {
    /* malformed %-encoding → use raw segment */
  }
  s = s
    .replace(/\.[a-z0-9]{1,8}$/i, '') // drop a trailing .html/.php/… extension
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return 'Home'
  // Title-case, preserving all-caps short tokens (API, FAQ, SEO…).
  return s
    .split(' ')
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

// Escape markdown link-breaking characters in link text.
function escapeMd(text: string): string {
  return text.replace(/([[\]])/g, '\\$1')
}

interface PageRow {
  url: string
  // Optional — present only if a future migration stores real page metadata.
  title?: string | null
  description?: string | null
}

interface Page {
  url: string
  title: string
  description: string | null
  section: string
}

// Public entry point. Async because it reads the DB (the "string" return in the
// spec is the resolved markdown). Returns a complete llms.txt document.
export async function generateLlmsTxt(siteId: string): Promise<string> {
  // ── Site name + description (fall back to the bare domain) ──────────────────
  const { data: site } = await supabaseAdmin
    .from('sites')
    .select('domain, name')
    .eq('id', siteId)
    .maybeSingle()

  const domain = (site?.domain ?? '').replace(/^www\./, '')
  const siteName = (site?.name && site.name.trim()) || domain || 'Website'
  const siteDescription = `Pages from ${domain || siteName}, served pre-rendered by RenderFast.`

  // ── Known rendered URLs: cache_entries first, caching_queue as fallback ─────
  // (same source pattern the diagnostics re-scan uses). Pull a few × the cap so
  // junk-filtering + de-duping still leaves a full set.
  const FETCH = MAX_PAGES * 3
  let rows: PageRow[] = []

  const { data: cached } = await supabaseAdmin
    .from('cache_entries')
    .select('url')
    .eq('site_id', siteId)
    .order('cached_at', { ascending: false })
    .limit(FETCH)
  rows = (cached ?? []) as PageRow[]

  if (rows.length === 0) {
    const { data: queued } = await supabaseAdmin
      .from('caching_queue')
      .select('url')
      .eq('site_id', siteId)
      .order('created_at', { ascending: false })
      .limit(FETCH)
    rows = (queued ?? []) as PageRow[]
  }

  // ── Normalize → drop junk/non-content URLs → de-dupe → cap ──────────────────
  const seen = new Set<string>()
  const pages: Page[] = []
  for (const r of rows) {
    if (pages.length >= MAX_PAGES) break
    const url = normalizeUrl(r.url)
    if (!isRenderableUrl(url) || seen.has(url)) continue
    seen.add(url)

    let path = '/'
    try {
      path = new URL(url).pathname || '/'
    } catch {
      continue // unparseable URL → skip
    }

    pages.push({
      url,
      // Prefer real metadata if it ever exists; else derive from the slug.
      title: (r.title && r.title.trim()) || titleFromPath(path),
      description: (r.description && r.description.trim()) || null,
      section: sectionFor(path),
    })
  }

  // ── Group by section ────────────────────────────────────────────────────────
  const bySection = new Map<string, Page[]>()
  for (const p of pages) {
    const arr = bySection.get(p.section) ?? []
    arr.push(p)
    bySection.set(p.section, arr)
  }

  // Print known sections in priority order, then any extras alphabetically.
  const sections = [
    ...SECTION_ORDER.filter((s) => bySection.has(s)),
    ...[...bySection.keys()].filter((s) => !SECTION_ORDER.includes(s)).sort(),
  ]

  // ── Build the markdown ──────────────────────────────────────────────────────
  const out: string[] = [`# ${siteName}`, '', `> ${siteDescription}`, '']

  if (pages.length === 0) {
    out.push('_No pages have been rendered yet._', '')
  } else {
    for (const section of sections) {
      const items = (bySection.get(section) ?? []).sort((a, b) => a.title.localeCompare(b.title))
      out.push(`## ${section}`, '')
      for (const p of items) {
        // Description is appended only when present, per llms.txt convention
        // (it's an optional trailing "- ...: description").
        out.push(`- [${escapeMd(p.title)}](${p.url})${p.description ? `: ${p.description}` : ''}`)
      }
      out.push('')
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache (llms_txt_cache) — generate-and-store + read-for-serving.
// ─────────────────────────────────────────────────────────────────────────────

// Regenerate the llms.txt for a site and upsert it into llms_txt_cache. Only
// content + generated_at are written, so an existing row's auto_enabled flag is
// preserved (new rows default to auto_enabled = true). Returns the new content.
export async function generateAndStoreLlmsTxt(siteId: string): Promise<string> {
  const content = await generateLlmsTxt(siteId)
  await supabaseAdmin
    .from('llms_txt_cache')
    .upsert(
      { site_id: siteId, content, generated_at: new Date().toISOString() },
      { onConflict: 'site_id' }
    )
  return content
}

// Content to serve for a site's /llms.txt, or null when it must NOT be served by
// RenderFast (auto_enabled = false → let the origin's own file through). On the
// first-ever request (no row yet) it generates, stores, and serves on the fly.
export async function getServableLlmsTxt(siteId: string): Promise<string | null> {
  const { data: row } = await supabaseAdmin
    .from('llms_txt_cache')
    .select('content, auto_enabled')
    .eq('site_id', siteId)
    .maybeSingle()

  if (row) {
    if (row.auto_enabled === false) return null // explicitly disabled for this site
    return row.content
  }

  // First request for this site → generate + store (auto_enabled defaults true).
  return generateAndStoreLlmsTxt(siteId)
}
