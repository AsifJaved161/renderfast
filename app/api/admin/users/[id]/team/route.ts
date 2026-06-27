import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, adminAuthError } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }
const ROLES = ['admin', 'member', 'viewer'] as const

// ── GET — list this user's team members ─────────────────────────────────────
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin()
    const { id } = await params

    const { data: rows } = await supabaseAdmin
      .from('team_members')
      .select('id, member_user_id, invited_email, role, status, created_at')
      .eq('owner_user_id', id)
      .order('created_at', { ascending: true })

    const memberIds = (rows ?? []).map((r) => r.member_user_id).filter(Boolean) as string[]
    const { data: memberUsers } = memberIds.length
      ? await supabaseAdmin.from('users').select('id, email, full_name').in('id', memberIds)
      : { data: [] as { id: string; email: string; full_name: string | null }[] }
    const userById = new Map((memberUsers ?? []).map((u) => [u.id, u]))

    const members = (rows ?? []).map((r) => ({
      id: r.id,
      email: r.member_user_id ? (userById.get(r.member_user_id)?.email ?? r.invited_email) : r.invited_email,
      name: r.member_user_id ? (userById.get(r.member_user_id)?.full_name ?? null) : null,
      role: r.role,
      status: r.status,
    }))

    return NextResponse.json({ members })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ── PATCH — change a member's role ──────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin()
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const memberId = String(body.member_id ?? '')
    const role = String(body.role ?? '')
    if (!memberId) return NextResponse.json({ error: 'member_id required' }, { status: 400 })
    if (!ROLES.includes(role as (typeof ROLES)[number])) {
      return NextResponse.json({ error: 'role must be admin | member | viewer' }, { status: 400 })
    }

    const { data: row } = await supabaseAdmin
      .from('team_members')
      .select('id')
      .eq('id', memberId)
      .eq('owner_user_id', id)
      .maybeSingle()
    if (!row) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    await supabaseAdmin.from('team_members').update({ role }).eq('id', memberId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ── DELETE — remove a team member / cancel invite ────────────────────────────
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin()
    const { id } = await params
    const memberId = new URL(req.url).searchParams.get('member_id') ?? ''
    if (!memberId) return NextResponse.json({ error: 'member_id required' }, { status: 400 })

    const { data: row } = await supabaseAdmin
      .from('team_members')
      .select('id')
      .eq('id', memberId)
      .eq('owner_user_id', id)
      .maybeSingle()
    if (!row) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    await supabaseAdmin.from('team_members').delete().eq('id', memberId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
