import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/team/accept — accept a pending invite by token ─────────────────
// The accepting user must be logged in AND their email must match the invite.
export async function POST(req: NextRequest) {
  try {
    const selfId = req.headers.get('x-self-id')
    if (!selfId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const token = String(body?.token ?? '').trim()
    if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

    const { data: invite } = await supabaseAdmin
      .from('team_members')
      .select('id, invited_email, status')
      .eq('invite_token', token)
      .maybeSingle()
    if (!invite || invite.status !== 'pending') {
      return NextResponse.json({ error: 'Invite not found or already used' }, { status: 404 })
    }

    // The logged-in user's email must match the address the invite was sent to.
    const { data: self } = await supabaseAdmin.from('users').select('email').eq('id', selfId).maybeSingle()
    if (!self?.email || self.email.toLowerCase() !== invite.invited_email.toLowerCase()) {
      return NextResponse.json({ error: 'This invite was sent to a different email address' }, { status: 403 })
    }

    await supabaseAdmin
      .from('team_members')
      .update({
        member_user_id: selfId,
        status: 'active',
        accepted_at: new Date().toISOString(),
        invite_token: null,
      })
      .eq('id', invite.id)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[TEAM_ACCEPT]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
