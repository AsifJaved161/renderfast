// ─────────────────────────────────────────────────────────────────────────────
// Bandwidth $/GB cost estimate — RenderFast-admin-owned (see migration 012).
//
// The rate translates bot_traffic_stats.bytes_served into an estimated dollar
// figure. It is ADMIN-OWNED: only RenderFast's own admins read/write it via the
// admin API (gated by requireAdmin). These functions use the service-role client
// for internal, server-side cost computation — they MUST NOT be exposed to a
// client-facing route without a requireAdmin() guard on top.
//
// Correctness rule: a past day's cost is computed with the rate that was ACTIVE
// that day (getRateForDate), never the current rate. Changing the rate never
// overwrites history — it closes the open row and opens a new one (setRate).
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseAdmin } from '@/lib/supabase'

const SETTING_KEY = 'bot_cost_estimate'
const FALLBACK_RATE = 0.08 // matches the migration seed; used only if history is empty

export interface BotCostEstimate {
  rate_per_gb_usd: number
  rate_source: string
  effective_from: string
}

export interface RateHistoryRow {
  id: string
  rate_per_gb_usd: number
  effective_from: string
  effective_to: string | null
  set_by: string | null
  created_at: string
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10)
}

// Current (active) estimate config from platform_settings.
export async function getCurrentEstimate(): Promise<BotCostEstimate> {
  const { data } = await supabaseAdmin
    .from('platform_settings')
    .select('value')
    .eq('key', SETTING_KEY)
    .maybeSingle()
  const v = (data?.value ?? {}) as Partial<BotCostEstimate>
  return {
    rate_per_gb_usd: Number(v.rate_per_gb_usd ?? FALLBACK_RATE),
    rate_source: v.rate_source ?? 'Industry average estimate ($0.05–0.12/GB)',
    effective_from: v.effective_from ?? todayISODate(),
  }
}

// The rate that was active on a given day (YYYY-MM-DD) — for historical cost.
// Half-open interval match: effective_from <= date AND (effective_to is null OR date < effective_to).
export async function getRateForDate(date: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('bot_cost_rate_history')
    .select('rate_per_gb_usd, effective_from, effective_to')
    .lte('effective_from', date)
    .or(`effective_to.is.null,effective_to.gt.${date}`)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? Number(data.rate_per_gb_usd) : FALLBACK_RATE
}

// Full rate history, newest first (admin view).
export async function getRateHistory(): Promise<RateHistoryRow[]> {
  const { data } = await supabaseAdmin
    .from('bot_cost_rate_history')
    .select('*')
    .order('effective_from', { ascending: false })
  return (data ?? []) as RateHistoryRow[]
}

// Estimate the dollar cost of a byte volume using a specific $/GB rate.
export function estimateCost(bytes: number, ratePerGbUsd: number): number {
  return (bytes / 1_000_000_000) * ratePerGbUsd
}

// Change the active rate WITHOUT destroying history. Closes the currently-open
// row (effective_to = today) and inserts a new open row, then refreshes the
// platform_settings snapshot. Caller MUST have passed requireAdmin() first and
// supply the verified admin id. Idempotent no-op if the rate is unchanged.
export async function setRate(
  newRate: number,
  adminId: string,
  rateSource?: string
): Promise<{ changed: boolean; rate: number }> {
  const today = todayISODate()
  const current = await getCurrentEstimate()

  // Unchanged rate → only refresh the source/snapshot, leave history intact.
  if (Number(newRate) === Number(current.rate_per_gb_usd)) {
    await supabaseAdmin.from('platform_settings').upsert(
      {
        key: SETTING_KEY,
        value: {
          rate_per_gb_usd: Number(newRate),
          rate_source: rateSource ?? current.rate_source,
          effective_from: current.effective_from,
        },
        updated_at: new Date().toISOString(),
        updated_by: adminId,
      },
      { onConflict: 'key' }
    )
    return { changed: false, rate: Number(newRate) }
  }

  // Close the open historical row, then open a new one.
  await supabaseAdmin
    .from('bot_cost_rate_history')
    .update({ effective_to: today })
    .is('effective_to', null)

  await supabaseAdmin.from('bot_cost_rate_history').insert({
    rate_per_gb_usd: Number(newRate),
    effective_from: today,
    effective_to: null,
    set_by: adminId,
  })

  await supabaseAdmin.from('platform_settings').upsert(
    {
      key: SETTING_KEY,
      value: {
        rate_per_gb_usd: Number(newRate),
        rate_source: rateSource ?? current.rate_source,
        effective_from: today,
      },
      updated_at: new Date().toISOString(),
      updated_by: adminId,
    },
    { onConflict: 'key' }
  )

  return { changed: true, rate: Number(newRate) }
}
