import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const supabase = await createServerClient()
    // signOut clears the session cookies via the @supabase/ssr client.
    const { error } = await supabase.auth.signOut()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const res = NextResponse.json({ success: true })
    // Drop the cache-scoping cookie so no stale uid lingers after sign-out.
    res.cookies.set('rf_uid', '', { path: '/', maxAge: 0 })
    // Drop the team account-switch context so the next user signing in on this
    // browser can never inherit the previous user's effective account (and its
    // data). Without this, rf_account_id would survive logout for up to 30 days.
    res.cookies.set('rf_account_id', '', { path: '/', maxAge: 0 })
    return res
  } catch (error) {
    console.error('[AUTH_LOGOUT_POST]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
