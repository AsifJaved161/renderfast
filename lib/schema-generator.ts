// ─────────────────────────────────────────────────────────────────────────────
// Schema (JSON-LD) auto-generation.
//
// generateSchema(renderedHtml, pageUrl, siteInfo) inspects the page's OWN
// already-rendered HTML — the same HTML the diagnostics flow produces — and,
// when it can confidently classify the page, builds valid schema.org JSON-LD
// from the content that is actually on the page. Nothing is re-fetched or
// re-rendered; this is a PURE function (HTML + URL in → schema out).
//
// Parsing is regex-based to match the rest of the codebase (no DOM-parser
// dependency). Each heuristic and extraction rule is commented so it can be
// tuned later without re-reading the whole file.
//
// Scope — 4 schema types cover almost every page:
//   • Article / BlogPosting — content/blog pages
//   • Product               — e-commerce/product pages
//   • FAQPage               — pages with visible Q&A content
//   • Organization          — homepage / about page (coexists with the above)
//
// This is generation only. Preview/approval, persistence and serving through
// the proxy are handled by later parts of this feature.
// ─────────────────────────────────────────────────────────────────────────────

export type SchemaType = 'Article' | 'Product' | 'FAQPage' | 'Organization'
export type Confidence = 'high' | 'medium' | 'low'

// What the caller already knows about the site (sourced from `sites` / settings
// by later parts). Everything except name/domain is optional — the generator
// falls back to discovering logo + social links from the HTML itself.
export interface SiteInfo {
  siteName: string // business / site name (sites.name or cleaned <title>)
  domain: string // hostname or origin, e.g. "example.com" or "https://example.com"
  homeUrl?: string // canonical homepage URL (Organization.url); defaults to the page origin
  logoUrl?: string // known logo URL; falls back to a logo <img> discovered in the markup
  sameAs?: string[] // known social profile URLs; merged with links discovered in the markup
}

// Each extracted field carries both its value AND where it came from, so the
// preview UI can show the client "we found X (from your <h1>)", not just a blob.
export interface ExtractedField {
  value: unknown
  source: string // human-readable origin, e.g. "h1", "meta description", "<time> element"
}
export type ExtractedFields = Record<string, ExtractedField>

export interface GeneratedSchema {
  schemaType: SchemaType // the PRIMARY type detected for this page
  jsonLd: Record<string, unknown> // primary JSON-LD object (ready to inject)
  confidence: Confidence
  extractedFields: ExtractedFields // field-by-field breakdown of the primary type
  // When the page is the homepage / an about page, an Organization schema is
  // generated alongside the primary type (both can be served on one page).
  organization?: {
    jsonLd: Record<string, unknown>
    extractedFields: ExtractedFields
  }
}

const SCHEMA_CONTEXT = 'https://schema.org'

// Resource-exhaustion guard — never process more than ~2 MB of HTML (matches
// the diagnostics cap; real pages are far smaller).
const MAX_HTML_BYTES = 2_000_000

// ── Generic HTML helpers (regex-based, parser-free) ──────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n)
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' '
    })
    .replace(/&[a-z0-9]+;/gi, ' ')
}

// Strip a fragment of HTML to its human-visible text.
function toText(html: string): string {
  if (!html) return ''
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()
}

function wordCount(text: string): number {
  return text ? text.split(/\s+/).filter(Boolean).length : 0
}

