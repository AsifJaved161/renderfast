/**
 * RenderForAI — Cloudflare Worker integration.
 *
 * Deploy this in front of your site (Workers Route on your zone). It serves
 * prerendered HTML from RenderForAI to search/AI crawlers and passes real users
 * straight through to your origin.
 *
 *   1. npm i -g wrangler
 *   2. Set PRERENDER_TOKEN below to your RenderForAI API key.
 *   3. wrangler deploy  (route: example.com/*)
 */

// Point at the RenderForAI EDGE worker — it serves cache hits from KV at the
// edge (~5–30 ms) and only falls back to the Vercel render endpoint on a miss.
// (Plain Vercel still works too: https://renderforai.com/api/proxy)
const PRERENDER_ORIGIN = 'https://edge.renderforai.com'
const PRERENDER_TOKEN = 'YOUR_API_KEY' // ← your RenderForAI API key

// Search engines + AI crawlers + social unfurlers.
const BOT_UA =
  /bot|crawl|spider|googlebot|bingbot|duckduckbot|yandex|baidu|sogou|exabot|gptbot|oai-searchbot|chatgpt-user|claudebot|anthropic|perplexitybot|amazonbot|applebot|facebookexternalhit|twitterbot|linkedinbot|slackbot|telegrambot|whatsapp|discordbot|pinterest/i

// Skip static assets — only HTML page requests get prerendered.
const STATIC =
  /\.(js|mjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|json|xml|txt|pdf|mp4|webm|zip)$/i

export default {
  async fetch(request: Request): Promise<Response> {
    const ua = request.headers.get('user-agent') || ''
    const url = new URL(request.url)

    const isBot =
      request.method === 'GET' && BOT_UA.test(ua) && !STATIC.test(url.pathname)

    if (isBot) {
      try {
        const proxied = `${PRERENDER_ORIGIN}?url=${encodeURIComponent(request.url)}`
        const res = await fetch(proxied, {
          headers: { 'User-Agent': ua, 'X-Prerender-Token': PRERENDER_TOKEN },
          redirect: 'manual',
        })
        const type = res.headers.get('content-type') || ''
        if (res.status === 200 && (type.includes('text/html') || type.includes('text/markdown'))) {
          return new Response(res.body, {
            status: 200,
            headers: { 'content-type': type, 'x-prerendered': 'renderforai' },
          })
        }
      } catch {
        // fall through to origin on any error
      }
    }

    return fetch(request)
  },
}
