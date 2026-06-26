import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, type DbUser } from '@/lib/supabase'
import { sendUsageWarningEmail, sendUsageLimitEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000

// Resets each user's monthly render_count once their window elapses, and emails
// 80%/100% usage warnings. CRITICAL: this is what frees a user who has hit their
// render limit — it MUST run on a schedule (wired into /api/cron's dispatcher).
async function runUsageCheck() {
  const { data: users, error } = await supabaseAdmin.from('users').select('*')
  if (error) throw new Error(error.message)

  let processed = 0
  let warned = 0
  let reset = 0
  const now = Date.now()

  for (const user of (users ?? []) as DbUser[]) {
    processed++

    // a/b) Reset usage if the monthly window has elapsed.
    if (user.monthly_reset_at && new Date(user.monthly_reset_at).getTime() <= now) {
      await supabaseAdmin
        .from('users')
        .update({
          render_count: 0,
          monthly_reset_at: new Date(now + THIRTY_DAYS_MS).toISOString(),
        })
        .eq('id', user.id)
      reset++
      continue // fresh window — no warnings this cycle
    }

    if (!user.render_limit) continue
    const percent = Math.round((user.render_count / user.render_limit) * 100)

    // Only email users who opted in.
    if (!user.notification_email) continue

    // d) At/over limit.
    if (percent >= 100) {
      await sendUsageLimitEmail(user)
      warned++
    }
    // c) 80%+ warning.
    else if (percent >= 80) {
      await sendUsageWarningEmail(user, percent)
      warned++
    }
  }

  return { processed, warned, reset }
}

// Accepts the platform's two cron-auth conventions: `Authorization: Bearer
// <CRON_SECRET>` (used by the /api/cron dispatcher and Vercel Cron) or a raw
// `x-cron-secret: <CRON_SECRET>` header.
function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization')
  return auth === `Bearer ${secret}` || req.headers.get('x-cron-secret') === secret
}

// GET — invoked by the /api/cron dispatcher (Authorization: Bearer CRON_SECRET).
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await runUsageCheck())
  } catch (error) {
    console.error('[EMAIL_USAGE_CHECK_GET]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — kept for backward compatibility (x-cron-secret or raw authorization).
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await runUsageCheck())
  } catch (error) {
    console.error('[EMAIL_USAGE_CHECK_POST]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
