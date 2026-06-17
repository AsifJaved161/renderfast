import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createServerClient, supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { email, password, full_name } = body as Record<string, string>

    if (!email || !password) {
      return NextResponse.json({ error: 'email and password required' }, { status: 400 })
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json({ error: 'Server not configured — contact support' }, { status: 503 })
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

    // Non-fatal: update full_name + api_key on the profile row.
    // Requires SUPABASE_SERVICE_ROLE_KEY — skip silently if unavailable.
    if (data.user) {
      try {
        await supabaseAdmin
          .from('users')
          .update({
            full_name: full_name ?? null,
            api_key: `rf_${randomUUID().replace(/-/g, '')}`,
          })
          .eq('id', data.user.id)
      } catch (e) {
        console.error('[AUTH_SIGNUP] profile update skipped:', e)
      }
    }

    return NextResponse.json({ user: data.user })
  } catch (error) {
    console.error('[AUTH_SIGNUP_POST]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
