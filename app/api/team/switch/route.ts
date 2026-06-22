import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COOKIE = 'rf_account_id'

// ── POST /api/team/switch — switch the active account context ────────────────
// Body: { accountId }. Switching to your own id clears the context. Switching to
// another account requires an ACTIVE membership there. Sets an httpOnly cookie
// that middleware reads to resolve the effective account.
export async function POST(req: NextRequest) {
  try {
    const selfId = req.headers.get('x-self-id')
    if (!selfId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const accountId = String(body?.accountId ?? '').trim()
    if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 })

    const isSecure = (process.env.NEXT_PUBLIC_APP_URL ?? '').startsWith('https')
    const res = NextResponse.json({ ok: true, accountId })

    // Back to own account → clear the context cookie.
    if (accountId === selfId) {
      res.cookies.set(COOKIE, '', { path: '/', maxAge: 0 })
      return res
    }

    // Must be an active member of the target account.
    const { data: m } = await supabaseAdmin
      .from('team_members')
      .select('id')
      .eq('owner_user_id', accountId)
      .eq('member_user_id', selfId)
      .eq('status', 'active')
      .maybeSingle()
    if (!m) return NextResponse.json({ error: 'You are not a member of that account' }, { status: 403 })

    res.cookies.set(COOKIE, accountId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      maxAge: 60 * 60 * 24 * 30,
    })
    return res
  } catch (e) {
    console.error('[TEAM_SWITCH]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
