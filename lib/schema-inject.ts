// ─────────────────────────────────────────────────────────────────────────────
// Serve-time JSON-LD injection.
//
// Once a client approves (or edits) a generated schema, the proxy injects it
// into the <head> of the HTML it serves to bots/visitors. Injection happens on
// the SERVED body only — never on what we cache — so cache keys/behavior are
// untouched and the dedup check always runs against the real outgoing HTML.
//
// Duplicate detection: if the page already ships its OWN JSON-LD of the same
// schema type, we skip injecting that type (so we never double-declare e.g. two
// Organization blocks) and flag it so the dashboard can show "already present on
// page, not modified". Other types are still injected.
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseAdmin } from '@/lib/supabase'

export interface ApprovedSchema {
  schema_type: string
  json_ld: unknown
  edited_json_ld: unknown
  already_present: boolean
}

// schema_type → the existing page @type values that count as "already covered".
// (Article covers BlogPosting/NewsArticle; Organization covers its subtypes — so
// a page that declares LocalBusiness isn't double-tagged with Organization.)
const TYPE_EQUIVALENTS: Record<string, string[]> = {
  Article: ['article', 'blogposting', 'newsarticle', 'techarticle', 'report', 'scholarlyarticle'],
  Product: ['product', 'productgroup'],
  FAQPage: ['faqpage', 'qapage'],
  Organization: ['organization', 'localbusiness', 'corporation', 'onlinestore', 'ngo', 'educationalorganization', 'governmentorganization'],
}

// ── In-memory cache (mirrors the proxy's ownerCache) ──────────────────────────
// The proxy resolves the same site+url repeatedly; without this every cache HIT
// would pay a Supabase round-trip just to look up approved schemas. Approvals
// change rarely, so a few seconds of staleness is fine (same tolerance as the
// owner/settings caches). Invalidated when the proxy writes an already_present flag.
const SCHEMA_TTL_MS = 15_000
const schemaCache = new Map<string, { rows: ApprovedSchema[]; at: number }>()

function cacheKey(siteId: string, url: string): string {
  return `${siteId}|${url}`
}

export function invalidateApprovedSchemas(siteId: string, url: string): void {
  schemaCache.delete(cacheKey(siteId, url))
}

// Approved/edited schemas for a page (cached). Returns [] on any error so the
// proxy never fails to serve because of a schema lookup.
export async function getApprovedSchemas(siteId: string, url: string): Promise<ApprovedSchema[]> {
  const key = cacheKey(siteId, url)
  const hit = schemaCache.get(key)
  if (hit && Date.now() - hit.at < SCHEMA_TTL_MS) return hit.rows

  let rows: ApprovedSchema[] = []
  try {
    const { data } = await supabaseAdmin
      .from('generated_schemas')
      .select('schema_type, json_ld, edited_json_ld, already_present')
      .eq('site_id', siteId)
      .eq('url', url)
      .in('status', ['approved', 'edited'])
    rows = (data ?? []) as ApprovedSchema[]
  } catch {
    rows = []
  }
  if (schemaCache.size > 5000) schemaCache.clear()
  schemaCache.set(key, { rows, at: Date.now() })
  return rows
}

// ── Existing-JSON-LD detection ────────────────────────────────────────────────
// Collect every @type already declared in the page's own JSON-LD blocks
// (handles a single object, arrays, @type-as-array and @graph nesting).
function collectTypes(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const n of node) collectTypes(n, out)
  } else if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>
    const t = obj['@type']
    if (typeof t === 'string') out.add(t.toLowerCase())
    else if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') out.add(x.toLowerCase())
    if (Array.isArray(obj['@graph'])) collectTypes(obj['@graph'], out)
  }
}

function existingJsonLdTypes(html: string): Set<string> {
  const types = new Set<string>()
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectTypes(JSON.parse(m[1].trim()), types)
    } catch {
      /* malformed existing JSON-LD → ignore */
    }
  }
  return types
}

// Serialize a JSON-LD object into a safe <script> tag. Escaping "<" as <
// keeps the JSON valid while making a "</script>" breakout impossible.
function scriptTag(obj: unknown): string {
  const json = JSON.stringify(obj).replace(/</g, '\\u003c')
  return `<script type="application/ld+json">${json}</script>`
}

// Insert the built <script> tags just before </head> (or after <head>, or as a
// last resort at the very start). Returns the HTML unchanged if there's nothing
// to inject.
function insertIntoHead(html: string, scripts: string): string {
  if (!scripts) return html
  const closeHead = html.search(/<\/head>/i)
  if (closeHead >= 0) return html.slice(0, closeHead) + scripts + html.slice(closeHead)
  const openHead = html.match(/<head\b[^>]*>/i)
  if (openHead && openHead.index != null) {
    const at = openHead.index + openHead[0].length
    return html.slice(0, at) + scripts + html.slice(at)
  }
  return scripts + html
}

export interface InjectionResult {
  html: string
  injected: string[] // schema_types actually injected
  skipped: string[] // schema_types skipped (page already had that type)
  // Rows whose already_present flag differs from the DB and should be persisted.
  flagUpdates: { schema_type: string; already_present: boolean }[]
}

// Pure: given the HTML to serve and the approved schema rows, return the HTML
// with the non-duplicate schemas injected, plus what was injected/skipped and
// any already_present flag changes to persist.
export function injectSchemas(html: string, rows: ApprovedSchema[]): InjectionResult {
  const injected: string[] = []
  const skipped: string[] = []
  const flagUpdates: { schema_type: string; already_present: boolean }[] = []
  if (!html || rows.length === 0) return { html, injected, skipped, flagUpdates }

  const existing = existingJsonLdTypes(html)
  const parts: string[] = []

  for (const row of rows) {
    const equivalents = TYPE_EQUIVALENTS[row.schema_type] ?? [row.schema_type.toLowerCase()]
    // The page already declares this type → don't double-inject; flag it so the
    // dashboard can show "already present on page, not modified".
    const alreadyPresent = equivalents.some((t) => existing.has(t))

    if (alreadyPresent) {
      skipped.push(row.schema_type)
      if (row.already_present !== true) flagUpdates.push({ schema_type: row.schema_type, already_present: true })
      continue
    }

    // Serve the client's manual edit when present, else the auto-generated JSON-LD.
    const payload = row.edited_json_ld ?? row.json_ld
    if (payload && typeof payload === 'object') {
      parts.push(scriptTag(payload))
      injected.push(row.schema_type)
      if (row.already_present !== false) flagUpdates.push({ schema_type: row.schema_type, already_present: false })
    }
  }

  return { html: insertIntoHead(html, parts.join('')), injected, skipped, flagUpdates }
}

// Persist already_present flag changes (background only). Invalidates the cache
// entry so the next read reflects the new flag. Never throws into the caller.
export async function persistAlreadyPresent(
  siteId: string,
  url: string,
  updates: { schema_type: string; already_present: boolean }[]
): Promise<void> {
  try {
    for (const u of updates) {
      await supabaseAdmin
        .from('generated_schemas')
        .update({ already_present: u.already_present })
        .eq('site_id', siteId)
        .eq('url', url)
        .eq('schema_type', u.schema_type)
    }
    invalidateApprovedSchemas(siteId, url)
  } catch {
    /* flag persistence is best-effort — never affects serving */
  }
}
