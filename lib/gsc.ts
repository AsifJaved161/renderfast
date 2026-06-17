// ─────────────────────────────────────────────────────────────────────────────
// Google Search Console — OAuth 2.0 + Search Analytics helpers.
// Pure fetch(), no googleapis dependency. The OAuth client credentials come from
// env (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI).
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseAdmin } from '@/lib/supabase'

function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

export const GOOGLE_CLIENT_ID = () => env('GOOGLE_CLIENT_ID')
export const GOOGLE_CLIENT_SECRET = () => env('GOOGLE_CLIENT_SECRET')
export const GOOGLE_REDIRECT_URI = () => env('GOOGLE_OAUTH_REDIRECT_URI')

// Read-only Search Console + basic identity (to show which account is linked).
const SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'openid',
  'email',
].join(' ')

// True once the OAuth client is configured. Endpoints 503 cleanly otherwise.
export function isGscConfigured(): boolean {
  return !!GOOGLE_CLIENT_ID() && !!GOOGLE_CLIENT_SECRET() && !!GOOGLE_REDIRECT_URI()
}

// ── OAuth: consent URL ───────────────────────────────────────────────────────
// access_type=offline + prompt=consent → Google returns a refresh_token.
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID(),
    redirect_uri: GOOGLE_REDIRECT_URI(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type?: string
}

// ── OAuth: exchange authorization code for tokens ────────────────────────────
export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID(),
      client_secret: GOOGLE_CLIENT_SECRET(),
      redirect_uri: GOOGLE_REDIRECT_URI(),
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// ── OAuth: refresh an expired access token ───────────────────────────────────
async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID(),
      client_secret: GOOGLE_CLIENT_SECRET(),
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// Fetch the linked Google account email (for display).
export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const d = await res.json()
    return d.email ?? null
  } catch {
    return null
  }
}

// ── Persist a connection (one per user) ──────────────────────────────────────
export async function saveConnection(
  userId: string,
  tokens: TokenResponse,
  email: string | null
) {
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()
  await supabaseAdmin.from('gsc_connections').upsert(
    {
      user_id: userId,
      google_email: email,
      access_token: tokens.access_token,
      // Google omits refresh_token on re-consent sometimes — keep the old one then.
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      token_expires_at: expiresAt,
      scope: tokens.scope ?? SCOPES,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )
}

interface Connection {
  user_id: string
  google_email: string | null
  access_token: string
  refresh_token: string | null
  token_expires_at: string | null
}

export async function getConnection(userId: string): Promise<Connection | null> {
  const { data } = await supabaseAdmin
    .from('gsc_connections')
    .select('user_id, google_email, access_token, refresh_token, token_expires_at')
    .eq('user_id', userId)
    .maybeSingle()
  return (data as Connection) ?? null
}

export async function deleteConnection(userId: string) {
  await supabaseAdmin.from('gsc_connections').delete().eq('user_id', userId)
}

// Return a valid access token, refreshing (and persisting) if it has expired.
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const conn = await getConnection(userId)
  if (!conn) return null

  const expMs = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0
  if (expMs - 60_000 > Date.now()) return conn.access_token // still valid (60s buffer)

  if (!conn.refresh_token) return null
  const refreshed = await refreshAccessToken(conn.refresh_token)
  await supabaseAdmin
    .from('gsc_connections')
    .update({
      access_token: refreshed.access_token,
      token_expires_at: new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
  return refreshed.access_token
}

// ── Search Console API ───────────────────────────────────────────────────────
interface GscProperty {
  siteUrl: string
  permissionLevel: string
}

// List the verified properties on the linked account.
export async function listProperties(accessToken: string): Promise<GscProperty[]> {
  const res = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return []
  const d = await res.json()
  return (d.siteEntry ?? []) as GscProperty[]
}

// Find the property that matches a site domain (prefers a sc-domain property).
export function matchProperty(properties: GscProperty[], domain: string): string | null {
  const bare = domain.toLowerCase().replace(/^www\./, '')
  const usable = properties.filter((p) => p.permissionLevel !== 'siteUnverifiedUser')
  const candidates = [
    `sc-domain:${bare}`,
    `https://${bare}/`,
    `https://www.${bare}/`,
    `http://${bare}/`,
    `http://www.${bare}/`,
  ]
  for (const c of candidates) {
    const hit = usable.find((p) => p.siteUrl.toLowerCase() === c)
    if (hit) return hit.siteUrl
  }
  return null
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

interface QueryRow {
  keys?: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

async function queryAnalytics(
  accessToken: string,
  property: string,
  body: Record<string, unknown>
): Promise<QueryRow[]> {
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  if (!res.ok) throw new Error(`searchAnalytics failed: ${res.status} ${await res.text()}`)
  const d = await res.json()
  return (d.rows ?? []) as QueryRow[]
}

export interface GscMetrics {
  property: string
  totals: { clicks: number; impressions: number; ctr: number; position: number }
  timeline: { date: string; clicks: number; impressions: number }[]
  topQueries: { query: string; clicks: number; impressions: number; ctr: number; position: number }[]
  topPages: { page: string; clicks: number; impressions: number; ctr: number; position: number }[]
}

// Pull a 28-day performance summary for a property.
export async function fetchMetrics(accessToken: string, property: string): Promise<GscMetrics> {
  const end = new Date()
  const start = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
  const range = { startDate: fmtDate(start), endDate: fmtDate(end) }

  const [totalRows, dateRows, queryRows, pageRows] = await Promise.all([
    queryAnalytics(accessToken, property, { ...range }),
    queryAnalytics(accessToken, property, { ...range, dimensions: ['date'] }),
    queryAnalytics(accessToken, property, { ...range, dimensions: ['query'], rowLimit: 10 }),
    queryAnalytics(accessToken, property, { ...range, dimensions: ['page'], rowLimit: 10 }),
  ])

  const t = totalRows[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 }
  return {
    property,
    totals: {
      clicks: t.clicks,
      impressions: t.impressions,
      ctr: Math.round(t.ctr * 10000) / 100, // → %
      position: Math.round(t.position * 10) / 10,
    },
    timeline: dateRows.map((r) => ({
      date: r.keys?.[0] ?? '',
      clicks: r.clicks,
      impressions: r.impressions,
    })),
    topQueries: queryRows.map((r) => ({
      query: r.keys?.[0] ?? '',
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: Math.round(r.ctr * 10000) / 100,
      position: Math.round(r.position * 10) / 10,
    })),
    topPages: pageRows.map((r) => ({
      page: r.keys?.[0] ?? '',
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: Math.round(r.ctr * 10000) / 100,
      position: Math.round(r.position * 10) / 10,
    })),
  }
}
