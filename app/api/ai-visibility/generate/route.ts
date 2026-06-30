import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAiVisibilityConfig, quotaForPlan, anyEngineReady, getFeatureAccessMap } from '@/lib/app-config'
import { hasFeatureAccess, requiredPlanFor, PLAN_LABEL } from '@/lib/feature-access'
import { generatePrompts } from '@/lib/ai-visibility'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function userId(req: NextRequest) {
  return req.headers.get('x-user-id')
}

// Derive a brand name from a domain (example.com → Example).
function brandFromDomain(domain: string): string {
  const root = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('.')[0] ?? ''
  return root ? root.charAt(0).toUpperCase() + root.slice(1) : ''
}

// ── POST /api/ai-visibility/generate — auto-generate tracked prompts ──────────
export async function POST(req: NextRequest) {
  const uid = userId(req)
  if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const siteId: string | undefined = body?.site_id
  if (!siteId) return NextResponse.json({ error: 'site_id required' }, { status: 400 })

  // Verify ownership.
  const { data: site } = await supabaseAdmin
    .from('sites')
    .select('domain')
    .eq('id', siteId)
    .eq('user_id', uid)
    .maybeSingle()
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  // Plan gate + quota.
  const { data: userRow } = await supabaseAdmin.from('users').select('plan').eq('id', uid).maybeSingle()
  const plan = userRow?.plan ?? 'free'
  const cfg = await getAiVisibilityConfig()
  const quota = quotaForPlan(cfg.quotas, plan)
  // Server-side feature gate (defense-in-depth — mirrors the dashboard UI gate).
  const reqPlan = requiredPlanFor('/ai-visibility', await getFeatureAccessMap())
  if (!hasFeatureAccess(plan, reqPlan)) {
    return NextResponse.json({ error: `AI Visibility Tracker is available on the ${PLAN_LABEL[reqPlan]} plan.` }, { status: 403 })
  }
  if (quota <= 0) {
    return NextResponse.json({ error: 'AI Visibility Tracker is not available on your plan.' }, { status: 403 })
  }
  if (!anyEngineReady(cfg)) {
    return NextResponse.json({ error: 'AI answer-engine API keys are not configured yet. Please contact support.' }, { status: 503 })
  }

  // Resolve the brand: explicit > saved > derived from domain.
  const { data: cfgRow } = await supabaseAdmin
    .from('ai_visibility_sites')
    .select('brand_name')
    .eq('site_id', siteId)
    .maybeSingle()
  const brand = (body?.brand_name ?? '').toString().trim() || cfgRow?.brand_name?.trim() || brandFromDomain(site.domain)
  if (!brand) return NextResponse.json({ error: 'Could not determine a brand name.' }, { status: 400 })

  // Engine key map (only engines with ≥1 key).
  const engineKeys = Object.fromEntries(
    Object.entries(cfg.engines).filter(([, v]) => v.keys.length > 0).map(([e, v]) => [e, v.keys])
  )

  const prompts = await generatePrompts(brand, site.domain, quota, engineKeys)
  if (prompts.length === 0) {
    return NextResponse.json({ error: 'Could not generate keywords. Please try again.' }, { status: 502 })
  }

  const now = new Date().toISOString()

  // Save the brand + replace the prompt set with the generated one.
  await supabaseAdmin.from('ai_visibility_sites').upsert(
    { site_id: siteId, user_id: uid, brand_name: brand, updated_at: now },
    { onConflict: 'site_id' }
  )
  await supabaseAdmin.from('ai_visibility_prompts').delete().eq('site_id', siteId)
  await supabaseAdmin
    .from('ai_visibility_prompts')
    .insert(prompts.map((prompt) => ({ site_id: siteId, user_id: uid, prompt })))

  return NextResponse.json({ success: true, brand, prompts })
}
