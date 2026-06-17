import type { Plan } from '@/lib/supabase'

export const APP_NAME = 'RenderFast'
export const BRAND_COLOR = '#2da01d'

// ── Operational limits ────────────────────────────────────────────────────────
export const SITEMAP_CRAWL_LIMIT = 10000 // max URLs queued per sitemap
export const CACHE_TTL_DEFAULT = 86400 // 24h in seconds
export const RATE_LIMIT_WINDOW = 60 // seconds
export const RATE_LIMIT_MAX = 100 // requests per window

export interface PlanLimits {
  renders: number
  sites: number // Infinity = unlimited
  cacheSize: string
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { renders: 1000, sites: 1, cacheSize: '100MB' },
  starter: { renders: 25000, sites: 3, cacheSize: '1GB' },
  pro: { renders: 200000, sites: 10, cacheSize: '10GB' },
  agency: { renders: 1000000, sites: Infinity, cacheSize: '100GB' },
}

// Maps a user-agent substring to a high-level bot category.
export const BOT_CATEGORIES: Record<string, 'search' | 'ai' | 'social' | 'seo'> = {
  googlebot: 'search',
  bingbot: 'search',
  duckduckbot: 'search',
  yandexbot: 'search',
  baiduspider: 'search',
  slurp: 'search',
  gptbot: 'ai',
  'chatgpt-user': 'ai',
  claudebot: 'ai',
  'anthropic-ai': 'ai',
  perplexitybot: 'ai',
  'meta-externalagent': 'ai',
  bytespider: 'ai',
  facebookexternalhit: 'social',
  twitterbot: 'social',
  linkedinbot: 'social',
  slackbot: 'social',
  discordbot: 'social',
  whatsapp: 'social',
  ahrefsbot: 'seo',
  semrushbot: 'seo',
  mj12bot: 'seo',
  dotbot: 'seo',
}
