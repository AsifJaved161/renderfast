import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth, UnauthorizedError } from '@/lib/auth-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY = 86400_000

// Per-site render counts for the current billing window — the breakdown behind
// the single "X of Y renders used this month" figure. The window mirrors the
// usage counter: it resets at monthly_reset_at (which the cron sets +30 days),
// so the window started ~30 days before that. Falls back to the calendar month.
export async function GET() {
  try {
    const user = await requireAuth()

    const since = user.monthly_reset_at
      ? new Date(new Date(user.monthly_reset_at).getTime() - 30 * DAY)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const sinceIso = since.toISOString()

    const { data: sites } = await supabaseAdmin
      .from('sites')
      .select('id, domain, name')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })

    // One cheap COUNT per site (site counts are small per plan) — in parallel.
    const rows = await Promise.all(
      (sites ?? []).map(async (s) => {
        const { count } = await supabaseAdmin
          .from('renders')
          .select('id', { count: 'exact', head: true })
          .eq('site_id', s.id)
          .gte('created_at', sinceIso)
        return { siteId: s.id, domain: s.domain, name: s.name, renders: count ?? 0 }
      })
    )

    rows.sort((a, b) => b.renders - a.renders)
    const total = rows.reduce((sum, r) => sum + r.renders, 0)

    return NextResponse.json({ since: sinceIso, total, sites: rows })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[USAGE_BY_SITE]:', err)
    return NextResponse.json({ error: 'Could not load usage' }, { status: 500 })
  }
}
