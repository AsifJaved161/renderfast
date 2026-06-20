import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateAndStoreLlmsTxt } from '@/lib/llms-txt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ── POST /api/llms-txt/:siteId/regenerate ────────────────────────────────────
// The one manual action a client needs: rebuild /llms.txt from current pages
// right now (everything else is automatic). Regenerates via generateLlmsTxt and
// overwrites the cache row.
export async function POST(req: NextRequest, ctx: { params: Promise<{ siteId: string }> }) {
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

    const content = await generateAndStoreLlmsTxt(siteId)

    return NextResponse.json({
      domain: site.domain,
      content,
      generatedAt: new Date().toISOString(),
      url: `https://${site.domain.replace(/^www\./, '')}/llms.txt`,
    })
  } catch (e) {
    console.error('[LLMS_TXT_REGEN]:', e)
    return NextResponse.json({ error: 'Regeneration failed' }, { status: 500 })
  }
}
