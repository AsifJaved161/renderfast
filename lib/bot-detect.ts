// Canonical bot detection lives in ./botDetect — this module re-exports it under
// the hyphenated path used across the codebase so both imports resolve to one
// source of truth (Googlebot, Bingbot, GPTBot, ClaudeBot, PerplexityBot,
// Twitterbot, facebookexternalhit, LinkedInBot, Applebot, and many more).
export { detectBot, isBotUserAgent } from './botDetect'
export type { BotInfo, BotType } from './botDetect'
