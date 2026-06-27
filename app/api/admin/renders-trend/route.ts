import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, adminAuthError } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY = 86400_000

function emptyTrend(days: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (let i = days - 1; i >= 0; i--) {
    out[new Date(Date.now() - i * DAY).toISOString().slice(0, 10)] = 0
  }
  return out
}

export async function GET(request: Request) {
  try {
    await requireAdmin()
    const raw = new URL(request.url).searchParams.get('days') ?? '30'
    const days = Math.min(365, Math.max(3, parseInt(raw, 10) || 30))
    const since = new Date(Date.now() - days * DAY).toISOString()
    const trend = emptyTrend(days)
    const { data } = await supabaseAdmin.from('renders').select('created_at').gte('created_at', since)
    for (const r of data ?? []) {
      const k = r.created_at.slice(0, 10)
      if (k in trend) trend[k]++
    }
    return NextResponse.json({
      trend: Object.entries(trend).map(([date, count]) => ({ date, count })),
    })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
