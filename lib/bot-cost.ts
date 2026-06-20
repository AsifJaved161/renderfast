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

// ─────────────────────────────────────────────────────────────────────────────
// Cost summary — the numbers actually shown in the UI.
// ─────────────────────────────────────────────────────────────────────────────

export interface DateRange {
  from: string // inclusive, YYYY-MM-DD
  to: string // inclusive, YYYY-MM-DD
}

export interface BotCostSummary {
  siteId: string
  range: DateRange
  perBot: { botName: string; requests: number; gb: number; estimatedCostUsd: number }[]
  totals: { requests: number; gb: number; estimatedCostUsd: number }
  // One point per day with traffic — ready for charting.
  timeSeries: { date: string; gb: number; estimatedCostUsd: number }[]
  // Every rate that actually applied to a day in this range (for an accurate
  // disclaimer even when the rate changed mid-range).
  ratesUsed: { ratePerGbUsd: number; effectiveFrom: string; effectiveTo: string | null }[]
  rateSource: string // methodology label from platform_settings
  isEstimate: true // these are estimates, never billed amounts
}

const GB = 1_000_000_000
const round = (n: number, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp

interface RawHistory {
  id: string
  rate_per_gb_usd: number
  effective_from: string
  effective_to: string | null
}

// In-memory rate lookup for a single day. Half-open match:
//   effective_from <= date  AND  (effective_to is null OR date < effective_to)
// Dates are zero-padded YYYY-MM-DD strings, so lexical compare == chronological.
// Returns the matching history row (so the caller can record WHICH rate was used)
// or null when no row covers the day (e.g. a day before any rate existed).
function rateRowForDate(history: RawHistory[], date: string): RawHistory | null {
  for (const r of history) {
    if (r.effective_from <= date && (r.effective_to == null || date < r.effective_to)) return r
  }
  return null
}

// getBotCostSummary — sum traffic per bot + per day, costing EACH day with the
// rate that was effective ON THAT DAY (never a single current rate smeared
// across a range that spans a rate change).
//
// Server-side / admin-internal: uses the service-role client. A client-facing
// route exposing this MUST sit behind requireAdmin() (or scope the figure as a
// read-only estimate per the product decision).
export async function getBotCostSummary(siteId: string, dateRange: DateRange): Promise<BotCostSummary> {
  const { from, to } = dateRange

  // 1) Daily traffic rows for the site in range (already one row per bot+day).
  const { data: trafficRows } = await supabaseAdmin
    .from('bot_traffic_stats')
    .select('bot_name, date, request_count, bytes_served')
    .eq('site_id', siteId)
    .gte('date', from)
    .lte('date', to)

  // 2) Rate history overlapping the range, fetched ONCE. Overlap test:
  //    a row applies if it starts on/before `to` and ends after `from`
  //    (open-ended rows — effective_to null — always pass the end test).
  const { data: histRows } = await supabaseAdmin
    .from('bot_cost_rate_history')
    .select('id, rate_per_gb_usd, effective_from, effective_to')
    .lte('effective_from', to)
    .or(`effective_to.is.null,effective_to.gt.${from}`)
    .order('effective_from', { ascending: false }) // newest first → first lexical match wins

  const history: RawHistory[] = (histRows ?? []).map((r) => ({
    id: r.id,
    rate_per_gb_usd: Number(r.rate_per_gb_usd),
    effective_from: r.effective_from,
    effective_to: r.effective_to,
  }))

  // Source/methodology label (shown in the disclaimer) lives on the current
  // platform_settings snapshot — it's a description of method, not a per-rate
  // value, so the same label applies regardless of which numeric rate was used.
  const current = await getCurrentEstimate()

  // ── Aggregate ────────────────────────────────────────────────────────────────
  // Cost is computed at the DAY granularity (the finest the data has) so each
  // day uses its own effective rate; per-bot and time-series totals are just
  // sums of those per-day costs — guaranteeing they reconcile to the grand total.
  const perBot = new Map<string, { requests: number; bytes: number; cost: number }>()
  const perDay = new Map<string, { bytes: number; cost: number }>()
  const usedRateIds = new Set<string>()
  let totalRequests = 0
  let totalBytes = 0
  let totalCost = 0

  for (const row of trafficRows ?? []) {
    const date: string = row.date
    const requests = Number(row.request_count) || 0
    const bytes = Number(row.bytes_served) || 0

    // Rate effective ON THIS DAY — fall back to the seed rate if (and only if)
    // no history row covers the day, so a figure is still shown.
    const rateRow = rateRowForDate(history, date)
    const rate = rateRow ? rateRow.rate_per_gb_usd : FALLBACK_RATE
    if (rateRow) usedRateIds.add(rateRow.id)

    const cost = (bytes / GB) * rate

    const bot = perBot.get(row.bot_name) ?? { requests: 0, bytes: 0, cost: 0 }
    bot.requests += requests
    bot.bytes += bytes
    bot.cost += cost
    perBot.set(row.bot_name, bot)

    const day = perDay.get(date) ?? { bytes: 0, cost: 0 }
    day.bytes += bytes
    day.cost += cost
    perDay.set(date, day)

    totalRequests += requests
    totalBytes += bytes
    totalCost += cost
  }

  // ── Shape the response ───────────────────────────────────────────────────────
  const perBotArr = Array.from(perBot.entries())
    .map(([botName, v]) => ({
      botName,
      requests: v.requests,
      gb: round(v.bytes / GB),
      estimatedCostUsd: round(v.cost),
    }))
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd)

  const timeSeries = Array.from(perDay.entries())
    .map(([date, v]) => ({ date, gb: round(v.bytes / GB), estimatedCostUsd: round(v.cost) }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // Only the rates that actually applied to a costed day (handles a mid-range
  // change → two entries; the frontend can render an accurate multi-rate note).
  const ratesUsed = history
    .filter((r) => usedRateIds.has(r.id))
    .map((r) => ({ ratePerGbUsd: r.rate_per_gb_usd, effectiveFrom: r.effective_from, effectiveTo: r.effective_to }))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))

  return {
    siteId,
    range: { from, to },
    perBot: perBotArr,
    totals: { requests: totalRequests, gb: round(totalBytes / GB), estimatedCostUsd: round(totalCost) },
    timeSeries,
    ratesUsed,
    rateSource: current.rate_source,
    isEstimate: true,
  }
}
