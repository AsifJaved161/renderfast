import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getBotCostSummary } from '@/lib/bot-cost'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Supported ranges → number of days back (inclusive of today). Default 30d.
const RANGE_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }
const DEFAULT_RANGE = '30d'

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ── GET /api/bot-cost/:siteId?range=30d ──────────────────────────────────────
// Per-bot bandwidth + estimated-cost summary for a site. Owner-gated. The rate
// is returned read-only (for the client-facing "estimated cost avoided"
// disclaimer); only RenderFast admins can CHANGE it (see /api/admin/bot-cost).
export async function GET(req: NextRequest, ctx: { params: Promise<{ siteId: string }> }) {
  try {
    const uid = req.headers.get('x-user-id')
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const { siteId } = await ctx.params

    // Ownership check — identical pattern to /api/diagnostics/:siteId. uid comes
    // from the verified session via middleware, never from the client.
    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id, domain')
      .eq('id', siteId)
      .eq('user_id', uid)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    // Resolve the range param (7d / 30d / 90d), defaulting to 30d.
    const rangeKey = req.nextUrl.searchParams.get('range') ?? DEFAULT_RANGE
    const days = RANGE_DAYS[rangeKey] ?? RANGE_DAYS[DEFAULT_RANGE]
    const to = new Date()
    const from = new Date(to)
    from.setUTCDate(from.getUTCDate() - (days - 1)) // inclusive window

    const summary = await getBotCostSummary(siteId, { from: isoDay(from), to: isoDay(to) })

    return NextResponse.json({
      domain: site.domain,
      rangeKey: rangeKey in RANGE_DAYS ? rangeKey : DEFAULT_RANGE,
      ...summary, // includes range:{from,to}, perBot, totals, timeSeries, ratesUsed, rateSource, isEstimate
    })
  } catch (e) {
    console.error('[BOT_COST_GET]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
