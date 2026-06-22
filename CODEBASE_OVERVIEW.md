# RenderForAI — Codebase Overview (for audit)

> Single-file reference describing the entire RenderForAI codebase so a reviewer
> (human or AI) can audit it for **bugs, security gaps, missing pieces,
> dead code, and optimization opportunities**. Jump to
> [§13 Audit focus areas](#13-audit-focus-areas) for the highest-value targets.

---

## 1. What the product is

**RenderForAI** is a **prerendering SaaS** — a Prerender.io / SEO4Ajax alternative.
A customer points their site's bot traffic at RenderForAI's reverse proxy. When a
**search/AI/social crawler** requests a page, RenderForAI serves a fully-rendered
(JavaScript-executed) HTML snapshot from cache so the bot indexes real content;
human visitors are passed straight through to the origin. Rendering is done with
**Cloudflare Browser Rendering**; snapshots are cached in **Cloudflare Workers KV**.

Core philosophy: **minimum resources, maximum work** — never render unless
necessary (smart, change-detection-based cache revalidation rather than timed
expiry).

---

## 2. Tech stack

- **Next.js 16** (App Router, Turbopack, route groups), **React 19**
- **Ant Design 5** (CSS-in-JS) + Tailwind utility classes; `lucide-react`/`@ant-design/icons`
- **Supabase** (Postgres + Auth) via `@supabase/ssr`; service-role client for server work
- **Cloudflare**: Browser Rendering (REST) + Workers KV (REST, deflate-compressed values)
- **Stripe** (billing), **Resend** (email), **dayjs**, **xml2js** (sitemaps), **turndown** (HTML→Markdown)
- Hosting target: **Vercel** (uses `after()` for post-response work + Vercel Cron)

---

## 3. Architecture & the core request flow

The heart of the app is the **prerender proxy**: `app/api/proxy/route.ts`.

```
Bot/visitor request → integration (Worker / middleware / nginx / server snippet)
   → GET /api/proxy?url=<target>   (X-Prerender-Token: <site api_key>)
       1. path === /llms.txt?  → serve cached llms.txt (text/plain), bypass everything
       2. detectBot(UA)
            - not a bot      → { passthrough:true }  (integration serves origin)
       3. resolveOwner(domain, token) → site + user; enforce render_limit
       4. isRenderableUrl?  (skip junk: /api, wp-admin, images, .env, ?s=, …)
       5. KV cache lookup
            - HIT  → serve cached HTML/markdown; after() → revalidateChanged()
            - MISS → renderPage() (Cloudflare) → store KV + cache_entries
                     → after(): one origin fetch feeds BOTH diagnostics + change-validators
       6. log renders + bot_visits + bot_traffic_stats (fire-and-forget)
```

**Smart revalidation** (`lib/revalidate.ts`): a cached page is given a long KV
lifetime (`hard_cache_ttl_days`, default 30d) plus a short "soft check window"
(`cache_ttl_seconds`, default 1d). After the window, a background conditional GET
(ETag/Last-Modified + a visible-text fingerprint) decides whether the origin
actually changed; only then is it re-rendered. Unchanged pages just refresh their
window — no render spent.

**Markdown for AI bots**: AI crawlers that send `Accept: text/markdown` get the
page converted via turndown.

---

## 4. Directory structure

```
app/
  (auth)/login, signup                     – auth pages
  (dashboard)/...                          – client app (see §8)
  (admin)/admin/...                        – admin panel (see §9)
  api/...                                  – all backend routes (see §6,§7)
  page.tsx                                 – marketing/landing entry
lib/                                       – server + shared logic (see §5)
components/
  admin/  (AdminSidebar, AdminHeader)
  charts/ (Charts.tsx – dependency-free SVG charts)
  dashboard/ (BotCostWidget)
  layout/ (SUSPECT: several may be unused — see §13)
  ui/ (StatTitle)
supabase/
  schema.sql                               – full bootstrap schema (source of truth)
  schema_admin.sql                         – admin-portion mirror
  migrations/001..015                      – incremental migrations (mirror schema.sql)
middleware.ts                              – auth gate + x-user-id injection
vercel.json                               – cron schedule + function maxDuration
```

---

## 5. `lib/` modules

| File | Purpose |
|---|---|
| `supabase.ts` | `createServerClient()`, `supabaseAdmin` (service-role Proxy, bypasses RLS), `DbUser`/`DbSite`/`Plan` types |
| `supabase-browser.ts` | browser client |
| `auth-helpers.ts` | `getUserFromRequest()` (reads injected `x-user-id`), `UnauthorizedError` |
| `admin-auth.ts` | `requireAdmin()` (verifies session + `users.is_admin`), `adminAuthError()`, `logAdminAction()` |
| `app-config.ts` | DB→env→default config loader (15s in-memory cache). `SETTING_KEYS`, `getCloudflareConfig()`, `getOpsConfig()`, `clearConfigCache()` |
| `botDetect.ts` | **(active)** `detectBot(ua)` → {isBot, botName, botType: search/ai/social/seo/other}, large UA pattern list |
| `bot-detect.ts` | **SUSPECT DEAD** — not imported anywhere; likely a duplicate of `botDetect.ts` |
| `renderer.ts` | `renderPage(url)` via Cloudflare Browser Rendering; `htmlToMarkdown()`; `isRenderConfigured()`; honours `render_timeout_ms` + `block_resources` |
| `kv.ts` | Workers KV get/set (deflate-raw compression); per-call config; no-op if unconfigured |
| `revalidate.ts` | `HARD_CACHE_TTL`, `captureValidators()`, `originChanged()`, `fingerprint()` |
| `url-utils.ts` | `normalizeUrl()` (strips tracking params), `isRenderableUrl()` (junk filter) |
| `queue-drain.ts` | `drainQueue()` — renders pending `caching_queue` URLs in bounded batches; throttle + rate-limit backoff |
| `sitemap.ts` | sitemap crawl (`extractLocs` w/ lastmod), `queueUrls()`, `recheckSitemap()` (incremental by lastmod) |
| `diagnostics.ts` | `runDiagnostics()` / `captureDiagnostics()` — rendered-vs-raw content diff, console errors, missing SEO, GEO signals + AI citation score |
| `diagnostics-worker.ts` | `processDiagnosticsJob()`, staleness reclaim, SSRF domain check |
| `geo-signals.ts` | `extractGeoSignals(html)` (pure), `computeAiCitationScore()` (research-weighted) |
| `bot-cost.ts` | `getCurrentEstimate()`, `getRateForDate()` (per-day historical rate), `setRate()` (history-correct), `getBotCostSummary()` |
| `llms-txt.ts` | `generateLlmsTxt()` (auto-build from rendered pages), `generateAndStoreLlmsTxt()`, `saveManualLlmsTxt()`, `getServableLlmsTxt()` |
| `gsc.ts` | Google Search Console OAuth + metrics |
| `stripe.ts` | lazy Stripe client (Proxy), `PRICE_IDS`, `PLAN_RENDER_LIMITS`, `getOrCreateCustomer()`, `getPlanFromPriceId()` |
| `email.ts` | Resend transactional email |
| `plan-utils.ts` | plan limit helpers |
| `constants.ts` | `PLAN_LIMITS`, brand constants |
| `dashboard-context.tsx` | `DashboardContext` (sites/user/selectedSiteId shared by the dashboard layout) |
| `utils.ts` | misc helpers |

---

## 6. Client-facing API routes (`x-user-id` injected by middleware)

Ownership pattern everywhere: `sites.eq('id', siteId).eq('user_id', uid)`.

| Route | Method | Purpose |
|---|---|---|
| `/api/sites`, `/api/sites/[id]` | CRUD | manage domains; POST also kicks `drainQueue` |
| `/api/analytics` | GET | dashboard analytics (bot timeline, cache hit-rate, top pages) |
| `/api/cache` | GET/DELETE | cache manager (junk-filtered counts/list) |
| `/api/diagnostics/[siteId]` | GET/POST | bot-visibility report + enqueue re-scan; `/scan-status` polls progress |
| `/api/bot-cost/[siteId]` | GET | per-bot bandwidth cost summary (range 7/30/90d) |
| `/api/llms-txt/[siteId]` | GET/PATCH | view llms.txt / save manual override; `/regenerate` POST |
| `/api/sitemaps`, `/auto`, `/urls`, `/recheck` | various | sitemap connect, discovered URLs, manual "check now" |
| `/api/queue`, `/api/queue/process` | GET/POST | caching queue view + drain trigger (cron-capable) |
| `/api/broken-links` | GET | 404 checker |
| `/api/gsc`, `/connect`, `/callback`, `/metrics` | various | Google Search Console connect + metrics |
| `/api/billing/checkout`, `/portal`, `/webhook` | POST | Stripe checkout, customer portal, webhook (webhook is public) |
| `/api/user`, `/api/account` | — | profile |
| `/api/auth/login`, `/signup`, `/logout`, `/me`, `/callback` | — | auth |
| `/api/plugin/connect`, `/login`, `/status` | — | WordPress/plugin integration handshake |
| `/api/email/usage-check` | — | usage-threshold email trigger |
| `/api/render` | POST | direct render endpoint (used by some integrations) |

**Public (no auth / own auth):** `/api/proxy`, `/api/render`, `/api/billing/webhook`,
`/api/auth/*`, `/api/plugin/*`, the cron GETs (Bearer `CRON_SECRET`).

---

## 7. Admin API routes (all behind `requireAdmin()`)

| Route | Purpose |
|---|---|
| `/api/admin/stats` | platform KPIs (users, MRR via Stripe, renders, cache hit rate, trends) |
| `/api/admin/users`, `/[id]`, `/[id]/ban`, `/[id]/impersonate` | user management |
| `/api/admin/plans`, `/[id]` | plan CRUD |
| `/api/admin/subscriptions`, `/[subId]` | Stripe subs: change plan / cancel / refund |
| `/api/admin/renders` | platform-wide render monitor (filter by email/domain/bot/cache/date) |
| `/api/admin/logs` | audit log (+ `distinct_admins`, `distinct_actions` helpers) |
| `/api/admin/settings`, `/test` | Cloudflare creds + ops limits; live CF connection test |
| `/api/admin/bot-cost` | bandwidth $/GB rate + history (set_by audit) |
| `/api/admin/cloudflare-usage`, `/live` | resource usage (DB estimate) + opt-in live Cloudflare GraphQL KV figures |

---

## 8. Client dashboard pages (`app/(dashboard)`)

Sidebar groups: **Analytics** (Domain Manager, Dashboard, CDN Analytics, SEO
Insights, Bot Visibility, **Bot Cost Insights**, Render History) · **Cache**
(Cache Manager, Caching Queue, Sitemaps) · **Site Health** (404 Checker,
**llms.txt**, GSC) · **Account** (Billing, Security, Settings, Integration Guide).

Layout (`app/(dashboard)/layout.tsx`) provides `DashboardContext` (sites/user),
prefetches all nav routes, light/dark theme toggle, per-site selector.

Notable: **Bot Visibility** (diagnostics + AI Citation Readiness), **Bot Cost
Insights** (per-bot bandwidth $ estimate), **llms.txt** (auto-served file +
manual override).

---

## 9. Admin panel (`app/(admin)/admin`)

Light theme (matches client). Pages: Dashboard, Users, Plans, Subscriptions,
Renders Monitor, **Cloudflare Usage** (DB + live), **Bandwidth Rate**, Audit
Logs, Platform Settings, Login. Gated three ways (see §11).

---

## 10. Data model (Postgres / Supabase)

Tables: `users`, `sites`, `renders`, `bot_visits`, `bot_traffic_stats`,
`sitemaps`, `cache_entries`, `caching_queue`, `broken_links`,
`render_diagnostics`, `diagnostics_jobs`, `gsc_connections`, `plans`,
`admin_logs`, `app_settings`, `platform_settings`, `bot_cost_rate_history`,
`llms_txt_cache`.

Key relationships: everything site-scoped FKs to `sites(id)`; user-scoped to
`users(id)`. RLS is enabled on most tables (site/owner-scoped or admin-only);
**all server routes use the service-role client which bypasses RLS**, so route-
level ownership checks are the real authorization boundary.

DB functions: `increment_bot_traffic()` (atomic upsert), `admin_cloudflare_usage()`
(single-round-trip usage aggregate).

`schema.sql` is the bootstrap source of truth; `migrations/001..015` are
incremental and idempotent (mirror schema.sql). See `CONSOLIDATED` SQL in chat
history / migrations folder.

---

## 11. Auth & security model

- **Middleware** (`middleware.ts`): strips any client-supplied `x-user-id`, then
  for injectable API namespaces verifies the session via `supabase.auth.getUser()`
  (signature-verified) and injects a trusted `x-user-id`. Page routes gate with
  `getSession()` (cookie-only, fast) — UI gating only; data is always re-verified.
- **Admin**: (1) middleware page gate on `/admin/*`; (2) admin layout checks
  `is_admin` via `/api/auth/me` and redirects non-admins; (3) **every** admin API
  calls `requireAdmin()` — the decisive lock (direct API hit by a client → 403).
- **Cron**: `Authorization: Bearer ${CRON_SECRET}`.
- **SSRF**: diagnostics/render URL lists are filtered to the site's own domain.
- **Secrets**: Cloudflare token masked in API responses; only updated when retyped.
- **Plan/quota**: `render_limit` enforced in the proxy + diagnostics.

---

## 12. Background work, crons, config

- **Vercel crons** (`vercel.json`): `/api/queue/process` (daily 03:00),
  `/api/sitemaps/recheck` (daily 04:00), `/api/llms/regenerate` (weekly Sun 05:00).
- **`after()`**: revalidation, diagnostics capture, validator capture run post-response.
- **Admin-tunable settings** (`app_settings`, no redeploy): Cloudflare creds,
  `max_rescan_urls`, `rescan_concurrency`, `cache_ttl_seconds`, `sitemap_max_urls`,
  `render_timeout_ms`, `queue_throttle_ms`, `hard_cache_ttl_days`, `block_resources`,
  plus Cloudflare plan limits. Bot-cost rate lives in `platform_settings` +
  `bot_cost_rate_history` (admin-only).

### Required environment variables
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_KV_NAMESPACE_ID`
(token needs Browser Rendering + Workers KV + **Account Analytics: Read** for the
live usage page), and Stripe/Resend/Google-OAuth keys where those features are used.

---

## 13. Audit focus areas

Highest-value places to scrutinise:

1. **Suspected dead code (verify & remove if unused):**
   - `lib/bot-detect.ts` — not imported anywhere; `lib/botDetect.ts` is the live one.
   - `components/layout/*` (DashboardLayout, AppSidebar, AppHeader, Sidebar,
     SidebarMenu, Header, Logo, AntdProvider) — the real layouts are inline in
     `app/(dashboard)/layout.tsx` and `app/(admin)/layout.tsx`; confirm which of
     these are actually referenced.
   - Two settings pages exist: `app/(dashboard)/settings` (client) vs
     `app/(admin)/admin/settings` (platform) — confirm both are intended.

2. **Service-role + RLS:** every server route uses `supabaseAdmin` (RLS bypassed).
   Audit each route for a **correct ownership/admin check** — a missing
   `.eq('user_id', uid)` would be an IDOR. Cross-check all `/api/*` handlers.

3. **Stripe correctness:** webhook idempotency/signature, refund/cancel/plan-change
   flows, MRR computation (annual→monthly normalization), customer/sub linkage.

4. **Cloudflare cost & limits at scale (1000+ clients):** proxy hot path,
   `count: 'exact'` vs `estimated`, full-table scans, the queue throttle vs rate
   limits, KV storage growth, render quota enforcement.

5. **Proxy edge cases:** unregistered domains, redirect loops, markdown path,
   normalization vs cache-key consistency, `after()` reliability, error handling
   when Cloudflare/origin is down.

6. **Diagnostics/SSRF:** ensure URL lists can't target internal hosts; job
   dedupe/staleness; resource bounds.

7. **Migrations vs schema.sql drift:** confirm `schema.sql` and `migrations/*`
   stay in sync; all migrations idempotent and safe to re-run.

8. **Input validation:** numeric settings bounds, plan field validation, search
   params (e.g. user/email filters that are resolved to ids to avoid uuid-cast errors).

9. **Performance:** N+1 queries, missing indexes for new query patterns, payload
   sizes, unnecessary re-renders / refetch coupling on dashboards.

10. **Secrets & PII:** token masking, what's returned to the client, log contents.

---

## 14. Running locally

```bash
npm install
# create .env.local with the §12 vars
npm run dev          # http://localhost:3000
npx tsc --noEmit     # type-check
npm run build        # production build
```

Database: run `supabase/schema.sql` once on a fresh DB, then apply
`migrations/001..015` (idempotent; safe to run the consolidated block in one go).
