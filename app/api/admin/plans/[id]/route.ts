import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, logAdminAction, adminAuthError } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const UPDATABLE = ['name', 'price_monthly', 'render_limit', 'site_limit', 'is_active', 'features', 'stripe_price_id'] as const

// ── GET — single plan ────────────────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin()
    const { id } = await params
    const { data, error } = await supabaseAdmin.from('plans').select('*').eq('id', id).single()
    if (error || !data) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    return NextResponse.json({ plan: data })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ── PATCH — update plan ──────────────────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const body = await req.json().catch(() => ({}))

    const { data: before } = await supabaseAdmin
      .from('plans')
      .select('*')
      .eq('id', id)
      .single()
    if (!before) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const updates: Record<string, unknown> = {}
    for (const key of UPDATABLE) {
      if (key in body) updates[key] = body[key]
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
    }
    updates.updated_at = new Date().toISOString()

    const { data, error } = await supabaseAdmin
      .from('plans')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Optionally propagate a new render_limit to all users on this plan.
    let usersUpdated = 0
    if (typeof body.render_limit === 'number' && body.apply_to_users) {
      const { count } = await supabaseAdmin
        .from('users')
        .update({ render_limit: body.render_limit }, { count: 'exact' })
        .eq('plan', before.slug)
      usersUpdated = count ?? 0
    }

    await logAdminAction(
      admin.id,
      'update_plan',
      'plan',
      id,
      { changed: Object.keys(updates), usersUpdated },
      req.headers.get('x-forwarded-for')
    )

    return NextResponse.json({ plan: data, usersUpdated })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ── DELETE — deactivate (only if no users on it) ─────────────────────────────
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    const { id } = await params

    const { data: plan } = await supabaseAdmin.from('plans').select('slug').eq('id', id).single()
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const { count } = await supabaseAdmin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('plan', plan.slug)
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: `Cannot delete — ${count} users are on this plan`, users: count },
        { status: 409 }
      )
    }

    await supabaseAdmin.from('plans').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id)
    await logAdminAction(admin.id, 'deactivate_plan', 'plan', id, undefined, req.headers.get('x-forwarded-for'))

    return NextResponse.json({ success: true })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
