import { NextResponse } from 'next/server'
import { getFeatureAccessMap } from '@/lib/app-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/feature-access — the per-plan feature map for the dashboard UI ───
// Not sensitive (just which plan unlocks which feature), so no auth needed.
export async function GET() {
  const access = await getFeatureAccessMap()
  return NextResponse.json({ access })
}
