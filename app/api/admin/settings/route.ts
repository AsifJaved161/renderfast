import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, logAdminAction, adminAuthError } from '@/lib/admin-auth'
import { getDbSettings, getOpsConfig, clearConfigCache, SETTING_KEYS, OPS_DEFAULTS } from '@/lib/app-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SECRET_KEYS = new Set<string>([SETTING_KEYS.cfApiToken])
const ALLOWED = new Set<string>(Object.values(SETTING_KEYS))

function mask(v: string): string {
  if (!v) return ''
  if (v.length <= 8) return '••••'
  return `${v.slice(0, 6)}…${v.slice(-4)}`
}

function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

// Maps a setting key → its env-var fallback name (for the "source" indicator).
const ENV_OF: Record<string, string> = {
  [SETTING_KEYS.cfAccountId]: 'CLOUDFLARE_ACCOUNT_ID',
  [SETTING_KEYS.cfApiToken]: 'CLOUDFLARE_API_TOKEN',
  [SETTING_KEYS.cfKvNamespaceId]: 'CLOUDFLARE_KV_NAMESPACE_ID',
  [SETTING_KEYS.cfBrowserRenderingUrl]: 'CLOUDFLARE_BROWSER_RENDERING_URL',
}

// ── GET — current settings (secrets masked) + live usage ─────────────────────
export async function GET() {
  try {
    await requireAdmin()

    const db = await getDbSettings()
    const ops = await getOpsConfig()

    // Cloudflare creds with source + masked secret.
    const cloudflare = [
      SETTING_KEYS.cfAccountId,
      SETTING_KEYS.cfApiToken,
      SETTING_KEYS.cfKvNamespaceId,
      SETTING_KEYS.cfBrowserRenderingUrl,
    ].map((key) => {
      const dbVal = db[key] ?? ''
      const envVal = ENV_OF[key] ? env(ENV_OF[key]) : ''
      const effective = dbVal || envVal
      const isSecret = SECRET_KEYS.has(key)
      return {
        key,
        set: !!effective,
        source: dbVal ? 'db' : envVal ? 'env' : 'unset',
        // Never return the real token; only a masked preview.
        value: isSecret ? '' : dbVal, // editable fields prefill from DB only
        preview: effective ? (isSecret ? mask(effective) : effective) : '',
      }
    })

    // ── Usage ──────────────────────────────────────────────────────────────────
    const head = async (table: string, build?: (q: any) => any) => {
      let q = supabaseAdmin.from(table).select('id', { count: 'exact', head: true })
      if (build) q = build(q)
      const { count } = await q
      return count ?? 0
    }
    const todayStart = new Date(new Date().toISOString().slice(0, 10)).toISOString()
    const monthStart = new Date(Date.now() - 30 * 86400_000).toISOString()

    const [
      rendersToday,
      rendersMonth,
      rendersAll,
      cachedPages,
      qPending,
      qRendering,
      qCompleted,
      qFailed,
      jobsActive,
      diagRows,
      sites,
      users,
    ] = await Promise.all([
      head('renders', (q) => q.gte('created_at', todayStart)),
      head('renders', (q) => q.gte('created_at', monthStart)),
      head('renders'),
      head('cache_entries'),
      head('caching_queue', (q) => q.eq('status', 'pending')),
      head('caching_queue', (q) => q.eq('status', 'rendering')),
      head('caching_queue', (q) => q.eq('status', 'completed')),
      head('caching_queue', (q) => q.eq('status', 'failed')),
      head('diagnostics_jobs', (q) => q.in('status', ['queued', 'running'])),
      head('render_diagnostics'),
      head('sites'),
      head('users'),
    ])

    return NextResponse.json({
      cloudflare,
      ops: {
        values: ops,
        defaults: OPS_DEFAULTS,
        sources: {
          max_rescan_urls: db[SETTING_KEYS.maxRescanUrls] ? 'db' : 'default',
          rescan_concurrency: db[SETTING_KEYS.rescanConcurrency] ? 'db' : 'default',
          cache_ttl_seconds: db[SETTING_KEYS.cacheTtlSeconds] ? 'db' : 'default',
          sitemap_max_urls: db[SETTING_KEYS.sitemapMaxUrls] ? 'db' : 'default',
        },
      },
      usage: {
        renders: { today: rendersToday, month: rendersMonth, all: rendersAll },
        cachedPages,
        queue: { pending: qPending, rendering: qRendering, completed: qCompleted, failed: qFailed },
        diagnostics: { activeJobs: jobsActive, totalRuns: diagRows },
        sites,
        users,
      },
    })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ── PATCH — update settings (upsert; empty string reverts to env/default) ─────
export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await req.json().catch(() => ({}))
    const incoming = (body?.settings ?? {}) as Record<string, unknown>

    const changed: string[] = []
    for (const [key, raw] of Object.entries(incoming)) {
      if (!ALLOWED.has(key)) continue
      const value = typeof raw === 'string' ? raw.trim() : String(raw ?? '')

      if (value === '') {
        // Empty → delete the override so it falls back to env/default.
        await supabaseAdmin.from('app_settings').delete().eq('key', key)
      } else {
        await supabaseAdmin
          .from('app_settings')
          .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      }
      changed.push(key)
    }

    clearConfigCache()
    await logAdminAction(admin.id, 'update_settings', 'settings', undefined, { changed }, req.headers.get('x-forwarded-for'))

    return NextResponse.json({ updated: changed })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
