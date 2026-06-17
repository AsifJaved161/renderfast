import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe, getPlanFromPriceId, PLAN_RENDER_LIMITS } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase'
import { sendUsageLimitEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature')
  if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  const raw = await req.text()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(raw, sig, WEBHOOK_SECRET)
  } catch (err) {
    return NextResponse.json(
      { error: `Signature verification failed: ${err instanceof Error ? err.message : ''}` },
      { status: 400 }
    )
  }

  // Process asynchronously; acknowledge to Stripe immediately.
  handleEvent(event).catch((e) => console.error('webhook handler error', e))
  return NextResponse.json({ received: true })
}

async function handleEvent(event: Stripe.Event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.object as unknown as Stripe.Checkout.Session
      const userId = session.metadata?.user_id
      const plan = session.metadata?.plan as 'starter' | 'pro' | 'agency' | undefined
      if (userId && plan) {
        await supabaseAdmin
          .from('users')
          .update({
            plan,
            render_limit: PLAN_RENDER_LIMITS[plan],
            stripe_subscription_id: (session.subscription as string) ?? null,
          })
          .eq('id', userId)
      }
      break
    }

    case 'customer.subscription.updated': {
      const sub = event.object as unknown as Stripe.Subscription
      const priceId = sub.items.data[0]?.price.id
      const plan = priceId ? getPlanFromPriceId(priceId) : null
      if (plan) {
        await supabaseAdmin
          .from('users')
          .update({ plan, render_limit: PLAN_RENDER_LIMITS[plan] })
          .eq('stripe_subscription_id', sub.id)
      }
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.object as unknown as Stripe.Subscription
      await supabaseAdmin
        .from('users')
        .update({
          plan: 'free',
          render_limit: PLAN_RENDER_LIMITS.free,
          stripe_subscription_id: null,
        })
        .eq('stripe_subscription_id', sub.id)
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.object as unknown as Stripe.Invoice
      const customerId = invoice.customer as string
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('email')
        .eq('stripe_customer_id', customerId)
        .single()
      if (user?.email) {
        await sendUsageLimitEmail(user.email, { reason: 'Your latest payment failed.' })
      }
      break
    }

    default:
      // ignore unhandled event types
      break
  }
}
