import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({
      error: 'Missing Supabase environment variables in the running server process.',
      supabaseUrl: supabaseUrl ? 'configured' : 'missing',
      serviceRoleKey: serviceRoleKey ? 'configured' : 'missing',
      anonKey: anonKey ? 'configured' : 'missing',
      note: 'Please ensure these variables are defined in your .env.local file or your shell environment before starting the dev server.'
    }, { status: 500 })
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Create the user in auth.users via Supabase Admin API
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: 'demo@gmail.com',
      password: 'AsifJaved',
      email_confirm: true,
      user_metadata: { full_name: 'Demo user' }
    })

    if (authError) {
      if (authError.message.includes('already exists') || authError.status === 422) {
        return NextResponse.json({
          status: 'success_already_exists',
          message: 'User already exists in auth.users. You can log in with demo@gmail.com / AsifJaved.',
          details: authError.message
        })
      }
      return NextResponse.json({ error: 'Auth signup error: ' + authError.message }, { status: 400 })
    }

    const user = authData.user
    if (!user) {
      return NextResponse.json({ error: 'Failed to retrieve created user data.' }, { status: 500 })
    }

    // Insert or update public.users row with admin rights
    const { data: userData, error: userError } = await supabase
      .from('users')
      .upsert({
        id: user.id,
        email: user.email!,
        full_name: 'Demo user',
        plan: 'free',
        is_admin: true,
      })
      .select()
      .single()

    return NextResponse.json({
      status: 'success',
      message: 'Demo user successfully inserted!',
      auth_user_id: user.id,
      public_user: userData || 'Trigger inserted it, or skipped upsert check',
      user_error: userError ? userError.message : null,
      login_details: {
        email: 'demo@gmail.com',
        password: 'AsifJaved'
      }
    })
  } catch (err: any) {
    return NextResponse.json({
      error: 'Unexpected error during user insertion',
      details: err.message || err
    }, { status: 500 })
  }
}
