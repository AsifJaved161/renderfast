import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, adminAuthError } from '@/lib/admin-auth'
import { stripe, getPlanFromPriceId } from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Normalize any billing cadence to a per-month figure so the table ("$X/mo")
// and the MRR/ARR summary are correct even for annual/weekly plans.
function monthlyAmount(
  raw: number,
  recurring?: { interval?: string; interval_count?: number | null } | null
): number {
  if (!recurring) return raw
  const perInterval = raw / (recurring.interval_count || 1)
  const factor =
    recurring.interval === 'year' ? 1 / 12 : recurring.interval === 'week' ? 52 / 12 : recurring.interval === 'day' ? 365 / 12 : 1
  return Math.round(perInterval * factor * 100) / 100
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()

    const { searchParams } = req.nextUrl
    const statusFilter = searchParams.get('status') // active | canceled | past_due
    const planFilter = searchParams.get('plan')

    // Map stripe_customer_id → user email for merging.
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('email, stripe_customer_id')
      .not('stripe_customer_id', 'is', null)
    const emailByCustomer = new Map<string, string>()
    for (const u of users ?? []) {
      if (u.stripe_customer_id) emailByCustomer.set(u.stripe_customer_id, u.email)
    }

    const list = await stripe.subscriptions.list({
      status: (statusFilter as any) ?? 'all',
      limit: 100,
    })

    const subscriptions = list.data
      .map((s) => {
        const item = s.items.data[0]
        const priceId = item?.price.id
        const plan = priceId ? getPlanFromPriceId(priceId) : null
        return {
          stripe_sub_id: s.id,
          user_email: emailByCustomer.get(s.customer as string) ?? null,
          plan: plan ?? 'unknown',
          status: s.status,
          amount: monthlyAmount((item?.price.unit_amount ?? 0) / 100, item?.price.recurring),
          next_billing: s.current_period_end
            ? new Date(s.current_period_end * 1000).toISOString()
            : null,
        }
      })
      .filter((s) => (planFilter ? s.plan === planFilter : true))

    return NextResponse.json({ subscriptions })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
