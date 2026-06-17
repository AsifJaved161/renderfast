import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, logAdminAction, ForbiddenError } from '@/lib/admin-auth'
import { UnauthorizedError } from '@/lib/auth-helpers'
import { stripe, PLAN_RENDER_LIMITS } from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

function authError(err: unknown) {
  if (err instanceof UnauthorizedError) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (err instanceof ForbiddenError) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

function ip(req: NextRequest) {
  return req.headers.get('x-forwarded-for')
}

// ── GET — full user profile ──────────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin()
    const { id } = await params

    const { data: user } = await supabaseAdmin.from('users').select('*').eq('id', id).single()
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const [{ data: sites }, { data: renders }] = await Promise.all([
      supabaseAdmin.from('sites').select('*').eq('user_id', id),
      supabaseAdmin
        .from('renders')
        .select('*')
        .eq('user_id', id)
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    let billing: unknown = null
    if (user.stripe_customer_id) {
      try {
        billing = await stripe.customers.retrieve(user.stripe_customer_id)
      } catch {
        billing = null
      }
    }

    return NextResponse.json({
      user,
      sites: sites ?? [],
      renders: renders ?? [],
      billing,
      notes: user.notes ?? null,
    })
  } catch (err) {
    return authError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ── PATCH — admin edits user ──────────────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const body = await req.json().catch(() => ({}))

    const { data: before } = await supabaseAdmin
      .from('users')
      .select('plan, is_banned, render_limit, render_count, notes')
      .eq('id', id)
      .single()
    if (!before) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const updates: Record<string, unknown> = {}

    if (body.plan && ['free', 'starter', 'pro', 'agency'].includes(body.plan)) {
      updates.plan = body.plan
      updates.render_limit = PLAN_RENDER_LIMITS[body.plan as keyof typeof PLAN_RENDER_LIMITS]
      await logAdminAction(admin.id, 'change_plan', 'user', id, { from: before.plan, to: body.plan }, ip(req))
    }
    if (typeof body.is_banned === 'boolean') {
      updates.is_banned = body.is_banned
      updates.ban_reason = body.is_banned ? body.ban_reason ?? null : null
      updates.banned_at = body.is_banned ? new Date().toISOString() : null
      await logAdminAction(admin.id, body.is_banned ? 'ban_user' : 'unban_user', 'user', id, { reason: body.ban_reason ?? null }, ip(req))
    }
    if (typeof body.render_limit === 'number') {
      updates.render_limit = body.render_limit
      await logAdminAction(admin.id, 'override_render_limit', 'user', id, { from: before.render_limit, to: body.render_limit }, ip(req))
    }
    if (typeof body.render_count === 'number') {
      updates.render_count = body.render_count
      await logAdminAction(admin.id, 'reset_render_count', 'user', id, { from: before.render_count, to: body.render_count }, ip(req))
    }
    if (typeof body.notes === 'string') {
      updates.notes = body.notes
      await logAdminAction(admin.id, 'update_notes', 'user', id, undefined, ip(req))
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
    }
    updates.updated_at = new Date().toISOString()

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ user: data })
  } catch (err) {
    return authError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ── DELETE — remove user account ──────────────────────────────────────────────
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    const { id } = await params

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('stripe_subscription_id')
      .eq('id', id)
      .single()
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Cancel Stripe subscription if present.
    if (user.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(user.stripe_subscription_id)
      } catch {
        // already cancelled / missing — continue
      }
    }

    // Remove owned data explicitly (in case FK cascade isn't set everywhere).
    await supabaseAdmin.from('cache_entries').delete().eq('user_id', id)
    await supabaseAdmin.from('renders').delete().eq('user_id', id)
    await supabaseAdmin.from('sites').delete().eq('user_id', id)

    // Deleting the auth user cascades to public.users via FK.
    await supabaseAdmin.auth.admin.deleteUser(id)

    await logAdminAction(admin.id, 'delete_user', 'user', id, undefined, ip(req))

    return NextResponse.json({ success: true })
  } catch (err) {
    return authError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
