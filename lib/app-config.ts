// ─────────────────────────────────────────────────────────────────────────────
// Platform config loader.
//
// Resolution order for every setting:  app_settings (DB)  →  env var  →  default.
// The DB row lets an admin change Cloudflare creds / queue limits from the UI
// WITHOUT a redeploy. Reads are cached in-memory for a few seconds so the hot
// render path doesn't hit the DB on every request.
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseAdmin } from '@/lib/supabase'
import { mergeFeatureAccess, type FeatureAccessMap } from '@/lib/feature-access'

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
  // AI Visibility Tracker — shared answer-engine API keys + scan policy.
  // Two key slots per engine: the second is a failover used when the first
  // hits its quota / rate limit.
  openaiApiKey: 'openai_api_key',
  openaiApiKey2: 'openai_api_key_2',
  geminiApiKey: 'gemini_api_key',
  geminiApiKey2: 'gemini_api_key_2',
  claudeApiKey: 'claude_api_key',
  claudeApiKey2: 'claude_api_key_2',
  grokApiKey: 'grok_api_key',
  grokApiKey2: 'grok_api_key_2',
  perplexityApiKey: 'perplexity_api_key',
  perplexityApiKey2: 'perplexity_api_key_2',
  aiVisibilityFrequency: 'ai_visibility_frequency',
  aiQuotaFree: 'ai_visibility_quota_free',
  aiQuotaStarter: 'ai_visibility_quota_starter',
  aiQuotaPro: 'ai_visibility_quota_pro',
  aiQuotaAgency: 'ai_visibility_quota_agency',
  // Per-plan feature gating — JSON map of { featureKey: minPlan }.
  featureAccess: 'feature_access',
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

// Like int() but accepts 0 (e.g. a quota of 0 = feature disabled for that plan).
async function intNonNeg(key: SettingKey, def: number): Promise<number> {
  const db = await loadDb()
  const n = db[key] != null ? parseInt(db[key], 10) : NaN
  return Number.isFinite(n) && n >= 0 ? n : def
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

// ── AI Visibility Tracker config ─────────────────────────────────────────────
// Shared answer-engine API keys + scan policy, all owned by the platform admin.
// Per-plan quota caps how many prompts a client on that plan may track (0 = the
// feature is locked for that plan — paid-tier gating + API-cost control).
export type AiVisibilityFrequency = 'daily' | 'weekly' | 'monthly'
export type AiEngine = 'chatgpt' | 'gemini' | 'claude' | 'grok' | 'perplexity'

// Each engine has 1–2 usable API keys (primary first, failover second). Empty
// slots are dropped, so `keys` only contains keys that are actually configured.
export interface AiVisibilityConfig {
  engines: Record<AiEngine, { keys: string[] }>
  frequency: AiVisibilityFrequency
  quotas: { free: number; starter: number; pro: number; agency: number }
}

export const AI_VISIBILITY_DEFAULTS = {
  frequency: 'weekly' as AiVisibilityFrequency,
  quotas: { free: 0, starter: 5, pro: 10, agency: 50 },
}

// Engine → its two setting keys + the env-var fallbacks for each slot.
export const AI_ENGINE_KEYS: Record<AiEngine, { primary: SettingKey; secondary: SettingKey; env: string; env2: string }> = {
  chatgpt: { primary: SETTING_KEYS.openaiApiKey, secondary: SETTING_KEYS.openaiApiKey2, env: 'OPENAI_API_KEY', env2: 'OPENAI_API_KEY_2' },
  gemini: { primary: SETTING_KEYS.geminiApiKey, secondary: SETTING_KEYS.geminiApiKey2, env: 'GEMINI_API_KEY', env2: 'GEMINI_API_KEY_2' },
  claude: { primary: SETTING_KEYS.claudeApiKey, secondary: SETTING_KEYS.claudeApiKey2, env: 'ANTHROPIC_API_KEY', env2: 'ANTHROPIC_API_KEY_2' },
  grok: { primary: SETTING_KEYS.grokApiKey, secondary: SETTING_KEYS.grokApiKey2, env: 'XAI_API_KEY', env2: 'XAI_API_KEY_2' },
  perplexity: { primary: SETTING_KEYS.perplexityApiKey, secondary: SETTING_KEYS.perplexityApiKey2, env: 'PERPLEXITY_API_KEY', env2: 'PERPLEXITY_API_KEY_2' },
}

export const AI_ENGINE_ORDER: AiEngine[] = ['chatgpt', 'gemini', 'claude', 'grok', 'perplexity']

export async function getAiVisibilityConfig(): Promise<AiVisibilityConfig> {
  const db = await loadDb()
  const freqRaw = db[SETTING_KEYS.aiVisibilityFrequency]
  const frequency: AiVisibilityFrequency =
    freqRaw === 'daily' || freqRaw === 'weekly' || freqRaw === 'monthly'
      ? freqRaw
      : AI_VISIBILITY_DEFAULTS.frequency

  const engines = {} as Record<AiEngine, { keys: string[] }>
  for (const engine of AI_ENGINE_ORDER) {
    const k = AI_ENGINE_KEYS[engine]
    const primary = await str(k.primary, k.env)
    const secondary = await str(k.secondary, k.env2)
    engines[engine] = { keys: [primary, secondary].filter((v) => v && v.trim()) }
  }

  return {
    engines,
    frequency,
    quotas: {
      free: await intNonNeg(SETTING_KEYS.aiQuotaFree, AI_VISIBILITY_DEFAULTS.quotas.free),
      starter: await intNonNeg(SETTING_KEYS.aiQuotaStarter, AI_VISIBILITY_DEFAULTS.quotas.starter),
      pro: await intNonNeg(SETTING_KEYS.aiQuotaPro, AI_VISIBILITY_DEFAULTS.quotas.pro),
      agency: await intNonNeg(SETTING_KEYS.aiQuotaAgency, AI_VISIBILITY_DEFAULTS.quotas.agency),
    },
  }
}

// True if at least one engine has at least one usable key.
export function anyEngineReady(cfg: AiVisibilityConfig): boolean {
  return AI_ENGINE_ORDER.some((e) => cfg.engines[e].keys.length > 0)
}

// ── Per-plan feature access map ──────────────────────────────────────────────
// Returns the admin-configured { featureKey: minPlan } map merged over defaults.
export async function getFeatureAccessMap(): Promise<FeatureAccessMap> {
  const db = await loadDb()
  let stored: Record<string, unknown> | null = null
  const raw = db[SETTING_KEYS.featureAccess]
  if (raw) {
    try {
      stored = JSON.parse(raw)
    } catch {
      stored = null
    }
  }
  return mergeFeatureAccess(stored)
}

// Resolve the prompt quota for a given plan.
export function quotaForPlan(
  quotas: AiVisibilityConfig['quotas'],
  plan: string
): number {
  if (plan === 'starter') return quotas.starter
  if (plan === 'pro') return quotas.pro
  if (plan === 'agency') return quotas.agency
  return quotas.free
}
