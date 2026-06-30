import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SchemaRow {
  id: string
  url: string
  schema_type: string
  json_ld: unknown
  edited_json_ld: unknown
  extracted_fields: unknown
  confidence: string
  status: 'pending' | 'approved' | 'rejected' | 'edited'
  changed: boolean
  already_present: boolean
  generated_at: string
  reviewed_at: string | null
}

// ── GET /api/schema/:siteId — all generated schemas, grouped by status ────────
// Ownership-checked the same way as the diagnostics endpoints. 'edited' rows are
// grouped under "approved" since they're served like approved (see Part 4), with
// each row's true status retained so the UI can badge it.
export async function GET(req: NextRequest, ctx: { params: Promise<{ siteId: string }> }) {
  try {
    const uid = req.headers.get('x-user-id')
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const { siteId } = await ctx.params

    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id, domain')
      .eq('id', siteId)
      .eq('user_id', uid)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const { data: rows } = await supabaseAdmin
      .from('generated_schemas')
      .select('id, url, schema_type, json_ld, edited_json_ld, extracted_fields, confidence, status, changed, already_present, generated_at, reviewed_at')
      .eq('site_id', siteId)
      .order('generated_at', { ascending: false })
      .limit(1000)

    const all = (rows ?? []) as SchemaRow[]
    const schemas = {
      pending: all.filter((r) => r.status === 'pending'),
      approved: all.filter((r) => r.status === 'approved' || r.status === 'edited'),
      rejected: all.filter((r) => r.status === 'rejected'),
    }

    return NextResponse.json({
      domain: site.domain,
      schemas,
      counts: {
        pending: schemas.pending.length,
        approved: schemas.approved.length,
        rejected: schemas.rejected.length,
        total: all.length,
      },
    })
  } catch (e) {
    console.error('[SCHEMA_GET]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
