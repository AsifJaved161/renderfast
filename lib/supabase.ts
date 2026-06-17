import { createServerClient as createSsrServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// ── Cookie-bound server client (proper @supabase/ssr session handling) ────────
// Next 15+/16: cookies() is async, so this helper is async and must be awaited.
export async function createServerSupabase() {
  const cookieStore = await cookies()
  return createSsrServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          // Writable in Route Handlers / Server Actions; throws in RSC — ignore.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

// Backwards-compatible alias: existing callers across the app import
// `createServerClient` from this module. Keep it pointed at the new helper.
export const createServerClient = createServerSupabase

// ── Service-role admin client (bypasses RLS — server-only, never expose) ──────
// Lazily constructed via a Proxy so the client is only created at runtime, never
// during `next build` page-data collection (where env vars may be absent).
function buildSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  )
}
type AdminClient = ReturnType<typeof buildSupabaseAdmin>

let _supabaseAdmin: AdminClient | null = null
function getSupabaseAdmin(): AdminClient {
  if (!_supabaseAdmin) _supabaseAdmin = buildSupabaseAdmin()
  return _supabaseAdmin
}

export const supabaseAdmin = new Proxy({} as AdminClient, {
  get(_target, prop) {
    const client = getSupabaseAdmin()
    const value = Reflect.get(client as object, prop)
    return typeof value === 'function' ? value.bind(client) : value
  },
})

// ══════════════════════════════════════════════════════════════════════════════
// Database types
// ══════════════════════════════════════════════════════════════════════════════
export type Plan = 'free' | 'starter' | 'pro' | 'agency'
export type SiteStatus = 'active' | 'inactive' | 'pending'
export type IntegrationType = 'script' | 'middleware' | 'worker' | 'nginx' | 'dns' | 'wordpress'
export type BotType = 'search' | 'ai' | 'social' | 'unknown'
export type SitemapStatus = 'active' | 'paused' | 'error'
export type QueueStatus = 'pending' | 'rendering' | 'completed' | 'failed'

export interface DbUser {
  id: string
  email: string
  full_name: string | null
  company_name: string | null
  avatar_url: string | null
  plan: Plan
  render_count: number
  render_limit: number
  api_key: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  notification_email: boolean
  monthly_reset_at: string
  created_at: string
  updated_at: string
}

export interface DbSite {
  id: string
  user_id: string
  domain: string
  name: string | null
  integration_type: IntegrationType | null
  status: SiteStatus
  render_count: number
  created_at: string
  updated_at: string
}

export interface DbRender {
  id: string
  site_id: string
  user_id: string
  url: string
  bot_name: string | null
  bot_type: BotType | null
  status_code: number | null
  render_time_ms: number | null
  cache_hit: boolean
  user_agent: string | null
  ip_address: string | null
  created_at: string
}

export interface DbBotVisit {
  id: string
  site_id: string
  url: string
  bot_name: string | null
  bot_type: BotType | null
  user_agent: string | null
  ip_address: string | null
  served_markdown: boolean
  created_at: string
}

export interface DbSitemap {
  id: string
  user_id: string
  site_id: string
  sitemap_url: string
  last_crawled_at: string | null
  urls_found: number
  status: SitemapStatus
  created_at: string
}

export interface DbCacheEntry {
  id: string
  site_id: string
  user_id: string
  url: string
  url_hash: string
  status_code: number | null
  html_size_bytes: number | null
  render_time_ms: number | null
  cached_at: string
  expires_at: string | null
  is_mobile: boolean
}

export interface DbCachingQueue {
  id: string
  site_id: string
  user_id: string
  url: string
  priority: number
  status: QueueStatus
  error_message: string | null
  attempts: number
  created_at: string
  completed_at: string | null
}

export interface DbBrokenLink {
  id: string
  site_id: string
  url: string
  source_url: string | null
  status_code: number | null
  detected_at: string
  resolved: boolean
}
