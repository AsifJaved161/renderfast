import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/schema/:siteId/:schemaId/approve ────────────────────────────────
// Marks a generated schema as approved (will be served). Clears the `changed`
// flag since the client has now reviewed the current content.
export async function POST(req: NextRequest, ctx: { params: Promise<{ siteId: string; schemaId: string }> }) {
  try {
    const uid = req.headers.get('x-user-id')
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const { siteId, schemaId } = await ctx.params

    // Ownership — the site must belong to this user.
    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id')
      .eq('id', siteId)
      .eq('user_id', uid)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const { data: row } = await supabaseAdmin
      .from('generated_schemas')
      .update({ status: 'approved', changed: false, reviewed_at: new Date().toISOString(), reviewed_by: uid })
      .eq('id', schemaId)
      .eq('site_id', siteId)
      .select('id, status, reviewed_at')
      .maybeSingle()
    if (!row) return NextResponse.json({ error: 'Schema not found' }, { status: 404 })

    return NextResponse.json({ schema: row })
  } catch (e) {
    console.error('[SCHEMA_APPROVE]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
