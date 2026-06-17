import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, type DbUser } from '@/lib/supabase'
import { sendUsageWarningEmail, sendUsageLimitEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000

export async function POST(req: NextRequest) {
  try {
    // Cron auth.
    const secret = req.headers.get('x-cron-secret') ?? req.headers.get('authorization')
    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: users, error } = await supabaseAdmin.from('users').select('*')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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

    return NextResponse.json({ processed, warned, reset })
  } catch (error) {
    console.error('[EMAIL_USAGE_CHECK_POST]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