// Resolve a possibly-relative href against the page URL; null if unparseable.
function absUrl(href: string | undefined | null, base: string): string | null {
  if (!href) return null
  try {
    const u = new URL(href, base)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}

// First capture group of the first match, decoded to text; null if no match.
function firstText(html: string, re: RegExp): string | null {
  const m = html.match(re)
  if (!m) return null
  const v = decodeEntities(m[1] ?? '').replace(/\s+/g, ' ').trim()
  return v || null
}

// ── Shared field extractors (reused across types) ────────────────────────────

function extractTitle(html: string): string | null {
  return firstText(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
}

// The visible <h1> text (first one only).
function extractH1(html: string): string | null {
  return firstText(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
}

function extractMetaDescription(html: string): string | null {
  return (
    firstText(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    firstText(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
  )
}

function extractMeta(html: string, key: 'property' | 'name', value: string): string | null {
  const re = new RegExp(`<meta[^>]+${key}=["']${value}["'][^>]+content=["']([^"']+)["']`, 'i')
  const reRev = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${key}=["']${value}["']`, 'i')
  return firstText(html, re) || firstText(html, reRev)
}

// The page's main image: prefer og:image, else the first "content" <img> that
// isn't obviously a logo/icon/avatar/tracking pixel. Returned absolute.
function extractMainImage(html: string, pageUrl: string): string | null {
  const og = extractMeta(html, 'property', 'og:image')
  const ogAbs = absUrl(og, pageUrl)
  if (ogAbs) return ogAbs

  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0]
    const src = tag.match(/\ssrc=["']([^"']+)["']/i)?.[1]
    if (!src) continue
    const haystack = `${src} ${tag.match(/\salt=["']([^"']*)["']/i)?.[1] ?? ''} ${tag.match(/\sclass=["']([^"']*)["']/i)?.[1] ?? ''}`.toLowerCase()
    if (/logo|icon|avatar|sprite|pixel|spacer|1x1|tracking/.test(haystack)) continue
    const abs = absUrl(src, pageUrl)
    if (abs) return abs
  }
  return null
}

// ── Date parsing ──────────────────────────────────────────────────────────────
const MONTHS = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const DATE_PATTERNS: RegExp[] = [
  /\b(\d{4}-\d{2}-\d{2})\b/, // ISO 2026-01-05
  new RegExp(`\\b(${MONTHS}\\s+\\d{1,2},?\\s+\\d{4})\\b`, 'i'), // January 5, 2026
  new RegExp(`\\b(\\d{1,2}\\s+${MONTHS}\\s+\\d{4})\\b`, 'i'), // 5 January 2026
]

// Normalize a date-ish string to an ISO 8601 string (or a plain YYYY-MM-DD when
// it was date-only). Returns null when it can't be parsed reliably.
function toIsoDate(raw: string | null): string | null {
  if (!raw) return null
  const s = raw.trim()
  // Already ISO with time?
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  // Date-only ISO → keep as-is (no fake time component).
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  // Convert a parsed human date to YYYY-MM-DD (avoid inventing a timezone/time).
  return d.toISOString().slice(0, 10)
}

// Find a published/modified date from (in priority order): article meta tags,
// a <time datetime> attribute, a <time> element's text, or a visible date string.
function extractDates(html: string): { published: string | null; modified: string | null; source: string } {
  const metaPub = extractMeta(html, 'property', 'article:published_time')
  const metaMod = extractMeta(html, 'property', 'article:modified_time')
  if (metaPub || metaMod) {
    return { published: toIsoDate(metaPub), modified: toIsoDate(metaMod) || toIsoDate(metaPub), source: 'article:published_time meta' }
  }

  const timeAttr = html.match(/<time\b[^>]*\sdatetime=["']([^"']+)["']/i)?.[1]
  if (timeAttr && toIsoDate(timeAttr)) {
    const iso = toIsoDate(timeAttr)
    return { published: iso, modified: iso, source: '<time datetime> attribute' }
  }

  const timeText = firstText(html, /<time\b[^>]*>([\s\S]*?)<\/time>/i)
  if (timeText && toIsoDate(timeText)) {
    const iso = toIsoDate(timeText)
    return { published: iso, modified: iso, source: '<time> element' }
  }

  const text = toText(html)
  for (const re of DATE_PATTERNS) {
    const m = text.match(re)
    const iso = m && toIsoDate(m[1])
    if (iso) return { published: iso, modified: iso, source: 'visible date text' }
  }
  return { published: null, modified: null, source: 'none' }
}

// Find an author name from a meta tag, rel="author", an author-classed element,
// or a "By <Name>" byline near the top of the content.
function extractAuthor(html: string): { name: string | null; source: string } {
  const meta = extractMeta(html, 'name', 'author')
  if (meta) return { name: meta, source: 'author meta tag' }

  const relAuthor = firstText(html, /<a\b[^>]*\brel=["']author["'][^>]*>([\s\S]*?)<\/a>/i)
  if (relAuthor) return { name: relAuthor, source: 'rel="author" link' }

  // An element whose class mentions "author" — capture its inner text up to the
  // next tag (coarse, but good enough for the common byline markup).
  const classAuthor = firstText(html, /class=["'][^"']*\bauthor\b[^"']*["'][^>]*>([^<]{2,80})</i)
  if (classAuthor && !/^by\b/i.test(classAuthor)) return { name: classAuthor, source: 'author-classed element' }

  // "By Jane Doe" / "By John Q. Smith" in the first part of the visible text.
  const byline = toText(html).slice(0, 1200).match(/\bby\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,3})/)?.[1]
  if (byline) return { name: byline.trim(), source: '"By …" byline' }

  return { name: null, source: 'none' }
}

// ── Heading + Q&A extraction (for FAQPage) ────────────────────────────────────
interface Heading {
  level: number
  text: string
  start: number // index of the heading's opening tag
  end: number // index just after the heading's closing tag
}

function collectHeadings(html: string): Heading[] {
  const out: Heading[] = []
  for (const m of html.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const level = Number(m[1][1])
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    if (text) out.push({ level, text, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length })
  }
  return out
}

// Does this text look like a question? (Ends with "?" or opens with a question word.)
const QUESTION_OPENERS = /^(?:what|how|why|when|where|who|which|can|do|does|did|is|are|will|should|could|would|may|might)\b/i
function looksLikeQuestion(text: string): boolean {
  if (text.length < 8 || text.length > 200) return false
  return /\?\s*$/.test(text) || QUESTION_OPENERS.test(text)
}

interface QaPair {
  question: string
  answer: string
}

// Extract Q&A pairs two ways and merge:
//   (a) <details><summary>Q</summary> A </details> accordions
//   (b) a question-like heading followed by text up to the next heading
function extractQaPairs(html: string): QaPair[] {
  const pairs: QaPair[] = []
  const seen = new Set<string>()
  const push = (q: string, a: string) => {
    const question = q.replace(/\s+/g, ' ').trim()
    const answer = a.replace(/\s+/g, ' ').trim()
    if (question.length < 8 || answer.length < 20) return
    const key = question.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    pairs.push({ question, answer: answer.slice(0, 1000) })
  }

  // (a) <details>/<summary> accordions.
  for (const m of html.matchAll(/<details\b[^>]*>([\s\S]*?)<\/details>/gi)) {
    const inner = m[1]
    const summary = firstText(inner, /<summary\b[^>]*>([\s\S]*?)<\/summary>/i)
    if (!summary) continue
    const answer = toText(inner.replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/i, ' '))
    if (looksLikeQuestion(summary) || summary.length >= 8) push(summary, answer)
  }

  // (b) heading-delimited Q&A.
  const headings = collectHeadings(html)
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]
    if (!looksLikeQuestion(h.text)) continue
    const next = headings[i + 1]
    const answerHtml = html.slice(h.end, next ? next.start : Math.min(h.end + 4000, html.length))
    push(h.text, toText(answerHtml))
  }

  return pairs
}

// ── Price / commerce extraction (for Product) ─────────────────────────────────
const CURRENCY_SYMBOL_TO_ISO: Record<string, string> = { '$': 'USD', '£': 'GBP', '€': 'EUR', '₹': 'INR' }
const CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'INR', 'PKR', 'CAD', 'AUD', 'JPY']

interface PriceInfo {
  price: string // numeric string only, e.g. "1234.50" (no symbol/commas)
  currency: string // ISO 4217 code
  currencyResolved: boolean // false when we had to default the currency
  source: string
}

function normalizePriceNumber(n: string): string {
  return n.replace(/,/g, '')
}

// Find the first price-like pattern: a currency symbol next to a number, or a
// number next to a 3-letter currency code (either order).
function extractPrice(html: string): PriceInfo | null {
  const text = toText(html)

  // Symbol + amount, e.g. "$1,299.00" / "€ 49,99".
  const sym = text.match(/([$£€₹])\s?(\d[\d,]*(?:\.\d{1,2})?)/)
  if (sym) {
    return { price: normalizePriceNumber(sym[2]), currency: CURRENCY_SYMBOL_TO_ISO[sym[1]] ?? 'USD', currencyResolved: !!CURRENCY_SYMBOL_TO_ISO[sym[1]], source: 'currency symbol + amount' }
  }

  // Amount + code or code + amount, e.g. "1299 USD" / "USD 1299".
  const codeAlt = CURRENCY_CODES.join('|')
  const after = text.match(new RegExp(`(\\d[\\d,]*(?:\\.\\d{1,2})?)\\s?(${codeAlt})\\b`, 'i'))
  if (after) return { price: normalizePriceNumber(after[1]), currency: after[2].toUpperCase(), currencyResolved: true, source: 'amount + currency code' }
  const before = text.match(new RegExp(`\\b(${codeAlt})\\s?(\\d[\\d,]*(?:\\.\\d{1,2})?)`, 'i'))
  if (before) return { price: normalizePriceNumber(before[2]), currency: before[1].toUpperCase(), currencyResolved: true, source: 'currency code + amount' }

  return null
}

// A buy/cart action — multi-word phrases keep false positives low (a stray
// "buy" in prose won't trigger; "Add to Cart" / "Buy Now" buttons will).
const BUY_RE = /\b(add to cart|add to bag|add to basket|buy now|buy it now|order now|shop now|purchase now|add to wishlist)\b/i
function hasBuyButton(html: string): boolean {
  // Prefer matches inside button/anchor/input elements; fall back to anywhere.
  for (const m of html.matchAll(/<(?:button|a|input)\b[^>]*>([\s\S]*?)<\/(?:button|a)>|<input\b[^>]*\svalue=["']([^"']+)["'][^>]*>/gi)) {
    const label = `${m[1] ?? ''} ${m[2] ?? ''}`
    if (BUY_RE.test(toText(label))) return true
  }
  return BUY_RE.test(toText(html))
}

// Availability from visible text; defaults to InStock when a product page gives
// no explicit signal (the common case for "buyable" pages).
function extractAvailability(html: string): { availability: string; label: string } {
  const text = toText(html).toLowerCase()
  if (/\b(out of stock|sold out|currently unavailable|out-of-stock)\b/.test(text)) return { availability: `${SCHEMA_CONTEXT}/OutOfStock`, label: 'out of stock' }
  if (/\b(pre-?order)\b/.test(text)) return { availability: `${SCHEMA_CONTEXT}/PreOrder`, label: 'pre-order' }
  return { availability: `${SCHEMA_CONTEXT}/InStock`, label: 'in stock (default)' }
}

// ── Organization extraction (homepage / about page) ───────────────────────────
const SOCIAL_HOSTS = [
  'facebook.com', 'fb.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com',
  'youtube.com', 'youtu.be', 'tiktok.com', 'pinterest.com', 'github.com', 't.me',
  'threads.net', 'medium.com', 'mastodon.social',
]

function isHomeOrAbout(pageUrl: string): boolean {
  let path = '/'
  try {
    path = new URL(pageUrl).pathname.replace(/\/+$/, '') || '/'
  } catch {
    /* keep '/' */
  }
  if (path === '/') return true
  return /^\/(?:about|about-us|aboutus|company|who-we-are|our-story)\/?$/i.test(path)
}

// Find a logo URL: an <img> whose src/alt/class mentions "logo". Absolute.
function extractLogo(html: string, pageUrl: string): string | null {
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0]
    const haystack = `${tag.match(/\ssrc=["']([^"']+)["']/i)?.[1] ?? ''} ${tag.match(/\salt=["']([^"']*)["']/i)?.[1] ?? ''} ${tag.match(/\sclass=["']([^"']*)["']/i)?.[1] ?? ''}`.toLowerCase()
    if (/\blogo\b/.test(haystack)) {
      const abs = absUrl(tag.match(/\ssrc=["']([^"']+)["']/i)?.[1], pageUrl)
      if (abs) return abs
    }
  }
  return null
}

