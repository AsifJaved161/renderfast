import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, ForbiddenError } from '@/lib/admin-auth'
import { UnauthorizedError } from '@/lib/auth-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authError(err: unknown) {
  if (err instanceof UnauthorizedError) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (err instanceof ForbiddenError) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()

    const { searchParams } = req.nextUrl
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '20', 10))
    const search = searchParams.get('search')?.trim()
    const plan = searchParams.get('plan')
    const status = searchParams.get('status') ?? 'all'
    const sort = searchParams.get('sort') ?? 'created_at'
    const order = (searchParams.get('order') ?? 'desc') === 'asc'

    let query = supabaseAdmin
      .from('users')
      .select(
        'id, email, full_name, plan, render_count, render_limit, is_admin, is_banned, ban_reason, created_at, last_login_at, stripe_subscription_id',
        { count: 'exact' }
      )
      .order(sort, { ascending: order })
      .range((page - 1) * limit, page * limit - 1)

    if (search) query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`)
    if (plan) query = query.eq('plan', plan)
    if (status === 'active') query = query.eq('is_banned', false)
    if (status === 'banned') query = query.eq('is_banned', true)

    const { data: users, count, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Attach sites_count per user.
    const withCounts = await Promise.all(
      (users ?? []).map(async (u) => {
        const { count: sitesCount } = await supabaseAdmin
          .from('sites')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', u.id)
        return { ...u, sites_count: sitesCount ?? 0 }
      })
    )

    // Global stats.
    const countWhere = async (col: string, val: unknown) => {
      const { count: c } = await supabaseAdmin
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq(col, val as never)
      return c ?? 0
    }
    const totalUsers = (await supabaseAdmin.from('users').select('id', { count: 'exact', head: true })).count ?? 0
    const bannedUsers = await countWhere('is_banned', true)
    const freeUsers = await countWhere('plan', 'free')

    const stats = {
      totalUsers,
      activeUsers: totalUsers - bannedUsers,
      bannedUsers,
      freeUsers,
      paidUsers: totalUsers - freeUsers,
    }

    return NextResponse.json({
      users: withCounts,
      total: count ?? 0,
      page,
      totalPages: Math.ceil((count ?? 0) / limit),
      stats,
    })
  } catch (err) {
    return authError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
