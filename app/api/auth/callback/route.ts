import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createServerClient, supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Google OAuth (and email-confirmation) callback.
export async function GET(req: NextRequest) {
  const { origin } = req.nextUrl
  try {
    const code = req.nextUrl.searchParams.get('code')

    if (!code) {
      return NextResponse.redirect(`${origin}/login?error=missing_code`)
    }

    const supabase = await createServerClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (error || !data.user) {
      const msg = encodeURIComponent(error?.message ?? 'auth_failed')
      return NextResponse.redirect(`${origin}/login?error=${msg}`)
    }

    // First login via Google → ensure a public.users row with an api_key.
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id, api_key')
      .eq('id', data.user.id)
      .single()

    if (!existing) {
      await supabaseAdmin.from('users').insert({
        id: data.user.id,
        email: data.user.email,
        full_name: data.user.user_metadata?.full_name ?? null,
        avatar_url: data.user.user_metadata?.avatar_url ?? null,
        api_key: `rf_${randomUUID().replace(/-/g, '')}`,
      })
    } else if (!existing.api_key) {
      await supabaseAdmin
        .from('users')
        .update({ api_key: `rf_${randomUUID().replace(/-/g, '')}` })
        .eq('id', data.user.id)
    }

    const res = NextResponse.redirect(`${origin}/dashboard`)
    // Publish the signed-in user id as a JS-readable cookie so the client can
    // scope its persisted cache to this account (see lib/client-session.ts).
    res.cookies.set('rf_uid', data.user.id, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })
    return res
  } catch (error) {
    console.error('[AUTH_CALLBACK_GET]:', error)
    // Redirect rather than JSON — this endpoint runs in a browser navigation.
    return NextResponse.redirect(`${origin}/login?error=callback_failed`)
  }
}
