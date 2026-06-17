import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Plugin login: email + password → return the account's API key.
// Used by the WordPress plugin so users sign in without copying keys by hand.
export async function POST(req: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anon) {
      return NextResponse.json({ error: 'Server not configured' }, { status: 503 })
    }

    const { email, password } = (await req.json().catch(() => ({}))) as {
      email?: string
      password?: string
    }
    if (!email || !password) {
      return NextResponse.json({ error: 'email and password required' }, { status: 400 })
    }

    const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await sb.auth.signInWithPassword({ email, password })
    if (error || !data.user) {
      return NextResponse.json({ error: error?.message ?? 'Invalid email or password' }, { status: 401 })
    }

    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('api_key, email, plan, render_count, render_limit')
      .eq('id', data.user.id)
      .maybeSingle()

    if (!profile?.api_key) {
      return NextResponse.json({ error: 'No API key on this account' }, { status: 500 })
    }

    return NextResponse.json({
      api_key: profile.api_key,
      email: profile.email,
      plan: profile.plan,
      render_count: profile.render_count,
      render_limit: profile.render_limit,
    })
  } catch (e) {
    console.error('[PLUGIN_LOGIN]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
