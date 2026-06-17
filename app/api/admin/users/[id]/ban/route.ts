import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin, logAdminAction, ForbiddenError } from '@/lib/admin-auth'
import { UnauthorizedError } from '@/lib/auth-helpers'
import { sendBanEmail } from '@/lib/email'

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
    const { ban, reason } = await req.json().catch(() => ({}))
    if (typeof ban !== 'boolean') {
      return NextResponse.json({ error: 'ban (boolean) required' }, { status: 400 })
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('id', id)
      .single()
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    await supabaseAdmin
      .from('users')
      .update({
        is_banned: ban,
        ban_reason: ban ? reason ?? null : null,
        banned_at: ban ? new Date().toISOString() : null,
      })
      .eq('id', id)

    // Revoke sessions on ban (Supabase ban_duration also blocks future sign-ins).
    if (ban) {
      try {
        await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: '876000h' })
      } catch {
        // best-effort session revocation
      }
      await sendBanEmail(user.email, reason)
    } else {
      try {
        await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: 'none' })
      } catch {
        // best-effort unban
      }
    }

    await logAdminAction(
      admin.id,
      ban ? 'ban_user' : 'unban_user',
      'user',
      id,
      { reason: reason ?? null },
      req.headers.get('x-forwarded-for')
    )

    return NextResponse.json({ success: true, banned: ban })
  } catch (err) {
    return authError(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