// Collect social-profile links found in the markup (header/footer typically).
function extractSocialLinks(html: string, pageUrl: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/<a\b[^>]*\shref=["']([^"']+)["']/gi)) {
    const abs = absUrl(m[1], pageUrl)
    if (!abs) continue
    let host = ''
    try {
      host = new URL(abs).hostname.replace(/^www\./, '')
    } catch {
      continue
    }
    if (SOCIAL_HOSTS.includes(host) && !seen.has(abs)) {
      seen.add(abs)
      out.push(abs)
      if (out.length >= 12) break
    }
  }
  return out
}

// Clean a <title> down to a likely brand name (drop "| tagline" / "- tagline").
function brandFromTitle(title: string | null): string | null {
  if (!title) return null
  return title.split(/\s[|–—-]\s/)[0].trim() || title.trim() || null
}

// ── Per-type detectors ────────────────────────────────────────────────────────

interface PrimaryResult {
  schemaType: SchemaType
  jsonLd: Record<string, unknown>
  confidence: Confidence
  extractedFields: ExtractedFields
}

// FAQPage — needs 3+ confidently-detected Q&A pairs.
function detectFaq(html: string): PrimaryResult | null {
  const pairs = extractQaPairs(html)
  if (pairs.length < 3) return null

  const jsonLd = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'FAQPage',
    mainEntity: pairs.map((p) => ({
      '@type': 'Question',
      name: p.question,
      acceptedAnswer: { '@type': 'Answer', text: p.answer },
    })),
  }
  return {
    schemaType: 'FAQPage',
    jsonLd,
    // More pairs → more confident it's a genuine FAQ page.
    confidence: pairs.length >= 5 ? 'high' : 'medium',
    extractedFields: {
      questionCount: { value: pairs.length, source: 'question headings / <details> blocks' },
      questions: { value: pairs.map((p) => p.question), source: 'visible Q&A content' },
    },
  }
}

