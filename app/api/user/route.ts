import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Fields a user is allowed to update on their own profile.
const ALLOWED_FIELDS = ['full_name', 'company_name', 'notification_email'] as const

// ── GET /api/user — current profile (same as /api/auth/me) ───────────────────
export async function GET() {
  try {
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const { data: profile, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ user: profile })
  } catch (error) {
    console.error('[USER_GET]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── PATCH /api/user — update validated profile fields ────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const body = await req.json().catch(() => ({}))

    // Whitelist + type-validate incoming fields.
    const updates: Record<string, unknown> = {}
    for (const key of ALLOWED_FIELDS) {
      if (!(key in body)) continue
      const value = body[key]
      if (key === 'notification_email') {
        if (typeof value !== 'boolean') {
          return NextResponse.json({ error: 'notification_email must be boolean' }, { status: 400 })
        }
      } else if (value !== null && typeof value !== 'string') {
        return NextResponse.json({ error: `${key} must be a string` }, { status: 400 })
      }
      updates[key] = value
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    updates.updated_at = new Date().toISOString()

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', user.id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ user: data })
  } catch (error) {
    console.error('[USER_PATCH]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
