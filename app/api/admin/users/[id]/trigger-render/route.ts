import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, logAdminAction, adminAuthError } from '@/lib/admin-auth'
import { discoverAndQueueSitemap } from '@/lib/sitemap'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Params = { params: Promise<{ id: string }> }

function ip(req: NextRequest) {
  return req.headers.get('x-forwarded-for')
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const siteId = String(body.site_id ?? '')
    const domain = String(body.domain ?? '')
    if (!siteId || !domain) return NextResponse.json({ error: 'site_id and domain required' }, { status: 400 })

    // Verify site belongs to this user.
    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id')
      .eq('id', siteId)
      .eq('user_id', id)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const result = await discoverAndQueueSitemap(siteId, id, domain)
    await logAdminAction(admin.id, 'trigger_render', 'site', siteId, { domain, queued: result.queued }, ip(req))
    return NextResponse.json(result)
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
