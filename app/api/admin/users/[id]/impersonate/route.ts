import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, logAdminAction, ForbiddenError } from '@/lib/admin-auth'
import { UnauthorizedError } from '@/lib/auth-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

function authError(err: unknown) {
  if (err instanceof UnauthorizedError) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (err instanceof ForbiddenError) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    const { id } = await params

    const { data: target } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('id', id)
      .single()
    if (!target?.email) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Short-lived magic-link token the admin can exchange to view as this user.
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: target.email,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // ALWAYS log impersonation.
    await logAdminAction(
      admin.id,
      'impersonate_user',
      'user',
      id,
      { email: target.email },
      req.headers.get('x-forwarded-for')
    )

    return NextResponse.json({
      token: data.properties?.hashed_token,
      redirectUrl: '/dashboard',
    })
  } catch (err) {
    return authError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
