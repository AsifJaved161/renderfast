// ─────────────────────────────────────────────────────────────────────────────
// Platform config loader.
//
// Resolution order for every setting:  app_settings (DB)  →  env var  →  default.
// The DB row lets an admin change Cloudflare creds / queue limits from the UI
// WITHOUT a redeploy. Reads are cached in-memory for a few seconds so the hot
// render path doesn't hit the DB on every request.
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseAdmin } from '@/lib/supabase'

export const SETTING_KEYS = {
  cfAccountId: 'cloudflare_account_id',
  cfApiToken: 'cloudflare_api_token',
  cfKvNamespaceId: 'cloudflare_kv_namespace_id',
  cfBrowserRenderingUrl: 'cloudflare_browser_rendering_url',
  maxRescanUrls: 'max_rescan_urls',
  rescanConcurrency: 'rescan_concurrency',
  cacheTtlSeconds: 'cache_ttl_seconds',
  sitemapMaxUrls: 'sitemap_max_urls',
  renderTimeoutMs: 'render_timeout_ms',
  queueThrottleMs: 'queue_throttle_ms',
  hardCacheTtlDays: 'hard_cache_ttl_days',
  blockResources: 'block_resources',
  googleApiKey: 'google_api_key',
} as const

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]

const CACHE_TTL_MS = 15_000
let cache: { data: Record<string, string>; at: number } | null = null

// Load every settings row (cached). Failures degrade to an empty map → env/defaults.
async function loadDb(): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data
  const data: Record<string, string> = {}
  try {
    const { data: rows } = await supabaseAdmin.from('app_settings').select('key, value')
    for (const r of (rows ?? []) as { key: string; value: string | null }[]) {
      if (r.value != null && r.value !== '') data[r.key] = r.value
    }
  } catch {
    /* table missing / DB down — fall back to env */
  }
  cache = { data, at: Date.now() }
  return data
}

// Call after writing settings so the next read is fresh.
export function clearConfigCache() {
  cache = null
}

// Raw DB map (no env fallback) — used by the admin settings API for display.
export async function getDbSettings(): Promise<Record<string, string>> {
  return { ...(await loadDb()) }
}

function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

async function str(key: SettingKey, envName?: string): Promise<string> {
  const db = await loadDb()
  const v = db[key]
  if (v != null && v !== '') return v
  return envName ? env(envName) : ''
}

async function int(key: SettingKey, def: number): Promise<number> {
  const db = await loadDb()
  const n = db[key] != null ? parseInt(db[key], 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : def
}

async function bool(key: SettingKey, def: boolean): Promise<boolean> {
  const db = await loadDb()
  const v = db[key]
  if (v == null || v === '') return def
  return v === '1' || v.toLowerCase() === 'true'
}

// ── Cloudflare credentials ───────────────────────────────────────────────────
export interface CloudflareConfig {
  accountId: string
  apiToken: string
  kvNamespaceId: string
  browserRenderingUrl: string
}

// Google API key (Chrome UX Report / PageSpeed). DB override → env → empty.
export async function getGoogleApiKey(): Promise<string> {
  return str(SETTING_KEYS.googleApiKey, 'GOOGLE_API_KEY')
}

export async function getCloudflareConfig(): Promise<CloudflareConfig> {
  return {
    accountId: await str(SETTING_KEYS.cfAccountId, 'CLOUDFLARE_ACCOUNT_ID'),
    apiToken: await str(SETTING_KEYS.cfApiToken, 'CLOUDFLARE_API_TOKEN'),
    kvNamespaceId: await str(SETTING_KEYS.cfKvNamespaceId, 'CLOUDFLARE_KV_NAMESPACE_ID'),
    browserRenderingUrl: await str(SETTING_KEYS.cfBrowserRenderingUrl, 'CLOUDFLARE_BROWSER_RENDERING_URL'),
  }
}

// ── Operational limits (render queue / scan / cache) ─────────────────────────
export interface OpsConfig {
  maxRescanUrls: number
  rescanConcurrency: number
  cacheTtlSeconds: number
  sitemapMaxUrls: number
  renderTimeoutMs: number
  queueThrottleMs: number
  hardCacheTtlDays: number
  blockResources: boolean
}

export const OPS_DEFAULTS: OpsConfig = {
  maxRescanUrls: 15,
  rescanConcurrency: 5,
  cacheTtlSeconds: 86400,
  sitemapMaxUrls: 500,
  renderTimeoutMs: 30000,
  queueThrottleMs: 1200,
  hardCacheTtlDays: 30,
  blockResources: true,
}

export async function getOpsConfig(): Promise<OpsConfig> {
  return {
    maxRescanUrls: await int(SETTING_KEYS.maxRescanUrls, OPS_DEFAULTS.maxRescanUrls),
    rescanConcurrency: await int(SETTING_KEYS.rescanConcurrency, OPS_DEFAULTS.rescanConcurrency),
    cacheTtlSeconds: await int(SETTING_KEYS.cacheTtlSeconds, OPS_DEFAULTS.cacheTtlSeconds),
    sitemapMaxUrls: await int(SETTING_KEYS.sitemapMaxUrls, OPS_DEFAULTS.sitemapMaxUrls),
    renderTimeoutMs: await int(SETTING_KEYS.renderTimeoutMs, OPS_DEFAULTS.renderTimeoutMs),
    queueThrottleMs: await int(SETTING_KEYS.queueThrottleMs, OPS_DEFAULTS.queueThrottleMs),
    hardCacheTtlDays: await int(SETTING_KEYS.hardCacheTtlDays, OPS_DEFAULTS.hardCacheTtlDays),
    blockResources: await bool(SETTING_KEYS.blockResources, OPS_DEFAULTS.blockResources),
  }
}
