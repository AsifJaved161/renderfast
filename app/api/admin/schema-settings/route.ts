import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logAdminAction, adminAuthError } from '@/lib/admin-auth'
import { getSchemaConfig, getSiteOverrides, setSchemaConfig, setSiteOverride, type SchemaConfig } from '@/lib/schema-settings'
import { PLAN_RANK } from '@/lib/feature-access'
import type { Plan } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET — current config + per-site overrides ─────────────────────────────────
export async function GET() {
  try {
    await requireAdmin()
    const [config, overrides] = await Promise.all([getSchemaConfig(), getSiteOverrides()])
    return NextResponse.json({ config, overrides })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ── PATCH — update the global config (enabled + plan gate) ────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await req.json().catch(() => ({}))
    const enabled = !!body?.enabled
    const minPlan: Plan = body?.minPlan && body.minPlan in PLAN_RANK ? (body.minPlan as Plan) : 'starter'
    const config: SchemaConfig = { enabled, minPlan }

    await setSchemaConfig(config, admin.id)
    await logAdminAction(admin.id, 'update_schema_settings', 'settings', undefined, { config }, req.headers.get('x-forwarded-for'))

    return NextResponse.json({ config })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ── POST — set/clear a per-site override ('on' | 'off' | 'default') ───────────
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await req.json().catch(() => ({}))
    const siteId: string | undefined = body?.site_id
    const override: 'on' | 'off' | 'default' = body?.override
    if (!siteId) return NextResponse.json({ error: 'site_id required' }, { status: 400 })
    if (!['on', 'off', 'default'].includes(override)) {
      return NextResponse.json({ error: 'override must be on | off | default' }, { status: 400 })
    }

    const overrides = await setSiteOverride(siteId, override, admin.id)
    await logAdminAction(admin.id, 'set_schema_site_override', 'site', siteId, { override }, req.headers.get('x-forwarded-for'))

    return NextResponse.json({ overrides })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
