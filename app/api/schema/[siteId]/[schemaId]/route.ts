import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Basic JSON-LD shape check (NOT full schema.org validation): the body must be a
// JSON object (or array of objects). A top-level object needs @context + (@type
// or @graph); array entries each need an @type. This catches malformed pastes
// without trying to validate every schema.org property.
function isValidJsonLd(value: unknown): boolean {
  const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v)

  if (Array.isArray(value)) {
    if (value.length === 0) return false
    return value.every((node) => isObj(node) && ('@type' in node || '@graph' in node))
  }
  if (!isObj(value)) return false
  const hasContext = typeof value['@context'] === 'string' || isObj(value['@context'])
  const hasTypeOrGraph = '@type' in value || '@graph' in value
  return hasContext && hasTypeOrGraph
}

// ── PATCH /api/schema/:siteId/:schemaId — save a client's manual edit ─────────
// Stores the edited JSON-LD in `edited_json_ld` and sets status = 'edited'
// (served like 'approved' — see Part 4). Clears the `changed` flag.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ siteId: string; schemaId: string }> }) {
  try {
    const uid = req.headers.get('x-user-id')
    if (!uid) return NextResponse.json({ error: 'x-user-id required' }, { status: 401 })

    const { siteId, schemaId } = await ctx.params

    const body = await req.json().catch(() => null)
    // Accept either { json_ld: {...} } or the JSON-LD object posted directly.
    const edited = body && typeof body === 'object' && 'json_ld' in body ? (body as { json_ld: unknown }).json_ld : body
    if (!isValidJsonLd(edited)) {
      return NextResponse.json(
        { error: 'Invalid JSON-LD: expected an object with @context and @type (or @graph), or an array of typed objects.' },
        { status: 400 }
      )
    }

    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id')
      .eq('id', siteId)
      .eq('user_id', uid)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const { data: row } = await supabaseAdmin
      .from('generated_schemas')
      .update({
        edited_json_ld: edited,
        status: 'edited',
        changed: false,
        reviewed_at: new Date().toISOString(),
        reviewed_by: uid,
      })
      .eq('id', schemaId)
      .eq('site_id', siteId)
      .select('id, status, edited_json_ld, reviewed_at')
      .maybeSingle()
    if (!row) return NextResponse.json({ error: 'Schema not found' }, { status: 404 })

    return NextResponse.json({ schema: row })
  } catch (e) {
    console.error('[SCHEMA_PATCH]:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
