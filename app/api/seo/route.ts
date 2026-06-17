import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getCachedPage } from '@/lib/kv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CONCURRENCY = 8

// Lightweight SEO checks over a rendered page's HTML (regex — no parser dep).
function analyzeHtml(html: string) {
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleM ? titleM[1].replace(/\s+/g, ' ').trim() : ''
  const hasTitle = title.length > 0
  return {
    hasTitle,
    goodTitle: hasTitle && title.length >= 5 && title.length <= 65,
    hasMeta:
      /<meta[^>]+name=["']description["'][^>]+content=["'][^"']+["']/i.test(html) ||
      /<meta[^>]+content=["'][^"']+["'][^>]+name=["']description["']/i.test(html),
    hasCanonical: /<link[^>]+rel=["']canonical["']/i.test(html),
    hasOg: /<meta[^>]+property=["']og:(title|image)["']/i.test(html),
    hasH1: /<h1[\s>]/i.test(html),
  }
}

interface IssueAcc {
  name: string
  severity: 'Critical' | 'Warning' | 'Info'
  fix: string
  urls: { url: string; renderTime: number | null }[]
}

export async function GET(req: NextRequest) {
  try {
    const uid = req.headers.get('x-user-id')
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const siteId = req.nextUrl.searchParams.get('site_id')
    if (!siteId) return NextResponse.json({ error: 'site_id required' }, { status: 400 })

    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('domain')
      .eq('id', siteId)
      .eq('user_id', uid)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })
    const domain = site.domain

    const limit = Math.min(60, parseInt(req.nextUrl.searchParams.get('limit') ?? '40', 10))
    const { data: entries } = await supabaseAdmin
      .from('cache_entries')
      .select('url, status_code, render_time_ms')
      .eq('site_id', siteId)
      .eq('user_id', uid)
      .order('cached_at', { ascending: false })
      .limit(limit)

    const list = entries ?? []
    if (list.length === 0) {
      return NextResponse.json({
        analyzed: 0,
        htmlAnalyzed: 0,
        score: null,
        issues: [],
        message: 'No rendered pages yet — render some URLs from the Caching Queue first.',
      })
    }

    type Row = {
      url: string
      renderTime: number | null
      status: number | null
      c: ReturnType<typeof analyzeHtml> | null
    }
    const results: Row[] = []
    for (let i = 0; i < list.length; i += CONCURRENCY) {
      const batch = list.slice(i, i + CONCURRENCY)
      const r = await Promise.all(
        batch.map(async (e): Promise<Row> => {
          let html: string | null = null
          try {
            html = await getCachedPage(domain, e.url)
          } catch {
            /* KV miss / not configured */
          }
          return {
            url: e.url,
            renderTime: e.render_time_ms,
            status: e.status_code,
            c: html ? analyzeHtml(html) : null,
          }
        })
      )
      results.push(...r)
    }

    const issues: Record<string, IssueAcc> = {
      error: { name: 'Error Pages (4xx / 5xx)', severity: 'Critical', fix: 'Fix the source page so it returns 200.', urls: [] },
      missing_title: { name: 'Missing / Poor Title', severity: 'Critical', fix: 'Add a unique <title> (5–65 chars).', urls: [] },
      missing_meta: { name: 'Missing Meta Description', severity: 'Warning', fix: 'Add a 150–160 char meta description.', urls: [] },
      missing_canonical: { name: 'Missing Canonical URL', severity: 'Warning', fix: 'Add <link rel="canonical"> to the clean URL.', urls: [] },
      missing_og: { name: 'Missing Open Graph Tags', severity: 'Info', fix: 'Add og:title and og:image for social sharing.', urls: [] },
      missing_h1: { name: 'Missing H1', severity: 'Info', fix: 'Add a single descriptive <h1>.', urls: [] },
      slow: { name: 'Slow Render (>2s)', severity: 'Warning', fix: 'Reduce blocking scripts; enable caching.', urls: [] },
    }

    let passSum = 0
    let passDen = 0
    let htmlAnalyzed = 0

    for (const r of results) {
      const u = { url: r.url, renderTime: r.renderTime }
      const isError = r.status != null && r.status >= 400
      if (isError) issues.error.urls.push(u)
      if (r.renderTime != null && r.renderTime > 2000) issues.slow.urls.push(u)

      if (r.c) {
        htmlAnalyzed++
        const passed = [r.c.goodTitle, r.c.hasMeta, r.c.hasCanonical, r.c.hasOg, r.c.hasH1, !isError]
        passSum += passed.filter(Boolean).length
        passDen += passed.length

        if (!r.c.goodTitle) issues.missing_title.urls.push(u)
        if (!r.c.hasMeta) issues.missing_meta.urls.push(u)
        if (!r.c.hasCanonical) issues.missing_canonical.urls.push(u)
        if (!r.c.hasOg) issues.missing_og.urls.push(u)
        if (!r.c.hasH1) issues.missing_h1.urls.push(u)
      }
    }

    const score = passDen ? Math.round((passSum / passDen) * 100) : null
    const out = Object.entries(issues)
      .filter(([, v]) => v.urls.length > 0)
      .map(([key, v]) => ({ key, ...v }))

    return NextResponse.json({ analyzed: results.length, htmlAnalyzed, score, issues: out })
  } catch (e) {
    console.error('[SEO_GET]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
