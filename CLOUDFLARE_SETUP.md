# Cloudflare Setup — RenderFast

Project iske **bina bhi chalta hai** (renderer ek dev-stub HTML deta hai, cache no-op).
Neeche ke **3 env vars set karte hi** real rendering + KV cache + Render Diagnostics
(content-diff wala part) apne-aap on ho jate hain. Koi code change nahi chahiye.

---

## Kya add karna hai (sirf 3 cheezen)

| Env var | Kis liye | Kahan use hota hai |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Account identify karne ke liye | `lib/renderer.ts`, `lib/kv.ts` |
| `CLOUDFLARE_API_TOKEN`  | Rendering + KV ka access | dono |
| `CLOUDFLARE_KV_NAMESPACE_ID` | Cache storage (rendered HTML) | `lib/kv.ts` |

> `CLOUDFLARE_BROWSER_RENDERING_URL` **optional** hai — khali chhod do, default endpoint
> automatically ban jata hai.

---

## Step 1 — Account ID

1. https://dash.cloudflare.com par login karo.
2. Right sidebar / URL me se **Account ID** copy karo.
   (URL aisa hota hai: `dash.cloudflare.com/<yahi-account-id>/...`)
3. Ye `CLOUDFLARE_ACCOUNT_ID` me daalna hai.

## Step 2 — KV Namespace banao (cache)

1. Dashboard → **Storage & Databases → KV** → **Create namespace**.
2. Naam koi bhi rakho, e.g. `renderfast-cache`.
3. Ban jane ke baad uska **Namespace ID** copy karo → `CLOUDFLARE_KV_NAMESPACE_ID`.

## Step 3 — API Token banao

1. Dashboard → top-right profile → **My Profile → API Tokens** →
   **Create Token → Create Custom Token**.
2. **Permissions** (3 rows add karo):
   - `Account` → **Browser Rendering** → **Edit**
   - `Account` → **Workers KV Storage** → **Edit**
   - (optional) `Account` → **Account Settings** → **Read**
3. **Account Resources**: apna account select karo.
4. **Create Token** → token **ek hi baar dikhega**, copy karke `CLOUDFLARE_API_TOKEN` me daalo.

> ⚠️ **Browser Rendering** ek paid/limited feature ho sakti hai — apne plan me enable
> hai ya nahi confirm kar lena (Workers & Pages → Browser Rendering). Free me daily
> limit hoti hai, testing ke liye kaafi hai.

---

## Step 4 — Env vars kahan paste karna hai

### Local (`.env.local`)
```env
CLOUDFLARE_ACCOUNT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CLOUDFLARE_API_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CLOUDFLARE_KV_NAMESPACE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# CLOUDFLARE_BROWSER_RENDERING_URL=   # khali rehne do
```

### Vercel (production)
Settings → **Environments → Production → Environment Variables** me wahi 3 keys add karo →
phir **Redeploy**. (Whitespace/trailing newline na aaye — code trim karta hai, par dhyan rahe.)

---

## Verify (Cloudflare laga lene ke baad)

1. Local: `npm run dev`, phir:
   ```bash
   curl -H "User-Agent: Googlebot" \
     "http://localhost:3000/api/proxy?url=https://example.com/"
   ```
   - Response me **real rendered HTML** aana chahiye (stub note nahi),
     header `X-Cache-Status: MISS` (dobara chalane par `HIT`).
2. Dashboard → **SEO Insights** / **Cache Manager**: ab real pages + content checks dikhenge.
3. **Render Diagnostics** content-diff + SEO-missing data bharne lagega.

---

## Part 1 diagnostics (console / network errors) — BAAD me, optional

Abhi renderer Cloudflare ka **REST `/content`** endpoint use karta hai — usme browser ke
`console` / `requestfailed` events **nahi** aate, isliye `console_errors` aur
`failed_requests` khali rahenge (content-diff + SEO wala part poora chalta hai).

Inhe bharna ho to render **Playwright/Puppeteer** se karna padega (e.g. Cloudflare Worker
ka Browser Rendering Puppeteer binding, `worker/` me). Module already taiyaar hai:

```ts
import { attachPlaywrightListeners, captureDiagnostics } from '@/lib/diagnostics'

const collect = attachPlaywrightListeners(page)   // page.goto() se PEHLE
// … render / page.goto(url) …
captureDiagnostics({
  siteId, url, renderedHtml: html, renderTimeMs,
  signals: collect(),                              // ab console/network errors bhi save honge
})
```

Tab tak kuch karne ki zaroorat nahi — REST renderer ke saath baaki sab kaam karta hai.

---

## Module on/off
`RENDER_DIAGNOSTICS=off` set karne se poora diagnostics module band ho jata hai
(core render flow pe koi asar nahi).
```
