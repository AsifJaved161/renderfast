import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  isGscConfigured,
  getValidAccessToken,
  listProperties,
  matchProperty,
  fetchMetrics,
} from '@/lib/gsc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// ── GET /api/gsc/metrics?site_id= — 28-day Search Console summary ─────────────
export async function GET(req: NextRequest) {
  try {
    const uid = req.headers.get('x-user-id')
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    if (!isGscConfigured()) {
      return NextResponse.json({ error: 'GSC not configured' }, { status: 503 })
    }

    const siteId = req.nextUrl.searchParams.get('site_id')
    if (!siteId) return NextResponse.json({ error: 'site_id required' }, { status: 400 })

    // Ownership — resolve the site's domain only if the user owns it.
    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('domain')
      .eq('id', siteId)
      .eq('user_id', uid)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const accessToken = await getValidAccessToken(uid)
    if (!accessToken) return NextResponse.json({ connected: false }, { status: 200 })

    // Find the GSC property that matches this domain.
    const properties = await listProperties(accessToken)
    const property = matchProperty(properties, site.domain)
    if (!property) {
      return NextResponse.json({
        connected: true,
        property: null,
        message: `No verified Search Console property found for ${site.domain}. Verify it in Google Search Console first.`,
      })
    }

    const metrics = await fetchMetrics(accessToken, property)
    return NextResponse.json({ connected: true, ...metrics })
  } catch (e) {
    console.error('[GSC_METRICS]:', e)
    return NextResponse.json({ error: 'Failed to load Search Console data' }, { status: 500 })
  }
}
