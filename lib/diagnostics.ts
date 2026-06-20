// ─────────────────────────────────────────────────────────────────────────────
// Render Diagnostics — an ISOLATED, opt-out module that runs alongside the
// existing render step. It never touches or blocks the core render flow:
//   • captureDiagnostics() is fire-and-forget and swallows its own errors.
//   • Toggle the whole module off with env RENDER_DIAGNOSTICS=off.
//
// What it captures per render:
//   Part 1  Render health  — console errors / page exceptions / failed requests
//                            (only available when the render path provides them;
//                             see attachPlaywrightListeners() below).
//   Part 2  Content diff    — how much of the JS-rendered visible text is MISSING
//                            from the raw (no-JS) HTML a crawler like GPTBot sees,
//                            plus which critical SEO elements are JS-only.
//   Part 3  Storage         — persists to `render_diagnostics`, pruned to the
//                            latest N runs per URL.
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseAdmin } from '@/lib/supabase'

// Master on/off switch — set RENDER_DIAGNOSTICS=off to disable with zero overhead.
export const DIAGNOSTICS_ENABLED = process.env.RENDER_DIAGNOSTICS !== 'off'

// Keep only the latest N diagnostic runs per URL (prevents unbounded growth).
const MAX_RUNS_PER_URL = 20

// Cap HTML processed for diff/SEO so a huge or malicious page can't exhaust
// CPU/memory on the worker. ~2 MB of HTML is far more than any real page needs.
const MAX_HTML_BYTES = 2_000_000

function capHtml(html: string): string {
  return html.length > MAX_HTML_BYTES ? html.slice(0, MAX_HTML_BYTES) : html
}

// UA of a non-JS crawler — a plain fetch with this UA returns the same server
// HTML those bots see (before any client-side JS runs).
const RAW_CRAWLER_UA =
  'Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)'

const RAW_FETCH_TIMEOUT_MS = 10_000

// ── Types ───────────────────────────────────────────────────────────────────
export interface FailedRequest {
  url: string
  resourceType: string
  reason: string
}

export interface BadStatus {
  url: string
  status: number
  resourceType: string
}

// Signals that a Playwright/Puppeteer render CAN emit. With the Cloudflare
// /content REST renderer these come back empty — Part 2 still runs regardless.
export interface RenderSignals {
  consoleErrors: string[]
  pageErrors: string[]
  failedRequests: FailedRequest[]
  badStatuses: BadStatus[]
}

export interface MissingSeoElement {
  element: 'title' | 'meta_description' | 'h1' | 'canonical' | 'jsonld'
  inRaw: boolean
  inRendered: boolean
  jsOnly: boolean // present after JS, absent in raw HTML → invisible to non-JS bots
}

export interface DiagnosticInput {
  siteId: string
  url: string
  renderedHtml: string // the fully JS-rendered HTML we already produced
  renderTimeMs: number
  signals?: Partial<RenderSignals> // optional Part-1 data from a Playwright render
  rawHtml?: string | null // pre-fetched raw HTML — skips the internal origin fetch
}

// ── Text extraction ──────────────────────────────────────────────────────────
// Strip scripts/styles/markup and return the human-visible text only.
function stripToText(html: string): string {
  if (!html) return ''
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ') // remaining tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&[a-z#0-9]+;/gi, ' ') // other entities
    .replace(/\s+/g, ' ')
    .trim()
}

// Tokenize visible text into a set of lowercased words (length ≥ 2) for comparison.
function tokenSet(text: string): Set<string> {
  const out = new Set<string>()
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= 2) out.add(w)
  }
  return out
}

// ── Part 2: content visibility diff ──────────────────────────────────────────
// Percentage of the rendered page's unique words that are ABSENT from the raw
// (no-JS) HTML. High % => bots that don't run JS see very little real content.
function contentDiffPercentage(rawHtml: string, renderedHtml: string): number {
  const rawTokens = tokenSet(stripToText(rawHtml))
  const renderedTokens = tokenSet(stripToText(renderedHtml))
  if (renderedTokens.size === 0) return 0
  let missing = 0
  for (const t of renderedTokens) if (!rawTokens.has(t)) missing++
  return Math.round((missing / renderedTokens.size) * 10000) / 100 // 2 dp
}

