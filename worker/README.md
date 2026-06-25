# RenderForAI Workers

Two separate Cloudflare Workers live here:

| File | Runs on | Purpose |
|------|---------|---------|
| `index.ts` | **Customer's** CF account (their zone) | Thin integration template a customer deploys in front of their site. Detects bots, forwards them to RenderForAI, passes humans to origin. |
| `edge.ts` | **RenderForAI's** CF account | Edge cache server. Reads the prerendered snapshot from KV at the edge and serves it in ~5–30 ms. Falls back to Vercel on a miss. |

## Why the edge worker exists

Serving a cache **HIT** used to go: bot → Vercel → Supabase ×2 → Cloudflare KV
**REST API** (+ serverless cold start) ≈ hundreds–2000+ ms. `edge.ts` has a
**native KV binding**, so a hit is read in the same datacenter as the bot and
served without ever touching Vercel — that's the "we serve bots instantly"
number. A miss / markdown / any error falls back to the Vercel render endpoint,
so behaviour is never worse than before.

> **Why a separate worker?** A KV binding is account-scoped. The customer's
> worker (on *their* account) can't bind to *our* KV namespace, so the edge
> cache must run on the account that owns the namespace.

## Deploy the edge worker (RenderForAI account)

```bash
cd worker
wrangler kv namespace list          # copy the id of the pages KV namespace
#   → paste it into wrangler.toml as [[kv_namespaces]] id
wrangler deploy                     # uses wrangler.toml (main = edge.ts)
```

Then map it to a stable hostname (e.g. `edge.renderforai.com`) via a Workers
route or custom domain in the Cloudflare dashboard. `vars` in `wrangler.toml`
(`RENDER_ORIGIN`, `BEACON_URL`) already point at the Vercel endpoints.

## Customer integration

`index.ts` (`PRERENDER_ORIGIN`) now points at `https://edge.renderforai.com`.
Nothing else changes for customers — the request interface is identical to
`/api/proxy`. Cache hits are simply faster.

## How it stays consistent

`edge.ts` re-implements `normalizeUrl` (from `lib/url-utils.ts`) and the KV key
format `\${domain}:\${sha256(url)}` + deflate-raw decompression (from `lib/kv.ts`)
**exactly**, so the key it computes matches what the render pipeline stored. If
that ever drifts, the worker just gets a miss and falls back — it never serves a
wrong or corrupt page. Edge-served hits are logged via the `/api/cache-hit`
beacon so the dashboard keeps counting them.
