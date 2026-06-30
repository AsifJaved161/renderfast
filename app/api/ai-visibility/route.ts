import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAiVisibilityConfig, quotaForPlan, anyEngineReady, AI_ENGINE_ORDER, type AiEngine } from '@/lib/app-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function userId(req: NextRequest) {
  return req.headers.get('x-user-id')
}

// Confirm a site belongs to the user; returns { domain } or null.
async function ownedSite(siteId: string, uid: string): Promise<{ domain: string; name: string | null } | null> {
  const { data } = await supabaseAdmin
    .from('sites')
    .select('domain, name')
    .eq('id', siteId)
    .eq('user_id', uid)
    .maybeSingle()
  return data ?? null
}

async function getPlan(uid: string): Promise<string> {
  const { data } = await supabaseAdmin.from('users').select('plan').eq('id', uid).maybeSingle()
  return data?.plan ?? 'free'
}

interface EngineCell {
  mentioned: boolean
  citationUrl: string | null
  snippet: string | null
  error: string | null
}
interface BreakdownRow {
  promptText: string
  engines: Partial<Record<AiEngine, EngineCell>>
}

// ── GET /api/ai-visibility?site_id= — config + prompts + latest results + trend ─
export async function GET(req: NextRequest) {
  const uid = userId(req)
  if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

  const siteId = req.nextUrl.searchParams.get('site_id')
  if (!siteId) return NextResponse.json({ error: 'site_id required' }, { status: 400 })

  const site = await ownedSite(siteId, uid)
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const [plan, cfg] = await Promise.all([getPlan(uid), getAiVisibilityConfig()])
  const quota = quotaForPlan(cfg.quotas, plan)
  const enginesReady = anyEngineReady(cfg)

  const [{ data: cfgRow }, { data: promptRows }] = await Promise.all([
    supabaseAdmin
      .from('ai_visibility_sites')
      .select('brand_name, tracking, last_checked_at')
      .eq('site_id', siteId)
      .maybeSingle(),
    supabaseAdmin
      .from('ai_visibility_prompts')
      .select('id, prompt')
      .eq('site_id', siteId)
      .order('created_at', { ascending: true }),
  ])

  const prompts = (promptRows ?? []).map((p) => ({ id: p.id as string, prompt: p.prompt as string }))

  // Latest run breakdown + trend (one query, grouped client-side).
  const { data: checks } = await supabaseAdmin
    .from('ai_visibility_checks')
    .select('prompt_text, engine, mentioned, citation_url, snippet, error, run_at')
    .eq('site_id', siteId)
    .order('run_at', { ascending: false })
    .limit(2000)

  const allChecks = checks ?? []

  // Trend: score per run (% of prompts mentioned in ≥1 engine that run).
  const byRun = new Map<string, Map<string, boolean>>() // run_at → (promptText → mentioned-any)
  for (const c of allChecks) {
    const run = c.run_at as string
    if (!byRun.has(run)) byRun.set(run, new Map())
    const m = byRun.get(run)!
    const pt = c.prompt_text as string
    m.set(pt, (m.get(pt) ?? false) || !!c.mentioned)
  }
  const trend = [...byRun.entries()]
    .map(([run, m]) => {
      const total = m.size
      const visible = [...m.values()].filter(Boolean).length
      return { date: run.slice(0, 10), score: total ? Math.round((visible / total) * 100) : 0 }
    })
    .sort((a, b) => a.date.localeCompare(b.date))

  // Latest-run breakdown. Columns (engines) are whatever appeared in that run.
  const latestRun = allChecks[0]?.run_at as string | undefined
  let breakdown: BreakdownRow[] = []
  let score: number | null = null
  const enginesUsedSet = new Set<AiEngine>()
  if (latestRun) {
    const latest = allChecks.filter((c) => c.run_at === latestRun)
    const map = new Map<string, BreakdownRow>()
    for (const c of latest) {
      const pt = c.prompt_text as string
      if (!map.has(pt)) map.set(pt, { promptText: pt, engines: {} })
      const row = map.get(pt)!
      const engine = c.engine as AiEngine
      enginesUsedSet.add(engine)
      row.engines[engine] = {
        mentioned: !!c.mentioned,
        citationUrl: (c.citation_url as string | null) ?? null,
        snippet: (c.snippet as string | null) ?? null,
        error: (c.error as string | null) ?? null,
      }
    }
    breakdown = [...map.values()]
    const visible = breakdown.filter((r) => Object.values(r.engines).some((cell) => cell?.mentioned)).length
    score = breakdown.length ? Math.round((visible / breakdown.length) * 100) : 0
  }
  // Engines used, in canonical order, for stable column ordering on the client.
  const enginesUsed = AI_ENGINE_ORDER.filter((e) => enginesUsedSet.has(e))

  return NextResponse.json({
    plan,
    quota,
    enabled: quota > 0, // paid-tier gate
    enginesReady, // admin has configured at least one engine key
    frequency: cfg.frequency,
    domain: site.domain,
    brandName: cfgRow?.brand_name ?? '',
    tracking: cfgRow?.tracking ?? false,
    lastCheckedAt: cfgRow?.last_checked_at ?? null,
    prompts,
    score,
    breakdown,
    enginesUsed,
    trend,
  })
}

// ── POST /api/ai-visibility — save brand name + tracked prompts ───────────────
export async function POST(req: NextRequest) {
  const uid = userId(req)
  if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const siteId: string | undefined = body?.site_id
  const brandName: string = (body?.brand_name ?? '').toString().trim()
  const rawPrompts: unknown = body?.prompts
  if (!siteId) return NextResponse.json({ error: 'site_id required' }, { status: 400 })
  if (!brandName) return NextResponse.json({ error: 'Brand name required' }, { status: 400 })

  const site = await ownedSite(siteId, uid)
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const [plan, cfg] = await Promise.all([getPlan(uid), getAiVisibilityConfig()])
  const quota = quotaForPlan(cfg.quotas, plan)
  if (quota <= 0) {
    return NextResponse.json({ error: 'AI Visibility Tracker is not available on your plan. Upgrade to unlock it.' }, { status: 403 })
  }

  // Clean + dedupe prompts, enforce the per-plan quota.
  const prompts = Array.isArray(rawPrompts)
    ? [...new Set(rawPrompts.map((p) => String(p ?? '').trim()).filter((p) => p.length > 0))]
    : []
  if (prompts.length > quota) {
    return NextResponse.json({ error: `Your plan allows up to ${quota} prompts.` }, { status: 400 })
  }

  const now = new Date().toISOString()

  // Upsert the per-site config (brand name).
  await supabaseAdmin.from('ai_visibility_sites').upsert(
    { site_id: siteId, user_id: uid, brand_name: brandName, updated_at: now },
    { onConflict: 'site_id' }
  )

  // Replace the prompt set. Historical checks keep their prompt_text snapshot
  // (prompt_id is ON DELETE SET NULL), so the trend graph is preserved.
  await supabaseAdmin.from('ai_visibility_prompts').delete().eq('site_id', siteId)
  if (prompts.length > 0) {
    await supabaseAdmin
      .from('ai_visibility_prompts')
      .insert(prompts.map((prompt) => ({ site_id: siteId, user_id: uid, prompt })))
  }

  return NextResponse.json({ success: true, prompts: prompts.length, quota })
}
