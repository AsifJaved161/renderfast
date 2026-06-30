import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAiVisibilityConfig, quotaForPlan, anyEngineReady, getFeatureAccessMap } from '@/lib/app-config'
import { hasFeatureAccess, requiredPlanFor, PLAN_LABEL } from '@/lib/feature-access'
import { checkPrompt, mapLimit } from '@/lib/ai-visibility'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // a 50-prompt agency scan = 100 answer-engine calls

function userId(req: NextRequest) {
  return req.headers.get('x-user-id')
}

// ── POST /api/ai-visibility/scan — run a fresh visibility check for a site ────
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
    return NextResponse.json(
      { error: 'AI answer-engine API keys are not configured yet. Please contact support.' },
      { status: 503 }
    )
  }
  // Map of engine → its configured key list (only engines with ≥1 key).
  const engineKeys = Object.fromEntries(
    Object.entries(cfg.engines).filter(([, v]) => v.keys.length > 0).map(([e, v]) => [e, v.keys])
  )

  // Brand + prompts.
  const { data: cfgRow } = await supabaseAdmin
    .from('ai_visibility_sites')
    .select('brand_name')
    .eq('site_id', siteId)
    .maybeSingle()
  const brand = cfgRow?.brand_name?.trim()
  if (!brand) return NextResponse.json({ error: 'Set your brand name first.' }, { status: 400 })

  const { data: promptRows } = await supabaseAdmin
    .from('ai_visibility_prompts')
    .select('id, prompt')
    .eq('site_id', siteId)
    .order('created_at', { ascending: true })
    .limit(quota)
  const prompts = (promptRows ?? []) as { id: string; prompt: string }[]
  if (prompts.length === 0) return NextResponse.json({ error: 'Add at least one prompt to track.' }, { status: 400 })

  const runAt = new Date().toISOString()

  // Check every prompt against both engines (bounded concurrency).
  const rows: Record<string, unknown>[] = []
  await mapLimit(prompts, 5, async (p) => {
    const results = await checkPrompt(p.prompt, brand, site.domain, engineKeys)
    for (const r of results) {
      rows.push({
        site_id: siteId,
        user_id: uid,
        prompt_id: p.id,
        prompt_text: p.prompt,
        engine: r.engine,
        mentioned: r.mentioned,
        citation_url: r.citationUrl,
        snippet: r.snippet,
        error: r.error,
        run_at: runAt,
      })
    }
  })

  // Persist the run + mark the site as actively tracked.
  if (rows.length > 0) await supabaseAdmin.from('ai_visibility_checks').insert(rows)
  await supabaseAdmin
    .from('ai_visibility_sites')
    .update({ tracking: true, last_checked_at: runAt, updated_at: runAt })
    .eq('site_id', siteId)

  // Score for this run (% of prompts mentioned in ≥1 engine).
  const perPrompt = new Map<string, boolean>()
  for (const r of rows) {
    const pt = r.prompt_text as string
    perPrompt.set(pt, (perPrompt.get(pt) ?? false) || !!r.mentioned)
  }
  const visible = [...perPrompt.values()].filter(Boolean).length
  const score = perPrompt.size ? Math.round((visible / perPrompt.size) * 100) : 0

  return NextResponse.json({ success: true, runAt, score, prompts: prompts.length })
}
