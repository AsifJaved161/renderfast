import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { buildUserDigest } from '@/lib/digest'
import { sendDigestEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Bounded per run so it fits the function time limit; the daily cron + the
// last_digest_sent_at cursor spread sends across the week with no double-sends.
const MAX_PER_RUN = 30

// ── GET — send digests to users who are due ──────────────────────────────────
// Auth: Authorization: Bearer ${CRON_SECRET}. ?days=7 (weekly) | 30 (monthly).
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const days = Math.max(1, Math.min(31, parseInt(req.nextUrl.searchParams.get('days') ?? '7', 10)))
  const dueBefore = new Date(Date.now() - (days - 1) * 86400_000).toISOString()

  // Opted-in, not banned, and not already sent within the interval. Oldest first.
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, email, full_name, last_digest_sent_at')
    .eq('notification_email', true)
    .eq('is_banned', false)
    .or(`last_digest_sent_at.is.null,last_digest_sent_at.lt.${dueBefore}`)
    .order('last_digest_sent_at', { ascending: true, nullsFirst: true })
    .limit(MAX_PER_RUN)

  let sent = 0
  let skipped = 0

  for (const u of users ?? []) {
    try {
      const digest = await buildUserDigest(u.id, days)
      if (digest?.hasActivity) {
        await sendDigestEmail({ email: u.email, full_name: u.full_name }, digest)
        sent++
      } else {
        skipped++ // no sites / no activity → don't email, but stamp so we don't recheck daily
      }
    } catch (e) {
      console.error('[EMAIL_DIGEST] user failed:', u.id, e)
    } finally {
      // Stamp regardless (sent or skipped) so each user is evaluated once per interval.
      await supabaseAdmin.from('users').update({ last_digest_sent_at: new Date().toISOString() }).eq('id', u.id)
    }
  }

  return NextResponse.json({ processed: (users ?? []).length, sent, skipped })
}
