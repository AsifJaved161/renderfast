# RenderForAI — Free Test Deployment Guide

## Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "Initial RenderForAI commit"
git remote add origin https://github.com/YOUR_USERNAME/renderforai.git
git push -u origin main
```

## Step 2: Supabase Setup (Free Tier)
1. Create project at supabase.com (free)
2. Go to SQL Editor → run supabase/schema.sql
3. Run supabase/schema_admin.sql
4. (Existing databases only) run supabase/migrations/001_integration_types.sql
5. Go to Authentication → URL Configuration:
   - Site URL: https://YOUR_VERCEL_URL.vercel.app
   - Redirect URLs: https://YOUR_VERCEL_URL.vercel.app/api/auth/callback
5. Copy: Project URL, anon key, service_role key

## Step 3: Cloudflare Setup
OPTION A (Free — dev fallback, no real rendering):
- Skip Cloudflare entirely for now
- Leave the CLOUDFLARE_* vars empty
- A clearly-labelled "not configured" placeholder HTML is returned so the rest of
  the app (domain add, cache, queue, analytics) is fully testable end-to-end.

OPTION B ($5/mo — Real rendering):
1. Add Cloudflare Workers Paid plan ($5/mo)
2. Create KV namespace: Workers & Pages → KV → Create namespace "renderforai-cache" → copy its ID
3. Create API token: Profile → API Tokens → Custom Token:
   Permissions: Workers KV Storage (Edit), Browser Rendering (Read)
4. Copy Account ID (from any Cloudflare dashboard URL)

> **Real rendering turns on automatically** once `CLOUDFLARE_ACCOUNT_ID` and
> `CLOUDFLARE_API_TOKEN` are set — the content endpoint is derived from the account id:
> `https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/browser-rendering/content`.
> `CLOUDFLARE_BROWSER_RENDERING_URL` is an **optional** override; leave it empty otherwise.
> Set `CLOUDFLARE_KV_NAMESPACE_ID` too so cached HTML is stored/served.

## Step 4: Deploy to Vercel (Free)
1. Go to vercel.com → New Project → Import from GitHub
2. Framework: Next.js (auto-detected)
3. Environment Variables — add ALL of these:

REQUIRED (app won't start / links break without these):
```
NEXT_PUBLIC_SUPABASE_URL=          (from Supabase)
NEXT_PUBLIC_SUPABASE_ANON_KEY=     (from Supabase)
SUPABASE_SERVICE_ROLE_KEY=         (from Supabase)
NEXT_PUBLIC_SITE_URL=              (your Vercel URL, e.g. https://renderforai.com)
NEXT_PUBLIC_APP_URL=               (SAME value as NEXT_PUBLIC_SITE_URL — see note below)
CRON_SECRET=                       (generate: openssl rand -hex 32)
```

> **Note:** The current code (billing + email helpers) reads `NEXT_PUBLIC_APP_URL`,
> while newer config references `NEXT_PUBLIC_SITE_URL`. Until they're unified, set
> **both** to your deployed URL so absolute links resolve correctly. If you skip
> `NEXT_PUBLIC_APP_URL` it falls back to `https://renderforai.com` / `http://localhost:3000`.

OPTIONAL (leave empty for stub mode):
```
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_KV_NAMESPACE_ID=
CLOUDFLARE_BROWSER_RENDERING_URL=
```

SKIP FOR NOW (payment not needed yet):
```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER=
STRIPE_PRICE_PRO=
STRIPE_PRICE_AGENCY=
RESEND_API_KEY=
```

4. Click Deploy → wait ~2 minutes

## Step 5: Create Admin Account
1. Go to your Vercel URL → /signup → create your account
2. Go to Supabase → Table Editor → users table
3. Find your row → set is_admin = true
4. Go to /admin/login → sign in → you're admin

## Step 6: Attach a Test Domain
METHOD A — Add a domain + integrate (recommended):
- In Domain Manager: add your site (e.g. "mysite.com")
- In Integration Wizard: pick one of the 4 methods and copy its snippet:
  - **Cloudflare Worker** — site already on Cloudflare
  - **Next.js / Vercel** — drop-in middleware.ts
  - **Universal (Node / PHP)** — any backend server
  - **Nginx / Apache** — VPS / self-hosted
- Each snippet detects crawler User-Agents and serves prerendered HTML from
  `${NEXT_PUBLIC_APP_URL}/api/proxy`, passing your API key as `X-Prerender-Token`.
- Real users are passed straight to your origin — zero impact.

METHOD B — Attach a real domain to Vercel:
1. Vercel → Project Settings → Domains → Add Domain
2. Add e.g. "app.renderforai.com" or any domain you own
3. Go to your domain registrar → add CNAME:
   Name: app → Value: cname.vercel-dns.com
4. Wait 2-5 minutes → domain is live (free SSL auto-configured)
5. Update NEXT_PUBLIC_SITE_URL (and NEXT_PUBLIC_APP_URL) in Vercel env vars to this domain
6. Update Supabase redirect URL to match

## Step 7: Test Prerendering
Two ways to test the flow:
```bash
# A) Through the integration proxy (how crawlers actually hit it).
#    The domain must be added in Domain Manager first.
curl -H "User-Agent: Googlebot/2.1" \
     "https://YOUR_APP.vercel.app/api/proxy?url=https://YOUR_DOMAIN/"

# B) On-demand render by API key (from the Security page).
curl -X POST "https://YOUR_APP.vercel.app/api/render" \
     -H "x-api-key: YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://example.com"}'
```
Expected: rendered HTML + an `X-Cache-Status: MISS|HIT` header, a row in the
`renders` table, and the numbers showing up on the Dashboard / Render History.

## Step 8: Enable Real Rendering (When Ready)
1. Add Cloudflare Workers Paid ($5/mo)
2. Set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_KV_NAMESPACE_ID`
   in Vercel (the rendering endpoint is derived automatically — see Step 3)
3. Redeploy (Vercel auto-redeploys on env var change)

---

## Scheduled jobs (replacing Vercel Cron)

The free Vercel plan no longer runs the `crons` block, so it was removed from
`vercel.json`. To keep the monthly usage-reset / usage-check running, use a free
external scheduler such as **cron-job.org**:

1. Create a free account at https://cron-job.org
2. Add a new cron job:
   - URL: `https://YOUR_APP.vercel.app/api/email/usage-check`
   - Schedule: monthly (e.g. 00:00 on the 1st) — matches the old `0 0 1 * *`
   - Add a request header: `Authorization: Bearer YOUR_CRON_SECRET`
     (or `x-cron-secret: YOUR_CRON_SECRET`, matching how the route checks it)
3. Save → the job now fires on schedule against your deployed endpoint.
