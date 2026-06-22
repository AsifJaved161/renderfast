// ─────────────────────────────────────────────────────────────────────────────
// Smart cache revalidation — detect whether an origin page actually changed
// WITHOUT rendering it. A render is the expensive resource; a conditional GET +
// content fingerprint is nearly free. So we only re-render when content changed.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto'

const UA = 'RenderForAIBot/1.0 (+https://renderforai.com)'
const TIMEOUT_MS = 12_000

// KV keeps a page this long as a safety net; real freshness is driven by
// change-detection (originChanged), not this timer.
export const HARD_CACHE_TTL = 30 * 86400

export interface Validators {
  etag: string | null
  last_modified: string | null
  content_hash: string | null
}

// Visible text only — ignores scripts/styles/markup so per-request noise
// (nonces, CSRF tokens, timestamps) doesn't look like a content change.
function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Fingerprint = title + meta description + visible text. Changes only when the
// page's real content / key SEO tags change.
export function fingerprint(html: string): string {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim()
  const desc =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? ''
  return crypto.createHash('sha1').update(`${title}\n${desc}\n${visibleText(html)}`).digest('hex')
}

// Fetch the origin once (cheap, no render) and capture validators for next time.
export async function captureValidators(url: string): Promise<Validators | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    const body = await res.text()
    return {
      etag: res.headers.get('etag'),
      last_modified: res.headers.get('last-modified'),
      content_hash: fingerprint(body),
    }
  } catch {
    return null
  }
}

// Has the origin page changed since we cached it?
//   false → unchanged (skip the render, just extend the cache)
//   true  → changed (re-render)
//   null  → couldn't tell (origin error/timeout) — caller decides
export async function originChanged(url: string, v: Validators): Promise<boolean | null> {
  try {
    const headers: Record<string, string> = { 'User-Agent': UA }
    if (v.etag) headers['If-None-Match'] = v.etag
    if (v.last_modified) headers['If-Modified-Since'] = v.last_modified

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.status === 304) return false // origin says: not modified
    if (!res.ok) return null
    const body = await res.text()
    if (v.content_hash) return fingerprint(body) !== v.content_hash
    return true // nothing to compare against → treat as changed
  } catch {
    return null
  }
}
