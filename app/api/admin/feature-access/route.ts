import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, logAdminAction, adminAuthError } from '@/lib/admin-auth'
import { getFeatureAccessMap, clearConfigCache, SETTING_KEYS } from '@/lib/app-config'
import { FEATURE_DEFS, PLAN_RANK, mergeFeatureAccess } from '@/lib/feature-access'
import type { Plan } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET — current feature→plan map + the feature catalog ──────────────────────
export async function GET() {
  try {
    await requireAdmin()
    const access = await getFeatureAccessMap()
    return NextResponse.json({ access, features: FEATURE_DEFS })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ── PATCH — save the feature→plan map ─────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await req.json().catch(() => ({}))
    const incoming = (body?.access ?? {}) as Record<string, unknown>

    // Validate + merge over defaults so only known features/plans are stored.
    const clean: Record<string, Plan> = {}
    for (const f of FEATURE_DEFS) {
      const v = incoming[f.key]
      if (typeof v === 'string' && v in PLAN_RANK) clean[f.key] = v as Plan
      else clean[f.key] = f.defaultMinPlan
    }

    await supabaseAdmin
      .from('app_settings')
      .upsert({ key: SETTING_KEYS.featureAccess, value: JSON.stringify(clean), updated_at: new Date().toISOString() }, { onConflict: 'key' })

    clearConfigCache()
    await logAdminAction(admin.id, 'update_feature_access', 'settings', undefined, { access: clean }, req.headers.get('x-forwarded-for'))

    return NextResponse.json({ access: mergeFeatureAccess(clean) })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
