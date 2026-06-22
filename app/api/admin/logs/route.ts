import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, adminAuthError } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()

    const { searchParams } = req.nextUrl
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '20', 10))
    const adminId = searchParams.get('admin_id')
    const action = searchParams.get('action')
    const targetType = searchParams.get('target_type')
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')

    // Join admin name via the FK to users.
    let query = supabaseAdmin
      .from('admin_logs')
      .select('*, admin:users!admin_logs_admin_id_fkey(full_name, email)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (adminId) query = query.eq('admin_id', adminId)
    if (action) query = query.eq('action', action)
    if (targetType) query = query.eq('target_type', targetType)
    if (startDate) query = query.gte('created_at', startDate)
    if (endDate) query = query.lte('created_at', endDate)

    const { data, count, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const logs = (data ?? []).map((row: any) => ({
      id: row.id,
      admin_id: row.admin_id,
      admin_name: row.admin?.full_name ?? row.admin?.email ?? 'Unknown',
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      details: row.details ?? null,
      ip_address: row.ip_address,
      created_at: row.created_at,
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
