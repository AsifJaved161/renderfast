import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROLES = ['admin', 'member', 'viewer'] as const
type Params = { params: Promise<{ id: string }> }

function ctx(req: NextRequest) {
  return {
    accountId: req.headers.get('x-user-id'),
    role: req.headers.get('x-account-role') ?? 'owner',
  }
}

// Both operations require owner/admin and only affect rows of the CURRENT account.
async function guard(req: NextRequest, id: string) {
  const { accountId, role } = ctx(req)
  if (!accountId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (role !== 'owner' && role !== 'admin') {
    return { error: NextResponse.json({ error: 'Only owners/admins can manage the team' }, { status: 403 }) }
  }
  // Ownership: the membership row must belong to this account (no cross-account edits).
  const { data: row } = await supabaseAdmin
    .from('team_members')
    .select('id')
    .eq('id', id)
    .eq('owner_user_id', accountId)
    .maybeSingle()
  if (!row) return { error: NextResponse.json({ error: 'Member not found' }, { status: 404 }) }
  return { error: null }
}

// ── DELETE /api/team/:id — remove a member / cancel an invite ────────────────
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const g = await guard(req, id)
    if (g.error) return g.error
    await supabaseAdmin.from('team_members').delete().eq('id', id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[TEAM_DELETE]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── PATCH /api/team/:id — change a member's role ─────────────────────────────
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const g = await guard(req, id)
    if (g.error) return g.error
    const body = await req.json().catch(() => ({}))
    const role = String(body?.role ?? '')
    if (!ROLES.includes(role as (typeof ROLES)[number])) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }
    await supabaseAdmin.from('team_members').update({ role }).eq('id', id)
    return NextResponse.json({ ok: true, role })
  } catch (e) {
    console.error('[TEAM_PATCH]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
