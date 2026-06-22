import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Single cron dispatcher. Triggers every scheduled job in ONE call, so the whole
// platform needs just one scheduled trigger — keeping us within Vercel Hobby's
// cron limit AND making scheduling portable: this one URL can be driven by Vercel
// Cron, cron-job.org, GitHub Actions, Upstash QStash, etc. (Bearer CRON_SECRET).
//
// Every job is idempotent / self-gating, so calling this frequently is safe:
//   • queue/process  — drains pending render jobs (benefits from frequent runs)
//   • sitemaps/recheck — only re-crawls sitemaps past their interval
//   • llms/regenerate  — only rebuilds llms.txt older than its window
//   • email/digest     — only emails users due per last_digest_sent_at
// Frequent triggering just drains the queue often; the rest no-op until due.
const JOBS: { name: string; path: string }[] = [
  { name: 'queue', path: '/api/queue/process' },
  { name: 'sitemaps', path: '/api/sitemaps/recheck' },
  { name: 'llms', path: '/api/llms/regenerate' },
  { name: 'digest', path: '/api/email/digest' },
]

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Our own origin — explicit env first, else the incoming request's origin.
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || req.nextUrl.origin
  const headers = { Authorization: `Bearer ${secret}` }

  // Fire all jobs in parallel. Each runs as its own serverless invocation with
  // its own timeout, so one slow job never blocks the others. The dispatcher
  // aborts its wait at ~58s (under maxDuration); an aborted wait doesn't cancel
  // the target invocation, which finishes independently.
  const results: Record<string, string | number> = {}
  await Promise.all(
    JOBS.map(async (j) => {
      try {
        const r = await fetch(`${base}${j.path}`, { headers, signal: AbortSignal.timeout(58_000) })
        results[j.name] = r.status
      } catch (e) {
        results[j.name] = e instanceof Error ? e.name : 'error'
      }
    })
  )

  return NextResponse.json({ ran: results, at: new Date().toISOString() })
}
