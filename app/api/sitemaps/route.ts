import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function userId(req: NextRequest) {
  return req.headers.get('x-user-id')
}

// ── GET /api/sitemaps?site_id= ───────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const uid = userId(req)
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    let query = supabaseAdmin
      .from('sitemaps')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })

    const siteId = req.nextUrl.searchParams.get('site_id')
    if (siteId) query = query.eq('site_id', siteId)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data })
  } catch (error) {
    console.error('[SITEMAPS_GET]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── POST /api/sitemaps ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const uid = userId(req)
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const { site_id, sitemap_url } = body
    if (!site_id || !sitemap_url) {
      return NextResponse.json({ error: 'site_id and sitemap_url required' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('sitemaps')
      .insert({ user_id: uid, site_id, sitemap_url, status: 'active' })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    console.error('[SITEMAPS_POST]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── PATCH /api/sitemaps?id= — update status (pause/resume) ───────────────────
export async function PATCH(req: NextRequest) {
  try {
    const uid = userId(req)
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const body = await req.json().catch(() => ({}))
    if (!['active', 'paused', 'error'].includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('sitemaps')
      .update({ status: body.status })
      .eq('id', id)
      .eq('user_id', uid)
      .select()
      .single()

    if (error || !data) return NextResponse.json({ error: 'Sitemap not found' }, { status: 404 })
    return NextResponse.json({ data })
  } catch (error) {
    console.error('[SITEMAPS_PATCH]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── DELETE /api/sitemaps?id= ─────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const uid = userId(req)
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { error } = await supabaseAdmin
      .from('sitemaps')
      .delete()
      .eq('id', id)
      .eq('user_id', uid)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[SITEMAPS_DELETE]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
