import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { email, password } = body as Record<string, string>

    if (!email || !password) {
      return NextResponse.json({ error: 'email and password required' }, { status: 400 })
    }

    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
    const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
    if (!url || !anon) {
      return NextResponse.json({ error: 'Server not configured — contact support' }, { status: 503 })
    }
    try {
      const u = new URL(url)
      if (u.protocol !== 'https:') throw new Error('must be https')
    } catch {
      return NextResponse.json(
        { error: 'NEXT_PUBLIC_SUPABASE_URL is invalid — check for a trailing space/newline in Vercel env vars' },
        { status: 503 }
      )
    }

    const supabase = await createServerClient()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }

    // Stamp last_login_at (best-effort — never blocks login).
    if (data.user) {
      try {
        await supabaseAdmin
          .from('users')
          .update({ last_login_at: new Date().toISOString() })
          .eq('id', data.user.id)
      } catch {
        /* ignore */
      }
    }

    // Session cookies are set automatically by the @supabase/ssr client.
    const res = NextResponse.json({ user: data.user, session: data.session })
    // Publish the signed-in user id as a JS-readable cookie so the client can
    // scope its persisted cache to this account (see lib/client-session.ts).
    if (data.user) {
      res.cookies.set('rf_uid', data.user.id, {
        httpOnly: false,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      })
    }
    return res
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('[AUTH_LOGIN_POST]:', detail)
    return NextResponse.json({ error: 'Login failed', detail }, { status: 500 })
  }
}
