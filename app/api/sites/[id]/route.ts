import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { clearDomainCache } from '@/lib/kv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function userId(req: NextRequest) {
  return req.headers.get('x-user-id')
}

type Params = { params: Promise<{ id: string }> }

// ── GET /api/sites/[id] — details + 30-day render stats ──────────────────────
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const uid = userId(req)
  if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

  const { data: site, error } = await supabaseAdmin
    .from('sites')
    .select('*')
    .eq('id', id)
    .eq('user_id', uid)
    .single()

  if (error || !site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { count: rendersLast30Days } = await supabaseAdmin
    .from('renders')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', id)
    .gte('created_at', since)

  return NextResponse.json({
    site,
    stats: { rendersLast30Days: rendersLast30Days ?? 0 },
  })
}

// ── PATCH /api/sites/[id] — update name / integration_type / status ──────────
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const uid = userId(req)
  if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const updates: Record<string, unknown> = {}

  if ('name' in body) updates.name = body.name
  if ('integration_type' in body) {
    const allowed = ['script', 'middleware', 'worker', 'nginx', 'dns', 'wordpress', null]
    if (!allowed.includes(body.integration_type)) {
      return NextResponse.json({ error: 'Invalid integration_type' }, { status: 400 })
    }
    updates.integration_type = body.integration_type
  }
  if ('status' in body) {
    if (!['active', 'inactive', 'pending'].includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    updates.status = body.status
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }
  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .from('sites')
    .update(updates)
    .eq('id', id)
    .eq('user_id', uid)
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }
  return NextResponse.json({ site: data })
}

// ── DELETE /api/sites/[id] — cascade DB rows + clear KV cache ────────────────
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const uid = userId(req)
  if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

  const { data: site } = await supabaseAdmin
    .from('sites')
    .select('id, domain')
    .eq('id', id)
    .eq('user_id', uid)
    .single()

  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  // Clear the edge cache for this domain.
  let cleared = 0
  try {
    cleared = await clearDomainCache(site.domain)
  } catch {
    // continue with DB deletion even if cache clear fails
  }

  // Explicitly remove child rows (in case FK cascade isn't configured) then the site.
  await supabaseAdmin.from('cache_entries').delete().eq('site_id', id)
  await supabaseAdmin.from('renders').delete().eq('site_id', id)
  await supabaseAdmin.from('bot_visits').delete().eq('site_id', id)
  await supabaseAdmin.from('sites').delete().eq('id', id).eq('user_id', uid)

  return NextResponse.json({ success: true, cacheCleared: cleared })
}
