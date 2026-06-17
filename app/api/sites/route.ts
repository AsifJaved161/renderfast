import { NextRequest, NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPlanLimits } from '@/lib/plan-utils'
import { discoverAndQueueSitemap } from '@/lib/sitemap'
import type { Plan } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

    let list = sites ?? []

    // Per-site insights (only when requested — keeps the common selector calls light).
    if (req.nextUrl.searchParams.get('with_stats') === '1' && list.length > 0) {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      list = await Promise.all(
        list.map(async (s) => {
          const [cached, botHits, broken] = await Promise.all([
            supabaseAdmin
              .from('cache_entries')
              .select('id', { count: 'exact', head: true })
              .eq('site_id', s.id),
            supabaseAdmin
              .from('bot_visits')
              .select('id', { count: 'exact', head: true })
              .eq('site_id', s.id)
              .gte('created_at', since),
            supabaseAdmin
              .from('broken_links')
              .select('id', { count: 'exact', head: true })
              .eq('site_id', s.id)
              .eq('resolved', false),
          ])
          return {
            ...s,
            stats: {
              renders: s.render_count ?? 0,
              cached: cached.count ?? 0,
              botHits30: botHits.count ?? 0,
              brokenLinks: broken.count ?? 0,
            },
          }
        })
      )
    }

    return NextResponse.json({
      sites: list,
      count: list.length,
      limit: limit === Infinity ? null : limit,
      plan: (user?.plan as Plan) ?? 'free',
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

    // Auto-discover the sitemap and queue its page URLs for rendering — runs
    // server-side after the response, so it can't be cancelled by client navigation.
    after(async () => {
      try {
        await discoverAndQueueSitemap(data.id, uid, data.domain)
      } catch (e) {
        console.error('[SITES_POST auto-sitemap]:', e)
      }
    })

    return NextResponse.json({ site: data }, { status: 201 })
  } catch (error) {
    console.error('[SITES_POST]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
