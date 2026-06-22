import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, logAdminAction, adminAuthError } from '@/lib/admin-auth'
import { getCloudflareConfig } from '@/lib/app-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const GB = 1_000_000_000

// Admin-configurable Cloudflare plan limits (stored in app_settings as text).
// Defaults reflect the FREE tier — the admin sets these to their actual plan.
const LIMIT_KEYS = {
  renderMonth: 'cf_render_limit_month',
  kvStorageGb: 'cf_kv_storage_gb',
  kvReadsDay: 'cf_kv_reads_day',
  kvWritesDay: 'cf_kv_writes_day',
} as const

const LIMIT_DEFAULTS = {
  renderMonth: 100_000, // Browser Rendering calls / month
  kvStorageGb: 1, // KV storage (GB)
  kvReadsDay: 100_000, // KV reads / day
  kvWritesDay: 1_000, // KV writes / day
}

type LimitKey = keyof typeof LIMIT_KEYS

async function readLimits(): Promise<Record<LimitKey, number>> {
  const { data } = await supabaseAdmin
    .from('app_settings')
    .select('key, value')
    .in('key', Object.values(LIMIT_KEYS))
  const map = new Map((data ?? []).map((r) => [r.key, r.value]))
  const out = { ...LIMIT_DEFAULTS }
  for (const k of Object.keys(LIMIT_KEYS) as LimitKey[]) {
    const raw = map.get(LIMIT_KEYS[k])
    const n = raw != null ? Number(raw) : NaN
    if (Number.isFinite(n) && n > 0) out[k] = n
  }
  return out
}

const pct = (used: number, limit: number) => (limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0)

// ── GET — current Cloudflare usage vs limits (+ capacity estimate) ───────────
export async function GET() {
  try {
    await requireAdmin()

    const { data, error } = await supabaseAdmin.rpc('admin_cloudflare_usage')
    if (error) throw error
    const u = (Array.isArray(data) ? data[0] : data) ?? {}

    const usage = {
      renders: {
        today: Number(u.renders_today ?? 0),
        month: Number(u.renders_month ?? 0),
        all: Number(u.renders_all ?? 0),
      },
      kv: {
        keys: Number(u.kv_keys ?? 0),
        bytes: Number(u.kv_bytes ?? 0),
        readsToday: Number(u.reads_today ?? 0),
        writesToday: Number(u.writes_today ?? 0),
      },
      totalSites: Number(u.total_sites ?? 0),
    }

    const limits = await readLimits()
    const kvStorageLimitBytes = limits.kvStorageGb * GB

    // Deep-link to the Cloudflare dashboard (KV namespace if known) — opens in a
    // new tab so the admin can see the authoritative analytics there.
    const cf = await getCloudflareConfig()
    const dashboardUrl = cf.accountId
      ? `https://dash.cloudflare.com/${cf.accountId}/workers/kv/namespaces${cf.kvNamespaceId ? `/${cf.kvNamespaceId}` : ''}`
      : 'https://dash.cloudflare.com/'

    // Capacity planning for scale: how many MORE sites the remaining monthly
    // render budget can support at the current average renders-per-site.
    const avgRendersPerSite =
      usage.totalSites > 0 ? usage.renders.month / usage.totalSites : 0
    const renderMonthRemaining = Math.max(0, limits.renderMonth - usage.renders.month)
    const estSitesRemaining =
      avgRendersPerSite > 0 ? Math.floor(renderMonthRemaining / avgRendersPerSite) : null

    return NextResponse.json({
      usage,
      limits,
      dashboardUrl,
      derived: {
        renderMonthPct: pct(usage.renders.month, limits.renderMonth),
        renderMonthRemaining,
        kvStoragePct: pct(usage.kv.bytes, kvStorageLimitBytes),
        kvStorageRemainingBytes: Math.max(0, kvStorageLimitBytes - usage.kv.bytes),
        kvReadsPct: pct(usage.kv.readsToday, limits.kvReadsDay),
        kvWritesPct: pct(usage.kv.writesToday, limits.kvWritesDay),
        avgRendersPerSite: Math.round(avgRendersPerSite),
        estSitesRemaining,
      },
    })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ── PATCH — update the configured plan limits ────────────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await req.json().catch(() => ({}))

    const changed: string[] = []
    for (const k of Object.keys(LIMIT_KEYS) as LimitKey[]) {
      if (!(k in body)) continue
      const n = Number(body[k])
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: `${k} must be a positive number` }, { status: 400 })
      }
      await supabaseAdmin
        .from('app_settings')
        .upsert({ key: LIMIT_KEYS[k], value: String(n), updated_at: new Date().toISOString() }, { onConflict: 'key' })
      changed.push(k)
    }

    await logAdminAction(admin.id, 'update_cf_limits', 'settings', undefined, { changed }, req.headers.get('x-forwarded-for'))
    return NextResponse.json({ updated: changed, limits: await readLimits() })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
