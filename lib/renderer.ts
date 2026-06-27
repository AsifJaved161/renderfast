// Cloudflare Browser Rendering API — no local browser process, no RAM pool.
import TurndownService from 'turndown'
import { getCloudflareConfig, getOpsConfig } from '@/lib/app-config'

export interface RenderResult {
  html: string
  renderTimeMs: number
  statusCode: number
  error?: string
  notConfigured?: boolean // Cloudflare creds absent — caller must NOT cache/bill
}

// Cloudflare is "configured" when we have a token AND either an account id
// (to build the default endpoint) or an explicit endpoint override.
function configured(cf: { apiToken: string; accountId: string; browserRenderingUrl: string }): boolean {
  return !!cf.apiToken && (!!cf.accountId || !!cf.browserRenderingUrl)
}

// True once real rendering is set up. Used to avoid billing quota / storing
// misleading diagnostics for stub renders when Cloudflare isn't configured yet.
export async function isRenderConfigured(): Promise<boolean> {
  return configured(await getCloudflareConfig())
}

// Per-render overrides (from per-site advanced settings). All optional.
export interface RenderOptions {
  isMobile?: boolean
  userAgent?: string
  headers?: Record<string, string>
  blockUrlPatterns?: string[] // URL fragments/regex to block while rendering
}

export async function renderPage(url: string, opts: RenderOptions = {}): Promise<RenderResult> {
  const isMobile = !!opts.isMobile
  const cf = await getCloudflareConfig()

  // ── Cloudflare not configured ────────────────────────────────────────────────
  // Return a clean error (NOT a stub page). A stub looked like a successful
  // render, so callers cached it in KV and billed a render — poisoning the cache
  // with a "not configured" page if creds were ever missing/lapsed. With an error
  // every caller's `if (error || !html)` branch already does the safe thing:
  // proxy 302s the bot to origin, the queue marks the item failed, the API 503s.
  if (!configured(cf)) {
    return {
      html: '',
      renderTimeMs: 0,
      statusCode: 503,
      error: 'Rendering not configured',
      notConfigured: true,
    }
  }

  const contentUrl =
    cf.browserRenderingUrl ||
    `https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/browser-rendering/content`

  // Admin-configurable navigation timeout + resource blocking (cached; shares
  // the CF-config DB read).
  const { renderTimeoutMs, blockResources } = await getOpsConfig()

  const start = Date.now()
  try {
    const res = await fetch(contentUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cf.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        // Cloudflare expects navigation options nested under gotoOptions —
        // a top-level `waitUntil` is rejected as an unrecognized key.
        // networkidle2 (tolerates ≤2 lingering connections) instead of
        // networkidle0 — many real pages keep analytics/ads/websocket sockets
        // open and would otherwise hang until timeout. 30s cap fails fast.
        gotoOptions: { waitUntil: 'networkidle2', timeout: renderTimeoutMs },
        // Skip downloading images/fonts/media → faster, cheaper renders. Admin
        // can disable if a site needs them (e.g. lazy-load depends on images).
        ...(blockResources ? { rejectResourceTypes: ['image', 'font', 'media'] } : {}),
        // Per-site overrides: custom UA, extra headers, and blocked URL patterns
        // (e.g. ad/analytics scripts) — passed through to the Cloudflare renderer.
        ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
        ...(opts.headers && Object.keys(opts.headers).length ? { setExtraHTTPHeaders: opts.headers } : {}),
        ...(opts.blockUrlPatterns && opts.blockUrlPatterns.length
          ? { rejectRequestPattern: opts.blockUrlPatterns }
          : {}),
        viewport: isMobile
          ? { width: 390, height: 844, isMobile: true }
          : { width: 1280, height: 800 },
      }),
    })

    const renderTimeMs = Date.now() - start
    const data = await res.json().catch(() => null)

    if (!res.ok || !data?.success) {
      return {
        html: '',
        renderTimeMs,
        statusCode: res.status || 500,
        error: data?.errors?.[0]?.message || 'render failed',
      }
    }

    const rawHtml: string = data.result ?? ''
    return { html: cleanHtml(rawHtml, url), renderTimeMs, statusCode: 200 }
  } catch (err) {
    return {
      html: '',
      renderTimeMs: Date.now() - start,
      statusCode: 500,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ── DOM cleanup: strip scripts/iframes/handlers, inject <base> ────────────────
function cleanHtml(html: string, url: string): string {
  let out = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    // remove inline event handlers (onclick, onload, …)
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')

  const baseTag = `<base href="${url.replace(/"/g, '%22')}">`
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`)
  } else {
    out = baseTag + out
  }
  return out
}

// ── HTML → Markdown for AI bots ───────────────────────────────────────────────
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html)
}
