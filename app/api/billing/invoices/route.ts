import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { requireAuth, UnauthorizedError } from '@/lib/auth-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Real invoice history + the upcoming-invoice preview, straight from Stripe.
// Replaces the old hard-coded mock list on the billing page.
export async function GET() {
  try {
    const user = await requireAuth()

    // No Stripe customer yet (never upgraded) → nothing to show.
    if (!user.stripe_customer_id) {
      return NextResponse.json({ invoices: [], upcoming: null })
    }

    const list = await stripe.invoices.list({ customer: user.stripe_customer_id, limit: 24 })
    const invoices = list.data.map((inv) => ({
      id: inv.number ?? inv.id,
      date: inv.created ? new Date(inv.created * 1000).toISOString() : null,
      amount: (inv.amount_paid || inv.amount_due || 0) / 100,
      currency: (inv.currency ?? 'usd').toUpperCase(),
      status: inv.status ?? 'unknown', // paid | open | void | draft | uncollectible
      url: inv.hosted_invoice_url ?? inv.invoice_pdf ?? null,
    }))

    // Upcoming invoice preview — only exists while a subscription is active.
    let upcoming: { amount: number; currency: string; date: string | null } | null = null
    try {
      const u = await stripe.invoices.retrieveUpcoming({ customer: user.stripe_customer_id })
      upcoming = {
        amount: (u.amount_due ?? 0) / 100,
        currency: (u.currency ?? 'usd').toUpperCase(),
        date: u.next_payment_attempt
          ? new Date(u.next_payment_attempt * 1000).toISOString()
          : u.period_end
            ? new Date(u.period_end * 1000).toISOString()
            : null,
      }
    } catch {
      /* no upcoming invoice (free plan / no active subscription) */
    }

    return NextResponse.json({ invoices, upcoming })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[BILLING_INVOICES]:', err)
    return NextResponse.json({ error: 'Could not load invoices' }, { status: 500 })
  }
}
