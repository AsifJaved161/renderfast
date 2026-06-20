import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getServableLlmsTxt } from '@/lib/llms-txt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/llms-txt/:siteId ────────────────────────────────────────────────
// Shows the client what's being served at their /llms.txt: the cached content,
// when it was generated, and whether auto-serving is on. Read-only — nothing for
// the client to configure (the file is produced and refreshed automatically).
export async function GET(req: NextRequest, ctx: { params: Promise<{ siteId: string }> }) {
  try {
    const uid = req.headers.get('x-user-id')
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const { siteId } = await ctx.params

    // Ownership check — identical pattern to /api/diagnostics/:siteId.
    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id, domain')
      .eq('id', siteId)
      .eq('user_id', uid)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const { data: row } = await supabaseAdmin
      .from('llms_txt_cache')
      .select('content, generated_at, auto_enabled')
      .eq('site_id', siteId)
      .maybeSingle()

    // Not generated yet → produce it now so the dashboard always shows real
    // content (mirrors the proxy's first-request behaviour).
    if (!row) {
      const content = await getServableLlmsTxt(siteId)
      return NextResponse.json({
        domain: site.domain,
        content: content ?? '',
        generatedAt: new Date().toISOString(),
        autoEnabled: true,
        url: `https://${site.domain.replace(/^www\./, '')}/llms.txt`,
      })
    }

    return NextResponse.json({
      domain: site.domain,
      content: row.content,
      generatedAt: row.generated_at,
      autoEnabled: row.auto_enabled,
      url: `https://${site.domain.replace(/^www\./, '')}/llms.txt`,
    })
  } catch (e) {
    console.error('[LLMS_TXT_GET]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
