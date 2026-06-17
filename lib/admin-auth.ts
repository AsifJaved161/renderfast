import { NextResponse } from 'next/server'
import { createServerClient, supabaseAdmin, type DbUser } from '@/lib/supabase'
import { UnauthorizedError } from '@/lib/auth-helpers'

// 403 — authenticated but not an admin.
export class ForbiddenError extends Error {
  status = 403
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

// Maps requireAdmin() throws to responses; returns null for other errors.
export function adminAuthError(err: unknown): NextResponse | null {
  if (err instanceof UnauthorizedError) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (err instanceof ForbiddenError) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

// Require a logged-in admin. Throws UnauthorizedError (401) or ForbiddenError (403).
export async function requireAdmin(): Promise<DbUser> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new UnauthorizedError()

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || !profile.is_admin) throw new ForbiddenError()
  return profile as DbUser
}

// Append an entry to admin_logs (service role — bypasses RLS).
export async function logAdminAction(
  adminId: string,
  action: string,
  targetType?: string,
  targetId?: string,
  details?: Record<string, unknown>,
  ip?: string | null
): Promise<void> {
  await supabaseAdmin.from('admin_logs').insert({
    admin_id: adminId,
    action,
    target_type: targetType ?? null,
    target_id: targetId ?? null,
    details: details ?? null,
    ip_address: ip ?? null,
  })
}
