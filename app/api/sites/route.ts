import { NextRequest, NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPlanLimits } from '@/lib/plan-utils'
import { discoverAndQueueSitemap } from '@/lib/sitemap'
import { drainQueue } from '@/lib/queue-drain'
import { isRenderConfigured } from '@/lib/renderer'
import { processDiagnosticsJob, isUrlOnDomain } from '@/lib/diagnostics-worker'
import { isRenderableUrl, normalizeDomain } from '@/lib/url-utils'
import { getOpsConfig } from '@/lib/app-config'
import type { Plan } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Accepts bare domains like "example.com" or "sub.example.co.uk".
const DOMAIN_RE = /^(?!:\/\/)([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/

function userId(req: NextRequest) {
  return req.headers.get('x-user-id')
}

// ── GET /api/sites ───────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const uid = userId(req)
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const { data: sites, error } = await supabaseAdmin
      .from('sites')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('plan')
      .eq('id', uid)
      .single()

    const limit = getPlanLimits((user?.plan as Plan) ?? 'free').sites

    let list = sites ?? []

    // Per-site insights (only when requested — keeps the common selector calls light).
    if (req.nextUrl.searchParams.get('with_stats') === '1' && list.length > 0) {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      list = await Promise.all(
        list.map(async (s) => {
          const [cached, botHits, broken] = await Promise.all([
            supabaseAdmin
              .from('cache_entries')
              .select('id', { count: 'exact', head: true })
              .eq('site_id', s.id),
            supabaseAdmin
              .from('bot_visits')
              .select('id', { count: 'exact', head: true })
              .eq('site_id', s.id)
              .gte('created_at', since),
            supabaseAdmin
              .from('broken_links')
              .select('id', { count: 'exact', head: true })
              .eq('site_id', s.id)
              .eq('resolved', false),
          ])
          return {
            ...s,
            stats: {
              renders: s.render_count ?? 0,
              cached: cached.count ?? 0,
              botHits30: botHits.count ?? 0,
              brokenLinks: broken.count ?? 0,
            },
          }
        })
      )
    }

    return NextResponse.json({
      sites: list,
      count: list.length,
      limit: limit === Infinity ? null : limit,
      plan: (user?.plan as Plan) ?? 'free',
    })
  } catch (error) {
    console.error('[SITES_GET]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── POST /api/sites ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const uid = userId(req)
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const { name, integration_type } = body
    // Normalize (lowercase, strip protocol/path/www) so the stored domain always
    // matches the lowercase hostname the proxy resolves for incoming bot hits.
    const domain = normalizeDomain(body.domain ?? '')
    if (!domain || !DOMAIN_RE.test(domain)) {
      return NextResponse.json({ error: 'Invalid domain format' }, { status: 400 })
    }

    // Plan site-limit check.
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('plan')
      .eq('id', uid)
      .single()
    const limit = getPlanLimits((user?.plan as Plan) ?? 'free').sites

    const { count } = await supabaseAdmin
      .from('sites')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uid)

    if ((count ?? 0) >= limit) {
      return NextResponse.json(
        { error: 'Plan site limit reached', limit },
        { status: 403 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('sites')
      .insert({
        user_id: uid,
        domain,
        name: name ?? domain,
        integration_type: integration_type ?? null,
        status: 'active',
      })
      .select()
      .single()

    if (error) {
      // 23505 = unique violation (user already added this domain)
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json(
          { error: 'This domain is already added to your account.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Auto-discover the sitemap, queue its page URLs, then immediately start
    // rendering them (bounded) — all server-side after the response, so it can't
    // be cancelled by client navigation. Large sitemaps keep draining via the
    // Vercel cron / "Process Queue" button.
    after(async () => {
      try {
        await discoverAndQueueSitemap(data.id, uid, data.domain)
        await drainQueue({ siteId: data.id, userId: uid, maxUrls: 12, deadlineMs: 35_000 })
      } catch (e) {
        console.error('[SITES_POST auto-sitemap]:', e)
      }

      // Auto-trigger Bot Visibility scan so user sees health stats immediately.
      // Fire-and-forget: silently skip if rendering not configured or no URLs yet.
      try {
        if (!(await isRenderConfigured())) return

        // Gather URLs from cache_entries or caching_queue for this site
        const { maxRescanUrls } = await getOpsConfig()
        let urls: string[] = []
        const { data: cached } = await supabaseAdmin
          .from('cache_entries')
          .select('url')
          .eq('site_id', data.id)
          .order('cached_at', { ascending: false })
          .limit(maxRescanUrls * 2)
        urls = (cached ?? []).map((r: { url: string }) => r.url)

        if (urls.length === 0) {
          const { data: queued } = await supabaseAdmin
            .from('caching_queue')
            .select('url')
            .eq('site_id', data.id)
            .limit(maxRescanUrls * 2)
          urls = (queued ?? []).map((r: { url: string }) => r.url)
        }

        urls = Array.from(
          new Set(urls.filter((u) => isUrlOnDomain(u, data.domain) && isRenderableUrl(u)))
        ).slice(0, maxRescanUrls)

        if (urls.length === 0) return

        // Create the diagnostics job
        const { data: job, error: jobErr } = await supabaseAdmin
          .from('diagnostics_jobs')
          .insert({
            site_id: data.id,
            user_id: uid,
            urls,
            status: 'queued',
            total_count: urls.length,
            done_count: 0,
          })
          .select('id')
          .single()

        if (!jobErr && job) {
          await processDiagnosticsJob(job.id)
        }
      } catch (e) {
        console.error('[SITES_POST auto-diagnostics]:', e)
      }
    })

    return NextResponse.json({ site: data }, { status: 201 })
  } catch (error) {
    console.error('[SITES_POST]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
