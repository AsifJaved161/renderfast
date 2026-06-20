// ─────────────────────────────────────────────────────────────────────────────
// AI Citation Readiness — "Generative Engine Optimization" signals.
//
// extractGeoSignals(renderedHtml) is a PURE function: rendered HTML string in,
// a GeoSignals object out. No DB calls, no network — it reuses the HTML the
// diagnostics flow already rendered. Parsing is regex-based (the codebase has no
// DOM parser dependency), which is robust enough for these coarse signals.
// ─────────────────────────────────────────────────────────────────────────────

export interface GeoSignals {
  hasQaSchema: boolean // FAQPage / QAPage / HowTo JSON-LD present
  answerUpfront: boolean // a number or direct-answer sentence in the first ~200 words
  quotesCount: number // <blockquote> elements
  statsCount: number // numbers / percentages in the visible text
  citationsCount: number // outbound links to other domains
  headingCount: number // h2–h6 elements
  hasListOrTable: boolean // any <ul> / <ol> / <table>
  fluencyScore: number // Flesch Reading Ease (0–100)
}

// First ~N words we treat as the page's "answer upfront" zone.
const ANSWER_WORDS = 200

// A number or percentage: 12, 1,234, 3.5, 80%, $5 … (used for stats + answer zone).
const NUMERIC_RE = /\$?\b\d[\d,]*(?:\.\d+)?\s?%?/g

// Direct-answer phrasing: Yes/No openers, definitional "is a/an/the", "refers
// to", "the answer is", summary cues — the style LLMs love to quote.
const DIRECT_ANSWER_RE =
  /\b(?:yes|no)\b[\s,.;:—-]|the answer is|is defined as|refers to|stands for|means that|\bis (?:a|an|the)\b|\bare (?:a|the)\b|in short|to summari[sz]e/i

// ── visible text: drop comments/scripts/styles/markup, collapse whitespace ────
function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ') // strip remaining tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ') // decode-ish: drop other entities
    .replace(/\s+/g, ' ')
    .trim()
}

// Recursively collect every @type string from a JSON-LD node (handles a single
// object, arrays, @type-as-array, and @graph nesting).
function collectTypes(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const n of node) collectTypes(n, out)
  } else if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>
    const t = obj['@type']
    if (typeof t === 'string') out.push(t)
    else if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') out.push(x)
    if (Array.isArray(obj['@graph'])) collectTypes(obj['@graph'], out)
  }
  return out
}

// The page's own host — read from the injected <base>, the canonical link, or
// og:url — so we can tell internal links from outbound citations.
function selfHost(html: string): string | null {
  const cands = [
    html.match(/<base[^>]+href=["']([^"']+)["']/i)?.[1],
    html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1],
    html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1],
  ]
  for (const c of cands) {
    if (!c) continue
    try {
      return new URL(c).hostname.replace(/^www\./, '')
    } catch {
      /* not absolute — try next */
    }
  }
  return null
}

// Heuristic English syllable count (vowel-group based) for Flesch.
function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 0
  if (w.length <= 3) return 1
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '') // drop common silent endings
    .replace(/^y/, '')
    .match(/[aeiouy]{1,2}/g)
  return groups ? groups.length : 1
}

export function extractGeoSignals(renderedHtml: string): GeoSignals {
  const html = renderedHtml ?? ''
  const text = visibleText(html)
  const words = text ? text.split(/\s+/) : []

  // hasQaSchema — scan every JSON-LD <script> block; true if any @type is a
  // FAQPage / QAPage / HowTo (the schema types that earn AI "answer" citations).
  const QA_TYPES = new Set(['faqpage', 'qapage', 'howto'])
  let hasQaSchema = false
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const types = collectTypes(JSON.parse(m[1].trim()))
      if (types.some((t) => QA_TYPES.has(t.toLowerCase()))) {
        hasQaSchema = true
        break
      }
    } catch {
      /* malformed JSON-LD block — ignore */
    }
  }

  // answerUpfront — does the first ~200 words contain a number/percentage OR a
  // direct-answer-style sentence? (Reset NUMERIC_RE.lastIndex: it's a /g regex.)
  const answerZone = words.slice(0, ANSWER_WORDS).join(' ')
  NUMERIC_RE.lastIndex = 0
  const answerUpfront = NUMERIC_RE.test(answerZone) || DIRECT_ANSWER_RE.test(answerZone)

  // quotesCount — opening <blockquote> tags.
  const quotesCount = (html.match(/<blockquote[\s>]/gi) ?? []).length

  // statsCount — number/percentage occurrences across the full visible text.
  const statsCount = (text.match(NUMERIC_RE) ?? []).length

  // citationsCount — <a href> whose resolved host differs from the page's host.
  // Relative links resolve to selfHost (→ internal, not counted). When the host
  // can't be determined, any absolute http(s) link is treated as outbound.
  const host = selfHost(html)
  let citationsCount = 0
  for (const m of html.matchAll(/<a\b[^>]*\shref=["']([^"']+)["']/gi)) {
    const href = m[1]
    try {
      const u = new URL(href, host ? `https://${host}` : undefined)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
      const linkHost = u.hostname.replace(/^www\./, '')
      if (host) {
        if (linkHost !== host) citationsCount++
      } else if (/^https?:/i.test(href)) {
        citationsCount++
      }
    } catch {
      /* relative href with unknown base → internal, skip */
    }
  }

  // headingCount — h2–h6 (h1 excluded: it's the title, not a section heading).
  const headingCount = (html.match(/<h[2-6][\s>]/gi) ?? []).length

  // hasListOrTable — any list or table element.
  const hasListOrTable = /<(?:ul|ol|table)[\s>]/i.test(html)

  // fluencyScore — Flesch Reading Ease:
  //   206.835 − 1.015 × (words/sentences) − 84.6 × (syllables/words)
  // Sentences ≈ runs of . ! ? Clamped to the standard 0–100 reporting range.
  let fluencyScore = 0
  if (words.length > 0) {
    const sentences = (text.match(/[.!?]+/g) ?? []).length || 1
    const sylCount = words.reduce((s, w) => s + syllables(w), 0) || 1
    const raw = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (sylCount / words.length)
    fluencyScore = Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10
  }

  return {
    hasQaSchema,
    answerUpfront,
    quotesCount,
    statsCount,
    citationsCount,
    headingCount,
    hasListOrTable,
    fluencyScore,
  }
}
