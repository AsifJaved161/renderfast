import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function userId(req: NextRequest) {
  return req.headers.get('x-user-id')
}

// ── GET /api/queue?status=&site_id=&page=&limit= ─────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const uid = userId(req)
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const { searchParams } = req.nextUrl
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '20', 10))
    const status = searchParams.get('status')
    const siteId = searchParams.get('site_id')

    // ?summary=true → return per-status counts for the stats bar.
    if (searchParams.get('summary') === 'true') {
      const statuses = ['pending', 'rendering', 'completed', 'failed'] as const
      const counts: Record<string, number> = {}
      await Promise.all(
        statuses.map(async (s) => {
          let q = supabaseAdmin
            .from('caching_queue')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', uid)
            .eq('status', s)
          if (siteId) q = q.eq('site_id', siteId)
          const { count } = await q
          counts[s] = count ?? 0
        })
      )
      return NextResponse.json({ summary: counts })
    }

    let query = supabaseAdmin
      .from('caching_queue')
      .select('*', { count: 'exact' })
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (status) query = query.eq('status', status)
    if (siteId) query = query.eq('site_id', siteId)

    const { data, count, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data, page, limit, total: count ?? 0 })
  } catch (error) {
    console.error('[QUEUE_GET]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── POST /api/queue — add an array of URLs ───────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const uid = userId(req)
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const { site_id, urls, priority } = body
    if (!site_id || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'site_id and urls[] required' }, { status: 400 })
    }

    const rows = urls.map((url: string) => ({
      site_id,
      user_id: uid,
      url,
      status: 'pending' as const,
      priority: priority ?? 5,
    }))

    const { data, error } = await supabaseAdmin.from('caching_queue').insert(rows).select()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ added: data.length, data }, { status: 201 })
  } catch (error) {
    console.error('[QUEUE_POST]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── PATCH /api/queue?id= — retry (reset to pending) ──────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const uid = userId(req)
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from('caching_queue')
      .update({ status: 'pending', error_message: null, completed_at: null })
      .eq('id', id)
      .eq('user_id', uid)
      .select()
      .single()

    if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data })
  } catch (error) {
    console.error('[QUEUE_PATCH]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── DELETE /api/queue?id= ────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const uid = userId(req)
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { error } = await supabaseAdmin
      .from('caching_queue')
      .delete()
      .eq('id', id)
      .eq('user_id', uid)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[QUEUE_DELETE]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
