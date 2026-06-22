# RenderForAI — Audit Log

Running log of the autonomous audit/cleanup/optimization pass. Each entry: what
was checked, what was found, what changed (or why not), and build result.

Baseline commit: `d769070`. Rules: verify references before delete; `npx tsc
--noEmit` + `npm run build` after every change; revert on failure; one change at
a time; never change behavior/contracts silently.

---

## Phase 1 — Map & dead-code investigation

Walked `app/`, `lib/`, `components/`, `supabase/`. Map matches CODEBASE_OVERVIEW.md.

### Dead code removed (all verified at ZERO external references)
Method: `grep -rn` across `app/ lib/ components/ middleware.ts` for every
`@/...` and relative import of each candidate. Deleted only at 0 refs.

| File | Evidence | 
|---|---|
| `lib/bot-detect.ts` | 0 imports anywhere; live module is `lib/botDetect.ts` (used by proxy + render) |
| `components/layout/AppHeader.tsx` | 0 refs |
| `components/layout/AppSidebar.tsx` | 0 refs |
| `components/layout/DashboardLayout.tsx` | 0 refs (real dashboard layout is inline `app/(dashboard)/layout.tsx`) |
| `components/layout/Header.tsx` | 0 refs |
| `components/layout/Logo.tsx` | 0 refs |
| `components/layout/Sidebar.tsx` | 0 refs |
| `components/layout/SidebarMenu.tsx` | 0 refs |
| `lib/utils.ts` | only ref was `components/layout/Sidebar.tsx` (itself deleted) → became 0 |

**Kept:** `components/layout/AntdProvider.tsx` — used by `app/layout.tsx` (1 ref).

**Verification:** deleted all 9 in one step → `npx tsc --noEmit` ✅ (no dangling
imports) → `npm run build` ✅ (Compiled successfully). A dangling import would
have named the offending file in tsc; none did.

**NOT touched (needs human review / out of scope):**
- `supabase/migrations/*` and `supabase/schema_admin.sql` — history/reference, not
  imported by code; never delete migrations.
- No other lib module found unreferenced on scan.

---

## Phase 3 — API route & lib correctness/security review

Scanned all `app/api/**` for auth + ownership + params. Verified the param/owned
routes (`sites/[id]`, `diagnostics/[siteId]`, `bot-cost/[siteId]`,
`llms-txt/[siteId]`, `broken-links`, `cache`, `analytics`, `gsc/metrics`,
`queue`, `sitemaps/*`, `users/[id]`) all carry the `.eq('user_id', uid)` (or
admin) ownership filter. **No IDOR found** in user-scoped routes.

### Secure — verified OK (no change)
- `plugin/connect`, `plugin/status`, `plugin/login` — all api_key→user scoped;
  login validates email+password via Supabase before returning the key.
- `user` (GET/PATCH) — `getUser()` verified, field whitelist + type validation,
  scoped to own id.
- `billing/webhook` — **signature IS verified** (`stripe.webhooks.constructEvent`
  with `STRIPE_WEBHOOK_SECRET`).
- `proxy` — URL is bound to a registered site via `resolveOwner(domain)`;
  unregistered domains → 302 origin (no render). Render errors → 302 (graceful).

### STOPPING-CONDITION items (real issues — NOT changed; need your decision)

1. **`/api/render` renders ANY url for a valid API key (SSRF + Cloudflare cost).**
   Unlike `/api/proxy`, it never checks that `new URL(body.url).hostname` belongs
   to a site the key's owner registered (`site_id` is optional, used only for
   logging). A key holder can render arbitrary internet pages on our CF budget.
   *Why not auto-fixed:* the Integration Wizard **documents this as a feature**
   ("Test it — renders any URL on demand", example `https://example.com`), so
   binding it to the registered domain changes a **documented public contract**.
   *Recommended fix (if approved):* mirror `proxy.resolveOwner` — resolve
   `url.hostname` (www-insensitive) to one of the owner's `sites`; 403 if none.
   Keeps legitimate (own-domain) calls identical.

2. **Render-limit check is read-then-write (not atomic) — quota race.**
   In `/api/proxy` (`persistRender`) and `/api/render`: `if (count >= limit)` then
   later `update({ render_count: count + 1 })`. Concurrent requests can both pass
   the check and/or lose increments (last-writer-wins). *Why not auto-fixed:* an
   atomic fix needs a Postgres RPC (`update ... set render_count = render_count+1
   where render_count < render_limit returning`) = **DB migration** (stopping
   condition). Low real-world impact at current scale; matters at high concurrency.

3. **`billing/webhook` reliability/idempotency (billing = stopping condition).**
   - `handleEvent(event).catch(console.error)` runs after returning 200, so a
     transient DB failure is swallowed and Stripe won't retry → possible lost
     plan update. Consider `await`-ing before 200 so Stripe retries on failure.
   - No processed-event-id dedupe; the plan-`update` handlers are naturally
     idempotent (set to fixed value), but `invoice.payment_failed` sends an email
     and could duplicate on Stripe retries.
   *Not changed* per billing stopping condition — reporting only.

### Needs-human-review (not a hole; left as-is)
- `email/usage-check` cron auth compares the header **equal to** `CRON_SECRET`
  (`x-cron-secret` or raw `authorization`), whereas the other cron routes expect
  `authorization === 'Bearer '+CRON_SECRET`. It **fails closed** (no security
  risk) but is inconsistent and may not fire via a standard Bearer cron. Caller
  unknown (not in vercel.json), so not changed — flag for confirmation.

---

## Phase 4 — Optimization (behavior-preserving only)

- **Already done (prior session):** `/api/admin/renders` uses `count:'estimated'`
  when unfiltered (renders is the only table that grows to millions) + added
  `idx_renders_created`. This was the main scale risk.
- **Remaining `count:'exact'`** (`cache`, `queue`, `sitemaps/urls`, `admin/users`,
  `admin/logs`): all are **user/site-scoped or small tables**, and the exact count
  is the **displayed pagination total**. Switching to `estimated` would change the
  number shown to users → a behavior change, not a free optimization. **Left as-is**
  (bounded + correct). Indexes for these patterns exist (migration 009).
- No N+1 found in hot path; `/api/proxy` already batches and uses `after()` for
  post-response work. Per-page admin lists resolve domains/emails in one batched
  `.in()` query (not N+1).

**Conclusion:** no further behavior-preserving optimization to apply safely; the
high-value one (renders at scale) was already in place.

