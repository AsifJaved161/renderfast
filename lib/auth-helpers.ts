import { randomUUID, createHash } from 'crypto'
import { createServerClient, supabaseAdmin, type DbUser } from '@/lib/supabase'

// ── Read the session user and join their public.users profile ────────────────
export async function getUserFromRequest(): Promise<DbUser | null> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  return (profile as DbUser) ?? null
}

// Thrown by requireAuth so route handlers can map it to a 401 response.
export class UnauthorizedError extends Error {
  status = 401
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export async function requireAuth(): Promise<DbUser> {
  const user = await getUserFromRequest()
  if (!user) throw new UnauthorizedError()
  return user
}

// ── API key helpers ──────────────────────────────────────────────────────────
export function generateApiKey(): string {
  return `rf_${randomUUID().replace(/-/g, '')}`
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}
