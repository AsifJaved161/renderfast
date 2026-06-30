// ─────────────────────────────────────────────────────────────────────────────
// Platform-level controls for the Schema Markup feature (RenderForAI admin only).
//
// Operational, not per-client review:
//   • Global on/off switch        — schema_generation.enabled
//   • Plan gate                   — schema_generation.min_plan (e.g. Pro+)
//   • Per-site override           — schema_site_overrides[siteId] = 'on' | 'off'
//     (force-enable/disable for one site regardless of plan, for support)
//
// Stored in platform_settings (admin-owned, jsonb) — same pattern as bot-cost.
// Read via the service-role client; gated behind requireAdmin() on the admin API.
// Cached briefly so the generation + serving paths don't hit the DB every time.
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseAdmin } from '@/lib/supabase'
import { PLAN_RANK } from '@/lib/feature-access'
import type { Plan } from '@/lib/supabase'

const CONFIG_KEY = 'schema_generation'
const OVERRIDES_KEY = 'schema_site_overrides'

export interface SchemaConfig {
  enabled: boolean
  minPlan: Plan
}
export type SiteOverride = 'on' | 'off'
export type SiteOverrideMap = Record<string, SiteOverride>

// Defaults when nothing is stored: feature ON, available from the Starter plan
// (aligns with the /schema-markup feature-access default).
export const SCHEMA_DEFAULTS: SchemaConfig = { enabled: true, minPlan: 'starter' }

const TTL_MS = 15_000
let configCache: { value: SchemaConfig; at: number } | null = null
let overridesCache: { value: SiteOverrideMap; at: number } | null = null

export function clearSchemaSettingsCache(): void {
  configCache = null
  overridesCache = null
}

export async function getSchemaConfig(): Promise<SchemaConfig> {
  if (configCache && Date.now() - configCache.at < TTL_MS) return configCache.value
  let value = SCHEMA_DEFAULTS
  try {
    const { data } = await supabaseAdmin.from('platform_settings').select('value').eq('key', CONFIG_KEY).maybeSingle()
    const v = (data?.value ?? {}) as Partial<SchemaConfig>
    value = {
      enabled: typeof v.enabled === 'boolean' ? v.enabled : SCHEMA_DEFAULTS.enabled,
      minPlan: v.minPlan && v.minPlan in PLAN_RANK ? (v.minPlan as Plan) : SCHEMA_DEFAULTS.minPlan,
    }
  } catch {
    /* table missing pre-migration → defaults */
  }
  configCache = { value, at: Date.now() }
  return value
}

export async function getSiteOverrides(): Promise<SiteOverrideMap> {
  if (overridesCache && Date.now() - overridesCache.at < TTL_MS) return overridesCache.value
  let value: SiteOverrideMap = {}
  try {
    const { data } = await supabaseAdmin.from('platform_settings').select('value').eq('key', OVERRIDES_KEY).maybeSingle()
    const raw = (data?.value ?? {}) as Record<string, unknown>
    value = Object.fromEntries(
      Object.entries(raw).filter(([, v]) => v === 'on' || v === 'off')
    ) as SiteOverrideMap
  } catch {
    /* defaults */
  }
  overridesCache = { value, at: Date.now() }
  return value
}

// The core decision used by both the generation and serving paths.
//   override 'on'  → force enabled (bypasses plan gate AND global switch)
//   override 'off' → force disabled
//   otherwise      → global switch AND the site's plan meets the gate
export function resolveSchemaEnabled(plan: Plan, override: SiteOverride | undefined, cfg: SchemaConfig): boolean {
  if (override === 'on') return true
  if (override === 'off') return false
  if (!cfg.enabled) return false
  return PLAN_RANK[plan] >= PLAN_RANK[cfg.minPlan]
}

// Convenience: load config + override for one site and resolve. Used on the
// generation (background) and serving (hot, but cached) paths.
export async function isSchemaEnabledForSite(siteId: string, plan: Plan): Promise<boolean> {
  const [cfg, overrides] = await Promise.all([getSchemaConfig(), getSiteOverrides()])
  return resolveSchemaEnabled(plan, overrides[siteId], cfg)
}

// ── Admin writers (called only from the requireAdmin-gated admin API) ─────────
export async function setSchemaConfig(cfg: SchemaConfig, adminId: string): Promise<void> {
  await supabaseAdmin.from('platform_settings').upsert(
    { key: CONFIG_KEY, value: cfg, updated_at: new Date().toISOString(), updated_by: adminId },
    { onConflict: 'key' }
  )
  clearSchemaSettingsCache()
}

export async function setSiteOverride(siteId: string, override: SiteOverride | 'default', adminId: string): Promise<SiteOverrideMap> {
  const current = await getSiteOverrides()
  const next = { ...current }
  if (override === 'default') delete next[siteId]
  else next[siteId] = override
  await supabaseAdmin.from('platform_settings').upsert(
    { key: OVERRIDES_KEY, value: next, updated_at: new Date().toISOString(), updated_by: adminId },
    { onConflict: 'key' }
  )
  clearSchemaSettingsCache()
  return next
}