// Detect presence of the critical SEO elements via lightweight regex (no parser).
function extractSeoPresence(html: string) {
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return {
    title: !!(titleM && titleM[1].trim().length > 0),
    meta_description:
      /<meta[^>]+name=["']description["'][^>]+content=["'][^"']+["']/i.test(html) ||
      /<meta[^>]+content=["'][^"']+["'][^>]+name=["']description["']/i.test(html),
    h1: /<h1[\s>]/i.test(html),
    canonical: /<link[^>]+rel=["']canonical["']/i.test(html),
    jsonld: /<script[^>]+type=["']application\/ld\+json["'][^>]*>/i.test(html),
  }
}

// Build the structured "missing in raw HTML" list by comparing raw vs rendered.
function diffSeoElements(rawHtml: string, renderedHtml: string): MissingSeoElement[] {
  const raw = extractSeoPresence(rawHtml)
  const rendered = extractSeoPresence(renderedHtml)
  const keys: MissingSeoElement['element'][] = [
    'title',
    'meta_description',
    'h1',
    'canonical',
    'jsonld',
  ]
  return keys
    .map((element) => ({
      element,
      inRaw: raw[element],
      inRendered: rendered[element],
      jsOnly: rendered[element] && !raw[element], // injected by JS only
    }))
    // Only report elements that are missing from raw HTML (the bot-visible version).
    .filter((e) => !e.inRaw)
}

// ── Render-success heuristic (Part 1) ────────────────────────────────────────
// "true only if no critical JS error blocked main content from appearing."
// We approximate: the rendered page has real visible text AND no uncaught
// page exception was reported by the render path.
function computeRenderSucceeded(renderedHtml: string, signals?: Partial<RenderSignals>): boolean {
  const hasContent = stripToText(renderedHtml).length >= 50
  const noFatalJs = !signals?.pageErrors || signals.pageErrors.length === 0
  return hasContent && noFatalJs
}

// ── Part 3: persist + prune ──────────────────────────────────────────────────
async function persistDiagnostic(row: {
  site_id: string
  url: string
  console_errors: unknown[]
  failed_requests: unknown[]
  content_diff_percentage: number
  missing_seo_elements: unknown[]
  render_succeeded: boolean
  render_time_ms: number
}) {
  await supabaseAdmin.from('render_diagnostics').insert({
    ...row,
    rendered_at: new Date().toISOString(),
  })

  // Prune anything older than the newest MAX_RUNS_PER_URL for this URL.
  const { data: stale } = await supabaseAdmin
    .from('render_diagnostics')
    .select('id')
    .eq('site_id', row.site_id)
    .eq('url', row.url)
    .order('rendered_at', { ascending: false })
    .range(MAX_RUNS_PER_URL, MAX_RUNS_PER_URL + 200)

  if (stale && stale.length > 0) {
    await supabaseAdmin
      .from('render_diagnostics')
      .delete()
      .in('id', stale.map((r: { id: string }) => r.id))
  }
}

// ── Core (awaitable) routine ─────────────────────────────────────────────────
// Exported so a "re-scan" endpoint can await a batch; captureDiagnostics() is
// the fire-and-forget wrapper used on the hot render path.
export async function runDiagnostics(input: DiagnosticInput): Promise<void> {
  // Use a caller-supplied raw HTML if given (avoids a duplicate origin fetch);
  // otherwise fetch the raw, no-JS HTML a non-JS crawler would receive.
  let rawHtml = ''
  if (input.rawHtml != null) {
    rawHtml = input.rawHtml
  } else {
    try {
      const res = await fetch(input.url, {
        headers: { 'User-Agent': RAW_CRAWLER_UA, Accept: 'text/html' },
        signal: AbortSignal.timeout(RAW_FETCH_TIMEOUT_MS),
      })
      rawHtml = await res.text()
    } catch {
      // Raw fetch failed (timeout/blocked) — treat as empty; diff will read 100%.
    }
  }

  // Truncate both sides before any text processing (resource-exhaustion guard).
  rawHtml = capHtml(rawHtml)
  const renderedHtml = capHtml(input.renderedHtml)

  const signals = input.signals ?? {}
  const consoleErrors = signals.consoleErrors ?? []
  const failedRequests = [
    ...(signals.failedRequests ?? []),
    // Fold 4xx/5xx subresource statuses into the same "failed requests" list.
    ...(signals.badStatuses ?? []).map((b) => ({
      url: b.url,
      resourceType: b.resourceType,
      reason: `HTTP ${b.status}`,
    })),
  ]

  await persistDiagnostic({
    site_id: input.siteId,
    url: input.url,
    console_errors: consoleErrors,
    failed_requests: failedRequests,
    content_diff_percentage: contentDiffPercentage(rawHtml, renderedHtml),
    missing_seo_elements: diffSeoElements(rawHtml, renderedHtml),
    render_succeeded: computeRenderSucceeded(renderedHtml, signals),
    render_time_ms: input.renderTimeMs,
  })
}

// ── Public entry point — FIRE-AND-FORGET, never throws into the caller ────────
// Call this right after a successful render. It returns immediately; all work
// (raw fetch, diff, DB write) happens in the background and any failure is logged.
export function captureDiagnostics(input: DiagnosticInput): void {
  if (!DIAGNOSTICS_ENABLED) return
  runDiagnostics(input).catch((e) =>
    console.error('[diagnostics] capture failed (ignored):', e)
  )
}

// ── Optional Part-1 helper for a Playwright/Puppeteer render path ─────────────
// Attach to a `page` BEFORE navigation; call the returned collector AFTER render
// to get the captured signals, then pass them into captureDiagnostics({ signals }).
// Typed structurally so this file needs no Playwright/Puppeteer dependency.
interface PageLike {
  on(event: string, handler: (arg: unknown) => void): void
}
export function attachPlaywrightListeners(page: PageLike): () => RenderSignals {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: FailedRequest[] = []
  const badStatuses: BadStatus[] = []

  page.on('console', (msg) => {
    const m = msg as { type?: () => string; text?: () => string }
    if (m.type?.() === 'error') consoleErrors.push(m.text?.() ?? String(msg))
  })
  page.on('pageerror', (err) => {
    const e = err as { message?: string }
    pageErrors.push(e.message ?? String(err))
  })
  page.on('requestfailed', (req) => {
    const r = req as {
      url?: () => string
      resourceType?: () => string
      failure?: () => { errorText?: string } | null
    }
    failedRequests.push({
      url: r.url?.() ?? '',
      resourceType: r.resourceType?.() ?? '',
      reason: r.failure?.()?.errorText ?? 'failed',
    })
  })
  page.on('response', (res) => {
    const r = res as {
      status?: () => number
      url?: () => string
      request?: () => { resourceType?: () => string }
    }
    const status = r.status?.() ?? 0
    if (status >= 400) {
      badStatuses.push({
        url: r.url?.() ?? '',
        status,
        resourceType: r.request?.().resourceType?.() ?? '',
      })
    }
  })

  return () => ({ consoleErrors, pageErrors, failedRequests, badStatuses })
}
