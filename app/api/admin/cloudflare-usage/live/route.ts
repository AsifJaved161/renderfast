import { NextResponse } from 'next/server'
import { requireAdmin, adminAuthError } from '@/lib/admin-auth'
import { getCloudflareConfig } from '@/lib/app-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 20

// Authoritative Workers-KV usage straight from Cloudflare's GraphQL Analytics API
// (storage bytes/keys + today's read/write/delete ops). OPT-IN: the admin page
// only calls this on a button press, never on load — so the normal page is
// unaffected. ALWAYS returns 200 with { ok: false, error } on any problem
// (missing config, no Analytics permission on the token, CF down, bad query) so
// the UI can gracefully keep showing the DB estimate. Read-only; no writes.
const GQL = `query KvUsage($acc: String!, $ns: String!, $since: Time!, $sinceDay: Time!) {
  viewer {
    accounts(filter: { accountTag: $acc }) {
      storage: kvStorageAdaptiveGroups(limit: 1, filter: { namespaceId: $ns, datetime_geq: $since }) {
        max { keyCount byteCount }
      }
      ops: kvOperationsAdaptiveGroups(limit: 100, filter: { namespaceId: $ns, datetime_geq: $sinceDay }) {
        sum { requests }
        dimensions { actionType }
      }
    }
  }
}`

export async function GET() {
  try {
    await requireAdmin()

    const cf = await getCloudflareConfig()
    if (!cf.apiToken || !cf.accountId) {
      return NextResponse.json({ ok: false, error: 'Cloudflare account ID / API token not configured.' })
    }
    if (!cf.kvNamespaceId) {
      return NextResponse.json({ ok: false, error: 'No KV namespace configured — nothing to query.' })
    }

    const now = new Date()
    const since = new Date(now.getTime() - 24 * 3600_000).toISOString() // storage: last 24h sample
    const sinceDay = new Date(now.toISOString().slice(0, 10)).toISOString() // ops: since start of today (UTC)

    let res: Response
    try {
      res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cf.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: GQL,
          variables: { acc: cf.accountId, ns: cf.kvNamespaceId, since, sinceDay },
        }),
        signal: AbortSignal.timeout(12_000),
      })
    } catch {
      return NextResponse.json({ ok: false, error: 'Cloudflare API unreachable (timeout / network).' })
    }

    const json: any = await res.json().catch(() => null)
    if (!res.ok || !json || json.errors?.length) {
      const msg = json?.errors?.[0]?.message ?? `HTTP ${res.status}`
      // Most common cause: the API token lacks the "Account Analytics: Read" permission.
      return NextResponse.json({
        ok: false,
        error: `Cloudflare analytics unavailable: ${msg}. Ensure the API token has "Account Analytics: Read".`,
      })
    }

    const acct = json?.data?.viewer?.accounts?.[0]
    const storage = acct?.storage?.[0]?.max
    const ops: { sum?: { requests?: number }; dimensions?: { actionType?: string } }[] = acct?.ops ?? []
    const opCount = (type: string) =>
      ops.filter((o) => o.dimensions?.actionType === type).reduce((s, o) => s + (o.sum?.requests ?? 0), 0)

    return NextResponse.json({
      ok: true,
      fetchedAt: now.toISOString(),
      kv: {
        bytes: typeof storage?.byteCount === 'number' ? storage.byteCount : null,
        keys: typeof storage?.keyCount === 'number' ? storage.keyCount : null,
        readsToday: opCount('read'),
        writesToday: opCount('write'),
        deletesToday: opCount('delete'),
      },
    })
  } catch (err) {
    // requireAdmin() failures → 401/403; anything else degrades to ok:false.
    return adminAuthError(err) ?? NextResponse.json({ ok: false, error: 'Server error' })
  }
}
