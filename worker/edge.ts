/**
 * RenderForAI — EDGE CACHE Worker (runs on RenderForAI's own Cloudflare account).
 *
 * Why this exists: serving a cache HIT used to round-trip Bot → Vercel →
 * Supabase ×2 → Cloudflare KV REST API (+ cold start) = ~hundreds–2000+ ms.
 * This Worker sits at the edge with a NATIVE KV binding, so a cache HIT is read
 * straight from KV in the same datacenter as the bot (~5–30 ms) and served
 * without ever touching Vercel. That is the "we serve bots instantly" number.
 *
 * Anything that ISN'T a plain HTML cache hit (miss, markdown, non-bot, error)
 * falls back to the existing Vercel render endpoint — so behaviour degrades
 * gracefully and is never worse than today.
 *
 * Interface: identical to /api/proxy — `GET /?url=<target>` with headers
 * `X-Prerender-Token: <api key>` and the bot's `User-Agent`. The customer-facing
 * Worker (worker/index.ts) points at THIS worker instead of Vercel directly.
 *
 * Requires (see worker/wrangler.toml):
 *   • KV binding `CACHE` → the SAME namespace the render pipeline writes to.
 *   • var RENDER_ORIGIN → Vercel render endpoint (e.g. https://renderforai.com/api/proxy)
 *   • var BEACON_URL    → analytics beacon (e.g. https://renderforai.com/api/cache-hit)
 */

export interface Env {
  CACHE: KVNamespace
  RENDER_ORIGIN: string
  BEACON_URL: string
}

const BOT_UA =
  /bot|crawl|spider|googlebot|bingbot|duckduckbot|yandex|baidu|sogou|exabot|gptbot|oai-searchbot|chatgpt-user|claudebot|anthropic|perplexitybot|amazonbot|applebot|facebookexternalhit|twitterbot|linkedinbot|slackbot|telegrambot|whatsapp|discordbot|pinterest/i

// Must mirror lib/url-utils.ts → normalizeUrl (same tracking params + ordering)
// so the cache key computed here matches the one the render pipeline stored.
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name', 'utm_reader',
  'gclid', 'gclsrc', 'dclid', 'fbclid', 'msclkid', 'wbraid', 'gbraid', 'yclid', 'twclid',
  'mc_cid', 'mc_eid', '_ga', '_gl', 'igshid', 'si', 'ref', 'ref_src', 'ref_url', 'source',
  'spm', 'scm', 'vero_id', 'vero_conv', 'oly_anon_id', 'oly_enc_id', 'hsa_cam', 'hsa_grp',
  'amp', 'noamp',
])

function normalizeUrl(input: string): string {
  try {
    const u = new URL(input)
    u.hash = ''
    const keep: [string, string][] = []
    u.searchParams.forEach((v, k) => {
      if (!TRACKING_PARAMS.has(k.toLowerCase())) keep.push([k, v])
    })
    keep.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    u.search = ''
    for (const [k, v] of keep) u.searchParams.append(k, v)
    return u.toString().replace(/\?$/, '')
  } catch {
    return input
  }
}

// Must mirror lib/kv.ts → pageKey: `${domain}:${sha256(url)}` (hex, lowercase).
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Must mirror lib/kv.ts → decompress (deflate-raw).
async function decompress(bytes: ArrayBuffer): Promise<string> {
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Everything we can't fast-path is forwarded to the Vercel render endpoint
    // unchanged — same request, same response.
    const fallback = () => fetch(new Request(buildRenderUrl(request, env), request))

    try {
      const reqStart = Date.now()
      const reqUrl = new URL(request.url)
      const target = reqUrl.searchParams.get('url')
      const ua = request.headers.get('user-agent') || ''
      const accept = request.headers.get('accept') || ''

      // Only plain HTML cache hits for real bots are served at the edge. Markdown
      // (AI bots) needs server-side HTML→MD conversion, so it falls back.
      const wantsMarkdown = accept.includes('text/markdown')
      if (request.method !== 'GET' || !target || !BOT_UA.test(ua) || wantsMarkdown) {
        return fallback()
      }

      const parsed = new URL(target)
      const key = `${parsed.hostname}:${await sha256(normalizeUrl(target))}`

      const cached = await env.CACHE.get(key, { type: 'arrayBuffer' })
      if (!cached) return fallback() // MISS → let Vercel render + store

      let html: string
      try {
        html = await decompress(cached)
      } catch {
        return fallback() // corrupt/unexpected value → never serve garbage
      }

      const serveMs = Date.now() - reqStart
      const bytes = new TextEncoder().encode(html).length

      // Fire-and-forget analytics so the dashboard still counts edge-served hits,
      // without making the bot wait for it.
      if (env.BEACON_URL) {
        const token = request.headers.get('x-prerender-token') || request.headers.get('x-api-key') || ''
        ctx.waitUntil(
          fetch(env.BEACON_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: target, ua, token, serveMs, bytes }),
          }).catch(() => {})
        )
      }

      return new Response(html, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'x-cache-status': 'EDGE-HIT',
          'x-prerendered': 'renderforai',
          'x-robots-tag': 'noindex',
        },
      })
    } catch {
      // Any unexpected failure → behave exactly like the current proxy.
      return fallback()
    }
  },
}

function buildRenderUrl(request: Request, env: Env): string {
  const incoming = new URL(request.url)
  const origin = new URL(env.RENDER_ORIGIN)
  // Preserve the ?url=<target> query the render endpoint expects.
  origin.search = incoming.search
  return origin.toString()
}
