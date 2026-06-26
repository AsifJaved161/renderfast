# RenderForAI — Full Logic Verification Plan

Goal: verify every subsystem end-to-end and fix any bug so the product works
100% correctly and is foolproof. Each item lists the files that hold the logic
and what must be true for it to be correct. Worked top-to-bottom; findings and
fixes are recorded inline as `✅ verified` / `🐛 fixed: …`.

## 1. Auth & session
Files: `app/api/auth/*`, `middleware.ts`, `lib/supabase.ts`, `lib/supabase-browser.ts`,
`lib/auth-helpers.ts`, `lib/admin-auth.ts`, `hooks/useAuth.ts`, `app/(auth)/*`.
Correct when: login/signup/logout/Google-OAuth all set & clear the right cookies;
middleware injects a *verified* user id; protected routes gate correctly; PKCE works.

## 2. Cross-account isolation (data scoping)
Files: every `app/api/**` data route, `middleware.ts`.
Correct when: every read/write is scoped to the authenticated user (or an
actively-shared team account); no route trusts a client-supplied id.

## 3. Sites CRUD & plan limits
Files: `app/api/sites/route.ts`, `app/api/sites/[id]/route.ts`, `lib/plan-utils.ts`,
`lib/constants.ts`. Correct when: site limits enforced per plan; domain validation
solid; delete cascades; ownership enforced.

## 4. Rendering pipeline
Files: `lib/renderer.ts`, `lib/kv.ts`, `lib/revalidate.ts`, `app/api/render/route.ts`,
`app/api/proxy/route.ts`, `app/api/recache/route.ts`. Correct when: render succeeds/
fails gracefully; cache get/set/TTL correct; validators (ETag/Last-Modified) honoured;
SSRF-safe.

## 5. Cache management
Files: `app/api/cache/route.ts`, `app/api/cache-hit/route.ts`, `lib/kv.ts`.
Correct when: list/summary/delete/clear scoped & consistent KV↔DB.

## 6. Caching queue & drain
Files: `app/api/queue/route.ts`, `app/api/queue/process/route.ts`,
`lib/queue-drain.ts`, `app/api/cron/route.ts`. Correct when: queue add/retry/clear
scoped; drain respects limits/quota; no double-processing; cron secured.

## 7. Sitemaps
Files: `lib/sitemap.ts`, `app/api/sitemaps/*`. Correct when: discovery parses sitemap
index + gz; recheck only queues new/updated; intervals honoured; ownership enforced.

## 8. Analytics
Files: `app/api/analytics/route.ts`. Correct when: per-user scoped; aggregates
(hit rate, timelines, top pages, render history) computed correctly; date ranges.

## 9. Bot detection & bot cost
Files: `lib/botDetect.ts`, `lib/bot-cost.ts`, `app/api/bot-cost/[siteId]/route.ts`,
`app/api/admin/bot-cost/route.ts`. Correct when: bot classification accurate; cost
estimate maths correct; rate resolution per time-range.

## 10. Diagnostics / bot-visibility
Files: `lib/diagnostics.ts`, `lib/diagnostics-worker.ts`, `lib/geo-signals.ts`,
`lib/web-vitals.ts`, `app/api/diagnostics/*`. Correct when: job lifecycle (queue/run/
finish/stale-reclaim) sound; scoring correct; no stuck jobs.

## 11. llms.txt
Files: `lib/llms-txt.ts`, `app/api/llms-txt/*`, `app/api/llms/regenerate/route.ts`.
Correct when: generate/serve/manual-override/auto flag all consistent.

## 12. GSC integration
Files: `lib/gsc.ts`, `app/api/gsc/*`. Correct when: OAuth + state CSRF; token refresh;
property match; metrics aggregation; per-user token isolation.

## 13. Billing
Files: `lib/stripe.ts`, `app/api/billing/*`. Correct when: checkout/portal sessions
correct; webhook verifies signature & updates plan/limits idempotently.

## 14. Team
Files: `app/api/team/*`. Correct when: invite/accept/role/remove/switch all gated by
membership & role; email-match on accept.

## 15. Email & digest
Files: `lib/email.ts`, `lib/digest.ts`, `app/api/email/*`. Correct when: sends are
best-effort; digest/usage-check cron secured & scoped.

## 16. Admin
Files: `app/api/admin/*`, `lib/admin-auth.ts`, `app/(admin)/*`. Correct when: every
admin route requires admin; impersonate/ban/plans/settings safe.

## 17. Cloudflare worker
Files: `worker/src/index.ts`, `worker/edge.ts`, `worker/index.ts`. Correct when: bot
routing, token check, cache passthrough correct.

## 18. App config & constants
Files: `lib/app-config.ts`, `lib/constants.ts`, `config/navigation.ts`. Correct when:
ops config defaults/caching sane; plan constants match UI copy.