// Product — needs a price pattern AND a buy/cart action AND a prominent <h1>.
function detectProduct(html: string, pageUrl: string): PrimaryResult | null {
  const h1 = extractH1(html)
  const price = extractPrice(html)
  const buy = hasBuyButton(html)
  if (!h1 || !price || !buy) return null

  const name = h1
  const description = extractMetaDescription(html) || extractMeta(html, 'property', 'og:description')
  const image = extractMainImage(html, pageUrl)
  const { availability, label: availLabel } = extractAvailability(html)

  const offer: Record<string, unknown> = {
    '@type': 'Offer',
    price: price.price,
    priceCurrency: price.currency,
    availability,
    url: pageUrl,
  }
  const jsonLd: Record<string, unknown> = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Product',
    name,
    ...(description ? { description } : {}),
    ...(image ? { image: [image] } : {}),
    offers: offer,
  }

  const extractedFields: ExtractedFields = {
    name: { value: name, source: 'h1' },
    price: { value: `${price.price} ${price.currency}`, source: price.source },
    availability: { value: availLabel, source: 'visible stock text' },
    ...(description ? { description: { value: description, source: 'meta description' } } : {}),
    ...(image ? { image: { value: image, source: 'og:image / first content image' } } : {}),
  }

  // High only when the currency was explicit; otherwise we defaulted it → medium.
  return { schemaType: 'Product', jsonLd, confidence: price.currencyResolved ? 'high' : 'medium', extractedFields }
}

