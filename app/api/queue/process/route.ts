import { NextRequest, NextResponse } from 'next/server'
import { setCachedPage } from '@/lib/kv'
import { renderPage } from '@/lib/renderer'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BATCH = 5
const CACHE_TTL = 86400

export async function POST(req: NextRequest) {
  // Allow either a logged-in user (x-user-id) or the cron secret.
  const uid = req.headers.get('x-user-id')
  const cronOk = req.headers.get('x-cron-secret') === process.env.CRON_SECRET
  if (!uid && !cronOk) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let pending = supabaseAdmin
    .from('caching_queue')
    .select('id, url, site_id, user_id, attempts')
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(BATCH)

  if (uid) pending = pending.eq('user_id', uid)

  const { data: items, error } = await pending
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!items || items.length === 0) {
    return NextResponse.json({ processed: 0, failed: 0 })
  }

  let processed = 0
  let failed = 0

  for (const item of items) {
    await supabaseAdmin
      .from('caching_queue')
      .update({ status: 'rendering' })
      .eq('id', item.id)

    let domain = ''
    let parsed: URL | null = null
    try {
      parsed = new URL(item.url)
      domain = parsed.hostname
    } catch {
      // invalid URL → fail immediately below
    }

    const result = parsed ? await renderPage(item.url) : null

    if (!parsed || !result || result.error || !result.html) {
      failed++
      await supabaseAdmin
        .from('caching_queue')
        .update({
          status: 'failed',
          error_message: result?.error ?? 'Invalid URL or empty render',
          attempts: (item.attempts ?? 0) + 1,
        })
        .eq('id', item.id)
      continue
    }

    await setCachedPage(domain, item.url, result.html, CACHE_TTL)

    await supabaseAdmin.from('cache_entries').upsert(
      {
        site_id: item.site_id,
        user_id: item.user_id,
        url: item.url,
        url_hash: `${domain}:${parsed.pathname}${parsed.search}`,
        status_code: result.statusCode,
        html_size_bytes: Buffer.byteLength(result.html, 'utf8'),
        render_time_ms: result.renderTimeMs,
        cached_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + CACHE_TTL * 1000).toISOString(),
        is_mobile: false,
      },
      { onConflict: 'url_hash' }
    )

    await supabaseAdmin
      .from('caching_queue')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', item.id)

    processed++
  }

  return NextResponse.json({ processed, failed })
}
