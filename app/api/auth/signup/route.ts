import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createServerClient, supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { email, password, full_name } = await req.json().catch(() => ({}))
    if (!email || !password) {
      return NextResponse.json({ error: 'email and password required' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: full_name ?? null } },
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // The handle_new_user trigger creates the public.users row. Fill in the
    // profile details + guarantee a unique api_key (admin client bypasses RLS).
    if (data.user) {
      await supabaseAdmin
        .from('users')
        .update({
          full_name: full_name ?? null,
          api_key: `rf_${randomUUID().replace(/-/g, '')}`,
        })
        .eq('id', data.user.id)
    }

    return NextResponse.json({ user: data.user })
  } catch (error) {
    console.error('[AUTH_SIGNUP_POST]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
