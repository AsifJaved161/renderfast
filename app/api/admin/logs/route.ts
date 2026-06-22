import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, adminAuthError } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// How many recent rows to scan when deriving the distinct filter values.
const DISTINCT_SCAN = 5000

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()

    const { searchParams } = req.nextUrl

    // ── Filter-dropdown helpers ─────────────────────────────────────────────────
    // Distinct admin emails (everyone who can act). Bounded + clean.
    if (searchParams.get('distinct_admins') === 'true') {
      const { data } = await supabaseAdmin.from('users').select('email').eq('is_admin', true).order('email')
      return NextResponse.json({ admins: (data ?? []).map((u) => u.email).filter(Boolean) })
    }

    // Distinct actions + target types ACTUALLY present in the log, so the filters
    // stay correct as new audited actions are added (no hardcoded drift).
    if (searchParams.get('distinct_actions') === 'true') {
      const { data } = await supabaseAdmin
        .from('admin_logs')
        .select('action, target_type')
        .order('created_at', { ascending: false })
        .limit(DISTINCT_SCAN)
      const actions = Array.from(new Set((data ?? []).map((r) => r.action).filter(Boolean))).sort()
      const targetTypes = Array.from(new Set((data ?? []).map((r) => r.target_type).filter(Boolean))).sort()
      return NextResponse.json({ actions, targetTypes })
    }

    // ── Paged, filtered log query ───────────────────────────────────────────────
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '25', 10))
    const adminEmail = searchParams.get('admin_email')?.trim()
    const action = searchParams.get('action')
    const targetType = searchParams.get('target_type')
    // Accept both the page's from/to and legacy start_date/end_date.
    const from = searchParams.get('from') ?? searchParams.get('start_date')
    const to = searchParams.get('to') ?? searchParams.get('end_date')

    // The filter passes an email, but admin_logs.admin_id is a UUID — resolve first.
    let adminIds: string[] | null = null
    if (adminEmail) {
      const { data: admins } = await supabaseAdmin.from('users').select('id').eq('email', adminEmail)
      adminIds = (admins ?? []).map((a) => a.id)
      if (adminIds.length === 0) {
        return NextResponse.json({ logs: [], total: 0, page, totalPages: 0 })
      }
    }

    let query = supabaseAdmin
      .from('admin_logs')
      .select('*, admin:users!admin_logs_admin_id_fkey(full_name, email)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (adminIds) query = query.in('admin_id', adminIds)
    if (action) query = query.eq('action', action)
    if (targetType) query = query.eq('target_type', targetType)
    if (from) query = query.gte('created_at', from)
    if (to) query = query.lte('created_at', to)

    const { data, count, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const logs = (data ?? []).map((row: any) => ({
      id: row.id,
      admin_id: row.admin_id,
      // admin_name + created_at are consumed by the dashboard's Recent Activity;
      // admin_email + timestamp by the Audit Logs page. Provide all four.
      admin_name: row.admin?.full_name ?? row.admin?.email ?? 'Unknown',
      admin_email: row.admin?.email ?? '—',
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      details: row.details ?? null,
      ip_address: row.ip_address,
      created_at: row.created_at,
      timestamp: row.created_at,
    }))

    return NextResponse.json({
      logs,
      total: count ?? 0,
      page,
      totalPages: Math.ceil((count ?? 0) / limit),
    })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
