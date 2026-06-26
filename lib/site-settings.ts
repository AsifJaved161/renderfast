// Per-site advanced settings — stored in sites.settings (jsonb), read on the
// hot render path so they're cached briefly to avoid a DB hit per request.
import { supabaseAdmin } from '@/lib/supabase'
import type { RenderOptions } from '@/lib/renderer'

export interface SiteSettings {
  excludedPaths: string[]      // path prefixes/globs never rendered (served from origin)
  entryPoints: string[]        // extra seed URLs/paths added when crawling the sitemap
  userAgent: string            // custom UA for the renderer ('' = default)
  headers: Record<string, string> // extra HTTP headers sent when rendering
  emulateMobile: boolean       // render with a mobile viewport
  blockResources: string[]     // URL fragments to block while rendering (ads/trackers)
  pathExpiry: { pattern: string; days: number }[] // per-path cache lifetime overrides
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  excludedPaths: [],
  entryPoints: [],
  userAgent: '',
  headers: {},
  emulateMobile: false,
  blockResources: [],
  pathExpiry: [],
}

// Coerce an arbitrary stored value into a complete, safe SiteSettings object.
export function normalizeSiteSettings(raw: unknown): SiteSettings {
  const s = (raw ?? {}) as Partial<SiteSettings>
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
  return {
    excludedPaths: arr(s.excludedPaths),
    entryPoints: arr(s.entryPoints),
    userAgent: typeof s.userAgent === 'string' ? s.userAgent : '',
    headers:
      s.headers && typeof s.headers === 'object'
        ? Object.fromEntries(
            Object.entries(s.headers as Record<string, unknown>)
              .filter(([k, v]) => k && typeof v === 'string')
              .map(([k, v]) => [k, String(v)])
          )
        : {},
    emulateMobile: !!s.emulateMobile,
    blockResources: arr(s.blockResources),
    pathExpiry: Array.isArray(s.pathExpiry)
      ? (s.pathExpiry as unknown[])
          .map((r) => r as { pattern?: unknown; days?: unknown })
          .filter((r) => typeof r.pattern === 'string' && Number.isFinite(Number(r.days)))
          .map((r) => ({ pattern: String(r.pattern), days: Math.max(0, Math.round(Number(r.days))) }))
      : [],
  }
}

// Map per-site settings to the renderer's per-call overrides.
export function toRenderOptions(s: SiteSettings): RenderOptions {
  return {
    isMobile: s.emulateMobile,
    userAgent: s.userAgent || undefined,
    headers: Object.keys(s.headers).length ? s.headers : undefined,
    blockUrlPatterns: s.blockResources.length ? s.blockResources : undefined,
  }
}

// Does a URL's path match one of the excluded-path patterns? Patterns are simple:
// a leading "/foo" matches any path starting with /foo; "*" is a wildcard.
export function isExcludedPath(urlOrPath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false
  let path = urlOrPath
  try {
    path = new URL(urlOrPath).pathname
  } catch {
    /* already a path */
  }
  return patterns.some((p) => {
    const pat = p.trim()
    if (!pat) return false
    if (pat.includes('*')) {
      const re = new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'))
      return re.test(path)
    }
    return path === pat || path.startsWith(pat)
  })
}

// Cache-expiry override (in days) for a URL, or null when no rule matches.
export function pathExpiryDays(urlOrPath: string, rules: SiteSettings['pathExpiry']): number | null {
  let path = urlOrPath
  try {
    path = new URL(urlOrPath).pathname
  } catch {
    /* already a path */
  }
  for (const r of rules) {
    try {
      if (new RegExp(r.pattern).test(path)) return r.days
    } catch {
      /* invalid regex → skip */
    }
  }
  return null
}

// ── Cached getter (hot path) ──────────────────────────────────────────────────
const TTL_MS = 15_000
const cache = new Map<string, { settings: SiteSettings; at: number }>()

// Drop the cached settings for a site so a save takes effect immediately.
export function clearSiteSettingsCache(siteId: string): void {
  cache.delete(siteId)
}

export async function getSiteSettings(siteId: string): Promise<SiteSettings> {
  const hit = cache.get(siteId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.settings
  let settings = DEFAULT_SITE_SETTINGS
  try {
    const { data } = await supabaseAdmin.from('sites').select('settings').eq('id', siteId).maybeSingle()
    settings = normalizeSiteSettings(data?.settings)
  } catch {
    /* table/column missing pre-migration → defaults */
  }
  if (cache.size > 5000) cache.clear()
  cache.set(siteId, { settings, at: Date.now() })
  return settings
}