// Article / BlogPosting — needs a single <h1>, substantial body text, AND an
// author or a date (the byline/timestamp that distinguishes content pages).
const ARTICLE_MIN_WORDS = 150
function detectArticle(html: string, pageUrl: string): PrimaryResult | null {
  const h1 = extractH1(html)
  if (!h1) return null

  const bodyWords = wordCount(toText(html))
  const paragraphCount = (html.match(/<p\b[^>]*>/gi) ?? []).length
  const substantial = bodyWords >= ARTICLE_MIN_WORDS && paragraphCount >= 2
  if (!substantial) return null

  const author = extractAuthor(html)
  const dates = extractDates(html)
  if (!author.name && !dates.published) return null // not clearly a content page

  // BlogPosting when the URL says blog/post/news/article; Article otherwise.
  let isBlog = false
  try {
    isBlog = /\/(?:blog|posts?|news|articles?)\//i.test(new URL(pageUrl).pathname)
  } catch {
    /* keep Article */
  }
  const type = isBlog ? 'BlogPosting' : 'Article'

  const headline = h1
  const description = extractMetaDescription(html) || extractMeta(html, 'property', 'og:description')
  const image = extractMainImage(html, pageUrl)

  const jsonLd: Record<string, unknown> = {
    '@context': SCHEMA_CONTEXT,
    '@type': type,
    headline,
    ...(description ? { description } : {}),
    ...(image ? { image: [image] } : {}),
    ...(dates.published ? { datePublished: dates.published } : {}),
    ...(dates.modified || dates.published ? { dateModified: dates.modified || dates.published } : {}),
    ...(author.name ? { author: { '@type': 'Person', name: author.name } } : {}),
    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
  }

  const extractedFields: ExtractedFields = {
    headline: { value: headline, source: 'h1' },
    type: { value: type, source: isBlog ? 'URL path (blog/post)' : 'default' },
    ...(description ? { description: { value: description, source: 'meta description' } } : {}),
    ...(dates.published ? { datePublished: { value: dates.published, source: dates.source } } : {}),
    ...(author.name ? { author: { value: author.name, source: author.source } } : {}),
    ...(image ? { image: { value: image, source: 'og:image / first content image' } } : {}),
    wordCount: { value: bodyWords, source: 'visible body text' },
  }

  // Strongest when we have BOTH an author and a date; otherwise medium.
  return { schemaType: 'Article', jsonLd, confidence: author.name && dates.published ? 'high' : 'medium', extractedFields }
}

