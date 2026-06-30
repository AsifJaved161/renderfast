// ─────────────────────────────────────────────────────────────────────────────
// Per-plan feature gating. The platform admin decides which dashboard features
// belong to which plan tier; features above a user's plan are shown blurred with
// an upgrade prompt (a UX gate — the admin controls the mapping from the admin
// panel). Account-management pages (billing, settings, …) are never gateable so
// users can always reach them to upgrade.
// ─────────────────────────────────────────────────────────────────────────────
import type { Plan } from '@/lib/supabase'

export const PLAN_RANK: Record<Plan, number> = { free: 0, starter: 1, pro: 2, agency: 3 }
export const PLAN_LABEL: Record<Plan, string> = { free: 'Free', starter: 'Starter', pro: 'Pro', agency: 'Agency' }
export const PLAN_ORDER: Plan[] = ['free', 'starter', 'pro', 'agency']

// Gateable dashboard features, keyed by their route. `minPlan` here is the
// built-in default; the admin can override any of these.
export interface FeatureDef {
  key: string // route path (matches the dashboard nav key)
  label: string
  defaultMinPlan: Plan
}

export const FEATURE_DEFS: FeatureDef[] = [
  { key: '/dashboard', label: 'Dashboard', defaultMinPlan: 'free' },
  { key: '/domain-manager', label: 'Domain Manager', defaultMinPlan: 'free' },
  { key: '/cdn-analytics', label: 'CDN Analytics', defaultMinPlan: 'starter' },
  { key: '/insight', label: 'SEO Insights', defaultMinPlan: 'starter' },
  { key: '/bot-visibility', label: 'Bot Visibility', defaultMinPlan: 'starter' },
  { key: '/ai-visibility', label: 'AI Visibility Tracker', defaultMinPlan: 'pro' },
  { key: '/bot-cost', label: 'Bot Cost Insights', defaultMinPlan: 'pro' },
  { key: '/render-history', label: 'Render History', defaultMinPlan: 'free' },
  { key: '/cache', label: 'Cache Manager', defaultMinPlan: 'free' },
  { key: '/caching-queue', label: 'Caching Queue', defaultMinPlan: 'free' },
  { key: '/sitemaps', label: 'Sitemaps', defaultMinPlan: 'free' },
  { key: '/seo-reports', label: 'SEO Reports', defaultMinPlan: 'starter' },
  { key: '/404-checker', label: '404 Checker', defaultMinPlan: 'free' },
  { key: '/render-errors', label: 'Render Errors', defaultMinPlan: 'free' },
  { key: '/llms-txt', label: 'llms.txt', defaultMinPlan: 'starter' },
  { key: '/gsc', label: 'Google Search Console', defaultMinPlan: 'starter' },
]

const FEATURE_KEYS = new Set(FEATURE_DEFS.map((f) => f.key))

// Routes that must always stay reachable (so users can manage their account /
// upgrade) — never gated regardless of the admin config.
export function isGateableFeature(key: string): boolean {
  return FEATURE_KEYS.has(key)
}

export type FeatureAccessMap = Record<string, Plan>

// The built-in defaults as a map.
export function defaultFeatureAccess(): FeatureAccessMap {
  const out: FeatureAccessMap = {}
  for (const f of FEATURE_DEFS) out[f.key] = f.defaultMinPlan
  return out
}

// Merge a stored override map over the defaults (ignores unknown keys / values).
export function mergeFeatureAccess(stored: Record<string, unknown> | null | undefined): FeatureAccessMap {
  const out = defaultFeatureAccess()
  if (stored) {
    for (const f of FEATURE_DEFS) {
      const v = stored[f.key]
      if (typeof v === 'string' && v in PLAN_RANK) out[f.key] = v as Plan
    }
  }
  return out
}

// Does a user on `userPlan` have access to a feature requiring `minPlan`?
export function hasFeatureAccess(userPlan: Plan, minPlan: Plan): boolean {
  return PLAN_RANK[userPlan] >= PLAN_RANK[minPlan]
}

// Resolve the required plan for a route from an access map (free if not gated).
export function requiredPlanFor(key: string, access: FeatureAccessMap): Plan {
  if (!isGateableFeature(key)) return 'free'
  return access[key] ?? 'free'
}
