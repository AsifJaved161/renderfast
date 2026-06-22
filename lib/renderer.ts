// Cloudflare Browser Rendering API — no local browser process, no RAM pool.
import TurndownService from 'turndown'
import { getCloudflareConfig, getOpsConfig } from '@/lib/app-config'

export interface RenderResult {
  html: string
  renderTimeMs: number
  statusCode: number
  error?: string
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

export async function renderPage(url: string, isMobile = false): Promise<RenderResult> {
  const cf = await getCloudflareConfig()

  // ── Dev fallback (Cloudflare not configured) ─────────────────────────────────
  // Only used when Cloudflare creds are absent, so local/dev work doesn't 500.
  // In production with Cloudflare configured this branch never runs.
  if (!configured(cf)) {
    const stubHtml = `<!DOCTYPE html>
<html>
<head><title>RenderForAI (not configured) - ${url}</title><base href="${url}"></head>
<body>
  <h1>RenderForAI — rendering not configured</h1>
  <p>URL: ${url}</p>
  <p>Set the Cloudflare account ID and API token to enable real rendering.</p>
</body>
</html>`
    return { html: stubHtml, renderTimeMs: 50, statusCode: 200 }
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

  const baseTag = `<base href="${url}">`
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
