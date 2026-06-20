import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logAdminAction, adminAuthError } from '@/lib/admin-auth'
import { getCurrentEstimate, getRateHistory, setRate } from '@/lib/bot-cost'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET — current bandwidth rate + full history (ADMIN ONLY) ─────────────────
// Gated by requireAdmin(): the rate is never exposed to clients, not even
// read-only, through this endpoint.
export async function GET() {
  try {
    await requireAdmin()
    const [current, history] = await Promise.all([getCurrentEstimate(), getRateHistory()])
    return NextResponse.json({ current, history })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ── PATCH — change the rate (ADMIN ONLY) ─────────────────────────────────────
// Closes the current history row and opens a new one (never overwrites past
// rates). Body: { rate_per_gb_usd: number, rate_source?: string }.
export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await req.json().catch(() => ({}))

    const rate = Number(body?.rate_per_gb_usd)
    if (!Number.isFinite(rate) || rate < 0) {
      return NextResponse.json({ error: 'rate_per_gb_usd must be a number ≥ 0' }, { status: 400 })
    }
    const rateSource = typeof body?.rate_source === 'string' ? body.rate_source.trim() : undefined

    const result = await setRate(rate, admin.id, rateSource)

    await logAdminAction(
      admin.id,
      'update_bot_cost_rate',
      'platform_settings',
      'bot_cost_estimate',
      { rate_per_gb_usd: result.rate, changed: result.changed },
      req.headers.get('x-forwarded-for')
    )

    const [current, history] = await Promise.all([getCurrentEstimate(), getRateHistory()])
    return NextResponse.json({ updated: result.changed, current, history })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
