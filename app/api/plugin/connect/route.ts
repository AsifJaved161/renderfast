import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPlanLimits } from '@/lib/plan-utils'
import type { Plan } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DOMAIN_RE = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/

// Register (or look up) the plugin's site for this account, by API key.
export async function POST(req: NextRequest) {
  try {
    const key = req.headers.get('x-api-key')
    if (!key) {
      return NextResponse.json({ error: 'x-api-key required' }, { status: 401 })
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, plan')
      .eq('api_key', key)
      .maybeSingle()
    if (!user) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as { domain?: string; name?: string }
    const domain = (body.domain ?? '').trim().toLowerCase().replace(/^www\./, '')
    if (!domain || !DOMAIN_RE.test(domain)) {
      return NextResponse.json({ error: 'Invalid domain' }, { status: 400 })
    }

    // Already registered → mark as a WordPress integration and activate.
    const { data: existing } = await supabaseAdmin
      .from('sites')
      .select('*')
      .eq('user_id', user.id)
      .eq('domain', domain)
      .maybeSingle()

    if (existing) {
      const { data: updated } = await supabaseAdmin
        .from('sites')
        .update({ integration_type: 'wordpress', status: 'active', updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single()
      return NextResponse.json({ site: updated ?? existing })
    }

    // Plan site-limit check.
    const limit = getPlanLimits((user.plan as Plan) ?? 'free').sites
    const { count } = await supabaseAdmin
      .from('sites')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
    if ((count ?? 0) >= limit) {
      return NextResponse.json({ error: 'Plan site limit reached', limit }, { status: 403 })
    }

    const { data: site, error } = await supabaseAdmin
      .from('sites')
      .insert({
        user_id: user.id,
        domain,
        name: body.name || domain,
        integration_type: 'wordpress',
        status: 'active',
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ site }, { status: 201 })
  } catch (e) {
    console.error('[PLUGIN_CONNECT]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
