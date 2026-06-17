import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, logAdminAction, adminAuthError } from '@/lib/admin-auth'
import { stripe, PRICE_IDS, getPlanFromPriceId, PLAN_RENDER_LIMITS } from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ subId: string }> }

// PATCH — change plan, cancel, or refund last invoice.
// Body: { action: 'change_plan' | 'cancel' | 'refund', plan?: 'starter'|'pro'|'agency' }
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    const { action, plan } = await req.json().catch(() => ({}))
    const { subId } = await params
    const ip = req.headers.get('x-forwarded-for')

    if (action === 'change_plan') {
      const priceId = plan ? PRICE_IDS[plan as 'starter' | 'pro' | 'agency'] : undefined
      if (!priceId) return NextResponse.json({ error: 'Invalid plan / price not configured' }, { status: 400 })

      const sub = await stripe.subscriptions.retrieve(subId)
      const updated = await stripe.subscriptions.update(subId, {
        items: [{ id: sub.items.data[0].id, price: priceId }],
        proration_behavior: 'create_prorations',
      })

      const newPlan = getPlanFromPriceId(priceId)
      if (newPlan) {
        await supabaseAdmin
          .from('users')
          .update({ plan: newPlan, render_limit: PLAN_RENDER_LIMITS[newPlan] })
          .eq('stripe_subscription_id', subId)
      }

      await logAdminAction(admin.id, 'change_subscription_plan', 'subscription', subId, { plan: newPlan }, ip)
      return NextResponse.json({ subscription: updated })
    }

    if (action === 'cancel') {
      const canceled = await stripe.subscriptions.cancel(subId)
      await supabaseAdmin
        .from('users')
        .update({ plan: 'free', render_limit: PLAN_RENDER_LIMITS.free, stripe_subscription_id: null })
        .eq('stripe_subscription_id', subId)
      await logAdminAction(admin.id, 'cancel_subscription', 'subscription', subId, undefined, ip)
      return NextResponse.json({ subscription: canceled })
    }

    if (action === 'refund') {
      const sub = await stripe.subscriptions.retrieve(subId, { expand: ['latest_invoice'] })
      const invoice = sub.latest_invoice as { payment_intent?: string } | null
      if (!invoice?.payment_intent) {
        return NextResponse.json({ error: 'No charge to refund' }, { status: 400 })
      }
      const refund = await stripe.refunds.create({ payment_intent: invoice.payment_intent })
      await logAdminAction(admin.id, 'refund_subscription', 'subscription', subId, { refund_id: refund.id }, ip)
      return NextResponse.json({ refund })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}
