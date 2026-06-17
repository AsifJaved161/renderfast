import { PLAN_LIMITS, type PlanLimits } from '@/lib/constants'
import type { DbUser, Plan } from '@/lib/supabase'

export function getPlanLimits(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
}

export function isRenderLimitReached(user: DbUser): boolean {
  return user.render_count >= user.render_limit
}

export function getRenderUsagePercent(user: DbUser): number {
  if (!user.render_limit) return 0
  const pct = (user.render_count / user.render_limit) * 100
  return Math.min(100, Math.max(0, Math.round(pct)))
}

export function canAddSite(user: DbUser, currentSiteCount: number): boolean {
  const { sites } = getPlanLimits(user.plan)
  return currentSiteCount < sites
}
