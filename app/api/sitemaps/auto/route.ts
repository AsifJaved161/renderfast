import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { discoverAndQueueSitemap } from '@/lib/sitemap'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Auto-discover + queue a site's sitemap URLs. Called right after a domain is added.
export async function POST(req: NextRequest) {
  try {
    const uid = req.headers.get('x-user-id')
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const { site_id } = await req.json().catch(() => ({}))
    if (!site_id) return NextResponse.json({ error: 'site_id required' }, { status: 400 })

    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id, domain')
      .eq('id', site_id)
      .eq('user_id', uid)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const result = await discoverAndQueueSitemap(site.id, uid, site.domain)
    return NextResponse.json(result)
  } catch (e) {
    console.error('[SITEMAP_AUTO]:', e)
    return NextResponse.json({ error: 'Failed to fetch sitemap' }, { status: 500 })
  }
}
