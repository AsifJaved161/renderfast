import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, adminAuthError } from '@/lib/admin-auth'
import { stripe } from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DAY = 86400_000

function dayKey(iso: string) {
  return iso.slice(0, 10)
}

function emptyTrend(days = 30) {
  const out: Record<string, number> = {}
  for (let i = days - 1; i >= 0; i--) {
    out[new Date(Date.now() - i * DAY).toISOString().slice(0, 10)] = 0
  }
  return out
}

export async function GET() {
  try {
    await requireAdmin()

    const now = Date.now()
    const todayStart = new Date(new Date().toISOString().slice(0, 10)).toISOString()
    const monthStart = new Date(now - 30 * DAY).toISOString()

    const headCount = async (table: string, build?: (q: any) => any) => {
      let q = supabaseAdmin.from(table).select('id', { count: 'exact', head: true })
      if (build) q = build(q)
      const { count } = await q
      return count ?? 0
    }

    // ── Users ──────────────────────────────────────────────────────────────────
    const [total, newToday, newThisMonth, activeLast30d, banned] = await Promise.all([
      headCount('users'),
      headCount('users', (q) => q.gte('created_at', todayStart)),
      headCount('users', (q) => q.gte('created_at', monthStart)),
      headCount('users', (q) => q.gte('last_login_at', monthStart)),
      headCount('users', (q) => q.eq('is_banned', true)),
    ])

    // ── System ─────────────────────────────────────────────────────────────────
    const [totalSites, totalCached, totalBotVisits] = await Promise.all([
      headCount('sites'),
      headCount('cache_entries'),
      headCount('bot_visits'),
    ])

    // ── Renders ────────────────────────────────────────────────────────────────
    const [rendersAll, rendersToday, rendersMonth] = await Promise.all([
      headCount('renders'),
      headCount('renders', (q) => q.gte('created_at', todayStart)),
      headCount('renders', (q) => q.gte('created_at', monthStart)),
    ])
    const cacheHits = await headCount('renders', (q) => q.eq('cache_hit', true))
    const cacheHitRate = rendersAll ? Math.round((cacheHits / rendersAll) * 100) : 0

    // ── Schema Markup adoption ───────────────────────────────────────────────────
    // Total generated across all sites, and approval rate (approved / reviewed)
    // broken down by type — shows whether clients trust the generated schema.
    // 'edited' counts as approved (it's served). Missing table → all zeros.
    const SCHEMA_TYPES = ['Article', 'Product', 'FAQPage', 'Organization']
    const schemaByType = await Promise.all(
      SCHEMA_TYPES.map(async (t) => {
        const [tTotal, tApproved, tRejected, tPending] = await Promise.all([
          headCount('generated_schemas', (q) => q.eq('schema_type', t)),
          headCount('generated_schemas', (q) => q.eq('schema_type', t).in('status', ['approved', 'edited'])),
          headCount('generated_schemas', (q) => q.eq('schema_type', t).eq('status', 'rejected')),
          headCount('generated_schemas', (q) => q.eq('schema_type', t).eq('status', 'pending')),
        ])
        const reviewed = tApproved + tRejected
        return {
          type: t,
          total: tTotal,
          approved: tApproved,
          rejected: tRejected,
          pending: tPending,
          approval_rate: reviewed ? Math.round((tApproved / reviewed) * 100) : null,
        }
      })
    )
    const schemaTotal = schemaByType.reduce((s, t) => s + t.total, 0)
    const schemaApproved = schemaByType.reduce((s, t) => s + t.approved, 0)
    const schemaRejected = schemaByType.reduce((s, t) => s + t.rejected, 0)
    const schemaPending = schemaByType.reduce((s, t) => s + t.pending, 0)
    const schemaReviewed = schemaApproved + schemaRejected
    const schema = {
      total: schemaTotal,
      approved: schemaApproved,
      rejected: schemaRejected,
      pending: schemaPending,
      approval_rate: schemaReviewed ? Math.round((schemaApproved / schemaReviewed) * 100) : null,
      by_type: schemaByType,
    }

    // ── Top plans ──────────────────────────────────────────────────────────────
    const plans = ['free', 'starter', 'pro', 'agency']
    const planCounts = await Promise.all(
      plans.map(async (p) => ({ plan: p, user_count: await headCount('users', (q) => q.eq('plan', p)) }))
    )
    const topPlans = planCounts
      .map((p) => ({ ...p, percentage: total ? Math.round((p.user_count / total) * 100) : 0 }))
      .sort((a, b) => b.user_count - a.user_count)

    // ── Trends: signups + renders (last 30d) from DB ─────────────────────────────
    const signupsTrend = emptyTrend()
    const { data: recentUsers } = await supabaseAdmin
      .from('users')
      .select('created_at')
      .gte('created_at', monthStart)
    for (const u of recentUsers ?? []) {
      const k = dayKey(u.created_at)
      if (k in signupsTrend) signupsTrend[k]++
    }

    const rendersTrend = emptyTrend()
    const { data: recentRenders } = await supabaseAdmin
      .from('renders')
      .select('created_at')
      .gte('created_at', monthStart)
    for (const r of recentRenders ?? []) {
      const k = dayKey(r.created_at)
      if (k in rendersTrend) rendersTrend[k]++
    }

    // ── Revenue (Stripe) ─────────────────────────────────────────────────────────
    let mrr = 0
    let totalCustomers = 0
    const revenueTrend = emptyTrend()
    try {
      const subs = await stripe.subscriptions.list({ status: 'active', limit: 100 })
      totalCustomers = subs.data.length
      for (const s of subs.data) {
        const item = s.items.data[0]
        const amount = (item?.price.unit_amount ?? 0) / 100
        const interval = item?.price.recurring?.interval
        mrr += interval === 'year' ? amount / 12 : amount
      }

      const charges = await stripe.charges.list({
        created: { gte: Math.floor((now - 30 * DAY) / 1000) },
        limit: 100,
      })
      for (const c of charges.data) {
        if (!c.paid || c.refunded) continue
        const k = new Date(c.created * 1000).toISOString().slice(0, 10)
        if (k in revenueTrend) revenueTrend[k] += (c.amount ?? 0) / 100
      }
    } catch {
      // Stripe not configured / unreachable — revenue stays zeroed.
    }

    return NextResponse.json({
      users: { total, new_today: newToday, new_this_month: newThisMonth, active_last_30d: activeLast30d, banned },
      revenue: { mrr: Math.round(mrr), arr: Math.round(mrr * 12), total_customers: totalCustomers },
      renders: { total_all_time: rendersAll, today: rendersToday, this_month: rendersMonth, cache_hit_rate: cacheHitRate },
      system: { total_sites: totalSites, total_cached_pages: totalCached, total_bot_visits: totalBotVisits },
      schema,
      top_plans: topPlans,
      signups_trend: Object.entries(signupsTrend).map(([date, count]) => ({ date, count })),
      renders_trend: Object.entries(rendersTrend).map(([date, count]) => ({ date, count })),
      revenue_trend: Object.entries(revenueTrend).map(([date, amount]) => ({ date, amount: Math.round(amount) })),
    })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
