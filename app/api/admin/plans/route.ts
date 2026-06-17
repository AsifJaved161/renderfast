import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, logAdminAction, adminAuthError } from '@/lib/admin-auth'
import { stripe } from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET — list plans ─────────────────────────────────────────────────────────
export async function GET() {
  try {
    await requireAdmin()
    const { data, error } = await supabaseAdmin
      .from('plans')
      .select('*')
      .order('sort_order', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ plans: data ?? [] })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ── POST — create plan ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const body = await req.json().catch(() => ({}))
    const { name, slug, price_monthly, render_limit, site_limit, cache_size_gb, features, stripe_price_id, sort_order } = body

    if (!name || !slug) return NextResponse.json({ error: 'name and slug required' }, { status: 400 })
    if (typeof price_monthly !== 'number' || price_monthly < 0) {
      return NextResponse.json({ error: 'price_monthly must be >= 0' }, { status: 400 })
    }
    if (typeof render_limit !== 'number' || render_limit <= 0) {
      return NextResponse.json({ error: 'render_limit must be > 0' }, { status: 400 })
    }

    // Unique slug check.
    const { data: existing } = await supabaseAdmin.from('plans').select('id').eq('slug', slug).single()
    if (existing) return NextResponse.json({ error: 'slug already exists' }, { status: 409 })

    // Verify Stripe price if supplied.
    if (stripe_price_id) {
      try {
        await stripe.prices.retrieve(stripe_price_id)
      } catch {
        return NextResponse.json({ error: 'stripe_price_id not found in Stripe' }, { status: 400 })
      }
    }

    const { data, error } = await supabaseAdmin
      .from('plans')
      .insert({
        name,
        slug,
        price_monthly,
        render_limit,
        site_limit: site_limit ?? 1,
        cache_size_gb: cache_size_gb ?? 0,
        features: features ?? null,
        stripe_price_id: stripe_price_id ?? null,
        sort_order: sort_order ?? 0,
      })
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await logAdminAction(admin.id, 'create_plan', 'plan', data.id, { slug }, req.headers.get('x-forwarded-for'))
    return NextResponse.json({ plan: data }, { status: 201 })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
