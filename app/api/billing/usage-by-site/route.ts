import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, UnauthorizedError } from '@/lib/auth-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Per-site render breakdown behind the single "X of Y renders used" figure.
// render_count is a lifetime total (it is never auto-reset), so this uses each
// site's lifetime render_count to stay consistent with the account-level total.
export async function GET() {
  try {
    const user = await requireAuth()

    const { data: sites } = await supabaseAdmin
      .from('sites')
      .select('id, domain, name, render_count')
      .eq('user_id', user.id)

    const rows = (sites ?? []).map((s) => ({
      siteId: s.id,
      domain: s.domain,
      name: s.name,
      renders: s.render_count ?? 0,
    }))

    rows.sort((a, b) => b.renders - a.renders)
    const total = rows.reduce((sum, r) => sum + r.renders, 0)

    return NextResponse.json({ total, sites: rows })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[USAGE_BY_SITE]:', err)
    return NextResponse.json({ error: 'Could not load usage' }, { status: 500 })
  }
}
