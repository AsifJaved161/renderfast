import { NextResponse } from 'next/server'
import { stripe, getOrCreateCustomer } from '@/lib/stripe'
import { requireAuth, UnauthorizedError } from '@/lib/auth-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

export async function POST() {
  try {
    const user = await requireAuth()
    const customerId = await getOrCreateCustomer(user)

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${APP_URL}/billing`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Portal failed' },
      { status: 500 }
    )
  }
}
