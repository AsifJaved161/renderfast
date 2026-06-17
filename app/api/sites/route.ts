import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPlanLimits } from '@/lib/plan-utils'
import type { Plan } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Accepts bare domains like "example.com" or "sub.example.co.uk".
const DOMAIN_RE = /^(?!:\/\/)([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/

function userId(req: NextRequest) {
  return req.headers.get('x-user-id')
}

// ── GET /api/sites ───────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const uid = userId(req)
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const { data: sites, error } = await supabaseAdmin
      .from('sites')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('plan')
      .eq('id', uid)
      .single()

    const limit = getPlanLimits((user?.plan as Plan) ?? 'free').sites

    return NextResponse.json({
      sites: sites ?? [],
      count: sites?.length ?? 0,
      limit: limit === Infinity ? null : limit,
    })
  } catch (error) {
    console.error('[SITES_GET]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── POST /api/sites ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const uid = userId(req)
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const { domain, name, integration_type } = body
    if (!domain || !DOMAIN_RE.test(domain)) {
      return NextResponse.json({ error: 'Invalid domain format' }, { status: 400 })
    }

    // Plan site-limit check.
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('plan')
      .eq('id', uid)
      .single()
    const limit = getPlanLimits((user?.plan as Plan) ?? 'free').sites

    const { count } = await supabaseAdmin
      .from('sites')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uid)

    if ((count ?? 0) >= limit) {
      return NextResponse.json(
        { error: 'Plan site limit reached', limit },
        { status: 403 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('sites')
      .insert({
        user_id: uid,
        domain,
        name: name ?? domain,
        integration_type: integration_type ?? null,
        status: 'pending',
      })
      .select()
      .single()

    if (error) {
      // 23505 = unique violation (user already added this domain)
      const status = (error as { code?: string }).code === '23505' ? 409 : 500
      return NextResponse.json({ error: error.message }, { status })
    }

    return NextResponse.json({ site: data }, { status: 201 })
  } catch (error) {
    console.error('[SITES_POST]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
