import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Account + site status by API key. Used by the WordPress plugin dashboard.
export async function GET(req: NextRequest) {
  try {
    const key = req.headers.get('x-api-key')
    if (!key) {
      return NextResponse.json({ error: 'x-api-key required' }, { status: 401 })
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email, plan, render_count, render_limit')
      .eq('api_key', key)
      .maybeSingle()

    if (!user) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
    }

    const domain = req.nextUrl.searchParams.get('domain')
    let site = null
    if (domain) {
      const { data } = await supabaseAdmin
        .from('sites')
        .select('id, domain, name, status, integration_type, render_count')
        .eq('user_id', user.id)
        .eq('domain', domain)
        .maybeSingle()
      site = data
    }

    return NextResponse.json({
      connected: true,
      user: {
        email: user.email,
        plan: user.plan,
        render_count: user.render_count,
        render_limit: user.render_limit,
      },
      site,
    })
  } catch (e) {
    console.error('[PLUGIN_STATUS]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
