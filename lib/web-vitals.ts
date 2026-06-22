// ─────────────────────────────────────────────────────────────────────────────
// Core Web Vitals via the Chrome UX Report (CrUX) API — REAL field data (the
// 28-day rolling p75 Google actually uses for ranking), not a lab simulation.
// One lightweight POST per URL (URL-level, falling back to origin-level when a
// specific page has too little traffic). Fully self-contained and graceful:
// returns null when no API key is set, on any error, or when no field data
// exists — so the diagnostics flow is never affected.
// ─────────────────────────────────────────────────────────────────────────────
import { getGoogleApiKey } from '@/lib/app-config'

export type CwvRating = 'good' | 'needs-improvement' | 'poor'
export interface CwvMetric {
  value: number
  rating: CwvRating
}
export interface CoreWebVitals {
  source: 'url' | 'origin' // url = page-level field data; origin = whole-site fallback
  collectedFrom: string
  lcp: CwvMetric | null // Largest Contentful Paint (ms)
  cls: CwvMetric | null // Cumulative Layout Shift (unitless)
  inp: CwvMetric | null // Interaction to Next Paint (ms)
  fcp: CwvMetric | null // First Contentful Paint (ms)
  ttfb: CwvMetric | null // Time to First Byte (ms)
  overall: CwvRating | null // worst of the three core vitals (LCP/CLS/INP)
}

const CRUX_URL = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord'
const METRICS = [
  'largest_contentful_paint',
  'cumulative_layout_shift',
  'interaction_to_next_paint',
  'first_contentful_paint',
  'experimental_time_to_first_byte',
]

// Official Google "good / needs-improvement / poor" thresholds.
function rate(name: 'lcp' | 'cls' | 'inp' | 'fcp' | 'ttfb', v: number): CwvRating {
  switch (name) {
    case 'lcp':
      return v <= 2500 ? 'good' : v <= 4000 ? 'needs-improvement' : 'poor'
    case 'cls':
      return v <= 0.1 ? 'good' : v <= 0.25 ? 'needs-improvement' : 'poor'
    case 'inp':
      return v <= 200 ? 'good' : v <= 500 ? 'needs-improvement' : 'poor'
    case 'fcp':
      return v <= 1800 ? 'good' : v <= 3000 ? 'needs-improvement' : 'poor'
    case 'ttfb':
      return v <= 800 ? 'good' : v <= 1800 ? 'needs-improvement' : 'poor'
  }
}

function metric(record: any, cruxKey: string, name: 'lcp' | 'cls' | 'inp' | 'fcp' | 'ttfb'): CwvMetric | null {
  const p75 = record?.metrics?.[cruxKey]?.percentiles?.p75
  if (p75 == null) return null
  const value = Number(p75)
  if (!Number.isFinite(value)) return null
  return { value, rating: rate(name, value) }
}

async function query(key: string, body: Record<string, unknown>): Promise<any | null> {
  try {
    const res = await fetch(`${CRUX_URL}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, metrics: METRICS }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null // 404 = no field data for this url/origin
    const j = await res.json()
    return j?.record ?? null
  } catch {
    return null
  }
}

export async function fetchCoreWebVitals(url: string): Promise<CoreWebVitals | null> {
  const key = await getGoogleApiKey()
  if (!key) return null

  // Page-level first; if a specific page has too little traffic, fall back to
  // the whole-origin field data (still a valid Google ranking signal).
  let source: 'url' | 'origin' = 'url'
  let record = await query(key, { url })
  let collectedFrom = url
  if (!record) {
    let origin = ''
    try {
      origin = new URL(url).origin
    } catch {
      return null
    }
    record = await query(key, { origin })
    source = 'origin'
    collectedFrom = origin
  }
  if (!record) return null

  const lcp = metric(record, 'largest_contentful_paint', 'lcp')
  const cls = metric(record, 'cumulative_layout_shift', 'cls')
  const inp = metric(record, 'interaction_to_next_paint', 'inp')
  const fcp = metric(record, 'first_contentful_paint', 'fcp')
  const ttfb = metric(record, 'experimental_time_to_first_byte', 'ttfb')

  const core = [lcp, cls, inp].filter(Boolean) as CwvMetric[]
  const overall: CwvRating | null = core.length
    ? core.some((m) => m.rating === 'poor')
      ? 'poor'
      : core.some((m) => m.rating === 'needs-improvement')
        ? 'needs-improvement'
        : 'good'
    : null

  return { source, collectedFrom, lcp, cls, inp, fcp, ttfb, overall }
}
