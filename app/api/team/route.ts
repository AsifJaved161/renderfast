import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { sendTeamInviteEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROLES = ['admin', 'member', 'viewer'] as const
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Headers injected by middleware: x-user-id = effective (owner) account,
// x-self-id = the real logged-in user, x-account-role = role in the effective acct.
function ctx(req: NextRequest) {
  return {
    accountId: req.headers.get('x-user-id'),
    selfId: req.headers.get('x-self-id'),
    role: req.headers.get('x-account-role') ?? 'owner',
  }
}

// ── GET /api/team — members of the current account + switchable accounts + my invites
export async function GET(req: NextRequest) {
  try {
    const { accountId, selfId, role } = ctx(req)
    if (!accountId || !selfId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Members of the effective account.
    const { data: rows } = await supabaseAdmin
      .from('team_members')
      .select('id, member_user_id, invited_email, role, status, created_at')
      .eq('owner_user_id', accountId)
      .order('created_at', { ascending: true })

    const memberIds = (rows ?? []).map((r) => r.member_user_id).filter(Boolean) as string[]
    const { data: memberUsers } = memberIds.length
      ? await supabaseAdmin.from('users').select('id, email, full_name').in('id', memberIds)
      : { data: [] as { id: string; email: string; full_name: string | null }[] }
    const userById = new Map((memberUsers ?? []).map((u) => [u.id, u]))

    const members = (rows ?? []).map((r) => ({
      id: r.id,
      email: r.member_user_id ? userById.get(r.member_user_id)?.email ?? r.invited_email : r.invited_email,
      name: r.member_user_id ? userById.get(r.member_user_id)?.full_name ?? null : null,
      role: r.role,
      status: r.status,
      isYou: r.member_user_id === selfId,
    }))

    // Accounts this user can switch into: their own + active memberships.
    const { data: memberships } = await supabaseAdmin
      .from('team_members')
      .select('owner_user_id, role')
      .eq('member_user_id', selfId)
      .eq('status', 'active')
    const ownerIds = (memberships ?? []).map((m) => m.owner_user_id)
    const { data: owners } = ownerIds.length
      ? await supabaseAdmin.from('users').select('id, email, full_name').in('id', ownerIds)
      : { data: [] as { id: string; email: string; full_name: string | null }[] }
    const ownerById = new Map((owners ?? []).map((o) => [o.id, o]))

    const { data: selfU } = await supabaseAdmin.from('users').select('email, full_name').eq('id', selfId).maybeSingle()
    const accounts = [
      { id: selfId, name: selfU?.full_name || selfU?.email || 'My account', role: 'owner', isCurrent: accountId === selfId },
      ...(memberships ?? []).map((m) => ({
        id: m.owner_user_id,
        name: ownerById.get(m.owner_user_id)?.full_name || ownerById.get(m.owner_user_id)?.email || 'Account',
        role: m.role,
        isCurrent: accountId === m.owner_user_id,
      })),
    ]

    // Pending invites addressed to me (so I can accept them).
    let invitesForMe: { token: string | null; ownerName: string; role: string }[] = []
    if (selfU?.email) {
      const { data: pend } = await supabaseAdmin
        .from('team_members')
        .select('owner_user_id, role, invite_token')
        .eq('invited_email', selfU.email)
        .eq('status', 'pending')
      const pendOwnerIds = (pend ?? []).map((p) => p.owner_user_id)
      const { data: pOwners } = pendOwnerIds.length
        ? await supabaseAdmin.from('users').select('id, email, full_name').in('id', pendOwnerIds)
        : { data: [] as { id: string; email: string; full_name: string | null }[] }
      const pOwnerById = new Map((pOwners ?? []).map((o) => [o.id, o]))
      invitesForMe = (pend ?? []).map((p) => ({
        token: p.invite_token,
        ownerName: pOwnerById.get(p.owner_user_id)?.full_name || pOwnerById.get(p.owner_user_id)?.email || 'an account',
        role: p.role,
      }))
    }

    return NextResponse.json({
      accountId,
      selfId,
      role,
      isOwnAccount: accountId === selfId,
      members,
      accounts,
      invitesForMe,
    })
  } catch (e) {
    console.error('[TEAM_GET]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── POST /api/team — invite a member (owner/admin only) ──────────────────────
export async function POST(req: NextRequest) {
  try {
    const { accountId, selfId, role } = ctx(req)
    if (!accountId || !selfId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (role !== 'owner' && role !== 'admin') {
      return NextResponse.json({ error: 'Only owners/admins can invite members' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const email = String(body?.email ?? '').trim().toLowerCase()
    const newRole = String(body?.role ?? 'member')
    if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
    if (!ROLES.includes(newRole as (typeof ROLES)[number])) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    // Don't let the owner invite themselves.
    const { data: ownerU } = await supabaseAdmin.from('users').select('email, full_name').eq('id', accountId).maybeSingle()
    if (ownerU?.email && ownerU.email.toLowerCase() === email) {
      return NextResponse.json({ error: 'You already own this account' }, { status: 400 })
    }

    // Existing membership row? → update role (re-invite / role change by email).
    const { data: existing } = await supabaseAdmin
      .from('team_members')
      .select('id, status')
      .eq('owner_user_id', accountId)
      .eq('invited_email', email)
      .maybeSingle()

    if (existing) {
      await supabaseAdmin.from('team_members').update({ role: newRole }).eq('id', existing.id)
      return NextResponse.json({ ok: true, updated: true, status: existing.status })
    }

    const token = randomBytes(24).toString('hex')
    const { error } = await supabaseAdmin.from('team_members').insert({
      owner_user_id: accountId,
      invited_email: email,
      role: newRole,
      status: 'pending',
      invite_token: token,
      invited_by: selfId,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Fire-and-forget invite email (failure must not block the response).
    sendTeamInviteEmail(email, ownerU?.full_name || ownerU?.email || 'A RenderForAI user', newRole, token).catch(() => {})

    return NextResponse.json({ ok: true, invited: true }, { status: 201 })
  } catch (e) {
    console.error('[TEAM_POST]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
