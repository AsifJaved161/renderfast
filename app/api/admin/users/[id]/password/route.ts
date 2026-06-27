import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, logAdminAction, adminAuthError } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

function ip(req: NextRequest) {
  return req.headers.get('x-forwarded-for')
}

// POST — reset_email: send a password-reset link  |  set_password: set a new password
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    const { id } = await params
    const body = await req.json().catch(() => ({}))

    const { data: user } = await supabaseAdmin.from('users').select('email').eq('id', id).maybeSingle()
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    if (body.action === 'reset_email') {
      const { data, error } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email: user.email,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await logAdminAction(admin.id, 'send_password_reset', 'user', id, { email: user.email }, ip(req))
      return NextResponse.json({ ok: true, link: data?.properties?.action_link ?? null })
    }

    if (body.action === 'set_password') {
      const password = String(body.password ?? '')
      if (password.length < 8) {
        return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
      }
      const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { password })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await logAdminAction(admin.id, 'set_user_password', 'user', id, undefined, ip(req))
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'action must be reset_email or set_password' }, { status: 400 })
  } catch (err) {
    return adminAuthError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
