import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, adminAuthError } from '@/lib/admin-auth'
import { getCloudflareConfig } from '@/lib/app-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface Check {
  name: string
  ok: boolean
  message: string
}

// ── POST /api/admin/settings/test ────────────────────────────────────────────
// Live-checks the Cloudflare config. Body may override the saved values so an
// admin can validate BEFORE saving: { accountId?, apiToken?, kvNamespaceId? }.
export async function POST(req: NextRequest) {
  try {
    await requireAdmin()

    const body = await req.json().catch(() => ({}))
    const saved = await getCloudflareConfig()
    const accountId: string = (body.accountId || saved.accountId || '').trim()
    const apiToken: string = (body.apiToken || saved.apiToken || '').trim()
    const kvNamespaceId: string = (body.kvNamespaceId || saved.kvNamespaceId || '').trim()

    const checks: Check[] = []
    const auth = { Authorization: `Bearer ${apiToken}` }

    if (!accountId || !apiToken) {
      return NextResponse.json({
        ok: false,
        checks: [{ name: 'Credentials', ok: false, message: 'Account ID and API token are required.' }],
      })
    }

    // 1) Token verify (account-owned token endpoint).
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`, { headers: auth })
      const d = await r.json()
      checks.push({
        name: 'API token',
        ok: !!d.success,
        message: d.success ? 'Valid & active' : d.errors?.[0]?.message ?? 'Invalid token',
      })
    } catch (e) {
      checks.push({ name: 'API token', ok: false, message: e instanceof Error ? e.message : 'verify failed' })
    }

    // 2) Browser Rendering (real render of example.com).
    try {
      const r = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/content`,
        { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com' }) }
      )
      const d = await r.json()
      checks.push({
        name: 'Browser Rendering',
        ok: !!d.success,
        message: d.success ? 'Render OK' : d.errors?.[0]?.message ?? 'Render failed (check Browser Rendering permission/plan)',
      })
    } catch (e) {
      checks.push({ name: 'Browser Rendering', ok: false, message: e instanceof Error ? e.message : 'render failed' })
    }

    // 3) KV read/write (only if a namespace is provided).
    if (kvNamespaceId) {
      const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvNamespaceId}/values/rf_health`
      try {
        const w = await fetch(base, { method: 'PUT', headers: auth, body: 'ok' })
        const rd = await fetch(base, { headers: auth })
        const val = await rd.text()
        await fetch(base, { method: 'DELETE', headers: auth }).catch(() => {})
        const ok = w.ok && rd.ok && val === 'ok'
        checks.push({ name: 'KV cache', ok, message: ok ? 'Read/write OK' : 'KV access failed (check Workers KV permission & namespace ID)' })
      } catch (e) {
        checks.push({ name: 'KV cache', ok: false, message: e instanceof Error ? e.message : 'KV failed' })
      }
    } else {
      checks.push({ name: 'KV cache', ok: false, message: 'No namespace ID set — caching disabled' })
    }

    return NextResponse.json({ ok: checks.every((c) => c.ok), checks })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
