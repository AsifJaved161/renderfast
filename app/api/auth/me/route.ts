import { NextResponse } from 'next/server'
import { createServerClient, supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { data: profile, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Self-heal: if the verified auth email differs from the profile (e.g. the
    // user just confirmed an email change), sync it onto public.users.
    if (profile && user.email && profile.email !== user.email) {
      await supabaseAdmin.from('users').update({ email: user.email }).eq('id', user.id)
      profile.email = user.email
    }

    return NextResponse.json({ user: profile })
  } catch (error) {
    console.error('[AUTH_ME_GET]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
