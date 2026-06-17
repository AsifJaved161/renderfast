import Stripe from 'stripe'
import { supabaseAdmin, type DbUser, type Plan } from '@/lib/supabase'

// Lazily constructed via a Proxy so Stripe is only instantiated at runtime, never
// during `next build` page-data collection (where STRIPE_SECRET_KEY may be absent).
let _stripe: Stripe | null = null
function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2024-06-20',
    })
  }
  return _stripe
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const client = getStripe()
    const value = Reflect.get(client as object, prop)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

export const PRICE_IDS: Record<'starter' | 'pro' | 'agency', string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
  agency: process.env.STRIPE_PRICE_AGENCY,
}

// Render limits applied when a plan changes (kept in sync with constants).
export const PLAN_RENDER_LIMITS: Record<Plan, number> = {
  free: 1000,
  starter: 25000,
  pro: 200000,
  agency: 1000000,
}

// Returns an existing Stripe customer ID or creates one and persists it.
export async function getOrCreateCustomer(user: DbUser): Promise<string> {
  if (user.stripe_customer_id) return user.stripe_customer_id

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.full_name ?? undefined,
    metadata: { user_id: user.id },
  })

  await supabaseAdmin
    .from('users')
    .update({ stripe_customer_id: customer.id })
    .eq('id', user.id)

  return customer.id
}

// Maps a Stripe price ID back to our plan key.
export function getPlanFromPriceId(priceId: string): 'starter' | 'pro' | 'agency' | null {
  const entry = (Object.entries(PRICE_IDS) as ['starter' | 'pro' | 'agency', string | undefined][]).find(
    ([, id]) => id === priceId
  )
  return entry ? entry[0] : null
}