// Organization — only for the homepage / about page. Coexists with the primary.
function detectOrganization(
  html: string,
  pageUrl: string,
  siteInfo: SiteInfo
): { jsonLd: Record<string, unknown>; confidence: Confidence; extractedFields: ExtractedFields } | null {
  if (!isHomeOrAbout(pageUrl)) return null

  const name = siteInfo.siteName?.trim() || brandFromTitle(extractTitle(html))
  if (!name) return null

  let origin = ''
  try {
    origin = new URL(pageUrl).origin
  } catch {
    /* leave blank */
  }
  const url = siteInfo.homeUrl || (origin ? `${origin}/` : siteInfo.domain)
  const logo = siteInfo.logoUrl || extractLogo(html, pageUrl)

  // Merge caller-supplied + markup-discovered social links (deduped).
  const discovered = extractSocialLinks(html, pageUrl)
  const sameAs = [...new Set([...(siteInfo.sameAs ?? []), ...discovered])]

  const jsonLd: Record<string, unknown> = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Organization',
    name,
    ...(url ? { url } : {}),
    ...(logo ? { logo } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  }

  const extractedFields: ExtractedFields = {
    name: { value: name, source: siteInfo.siteName ? 'site settings' : 'page title' },
    ...(url ? { url: { value: url, source: siteInfo.homeUrl ? 'site settings' : 'page origin' } } : {}),
    ...(logo ? { logo: { value: logo, source: siteInfo.logoUrl ? 'site settings' : 'logo image in markup' } } : {}),
    ...(sameAs.length ? { sameAs: { value: sameAs, source: 'social links in markup / settings' } } : {}),
  }

  // Logo or social links present → a richer, higher-confidence Organization.
  return { jsonLd, confidence: logo || sameAs.length ? 'high' : 'medium', extractedFields }
}

// ── Public entry point ────────────────────────────────────────────────────────
// Returns the generated schema for a page, or null when no type matches
// confidently (we never force a guess onto an unrelated page).
export function generateSchema(
  renderedHtml: string,
  pageUrl: string,
  siteInfo: SiteInfo
): GeneratedSchema | null {
  const html = (renderedHtml ?? '').length > MAX_HTML_BYTES ? renderedHtml.slice(0, MAX_HTML_BYTES) : renderedHtml ?? ''
  if (!html) return null

  // Primary type — mutually exclusive, checked in order of how specific the
  // signal is: FAQ (3+ Q&A) → Product (price + buy) → Article (byline + body).
  const primary = detectFaq(html) || detectProduct(html, pageUrl) || detectArticle(html, pageUrl)

  // Organization — independent; only on the homepage / about page.
  const org = detectOrganization(html, pageUrl, siteInfo)

  if (!primary && !org) return null

  if (primary) {
    return {
      ...primary,
      ...(org ? { organization: { jsonLd: org.jsonLd, extractedFields: org.extractedFields } } : {}),
    }
  }

  // Only Organization matched (e.g. a plain homepage with no article/product).
  return {
    schemaType: 'Organization',
    jsonLd: org!.jsonLd,
    confidence: org!.confidence,
    extractedFields: org!.extractedFields,
  }
}
