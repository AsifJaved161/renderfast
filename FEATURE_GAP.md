# RenderForAI vs SEO4Ajax — Feature Gap Analysis

Comparing the SEO4Ajax console documentation against our project. Legend:
✅ Have · 🟡 Partial · ❌ Missing. (Terminology map: their "capture" = our cached
page/render; "crawler" = our render queue; "pendings" = our caching queue.)

---

## 1. Home / Sites
| SEO4Ajax | Us | Notes |
|---|---|---|
| Register a new site (name + URL) | ✅ | Domain Manager |
| Grid / List view toggle | ✅ | Domain Manager |
| View & open each site | ✅ | domain-manager/[id] |
| Pick a plan at site-creation | ❌ | We add to the current account plan only |
| Per-site crawler **status icon + play/pause** | 🟡 | We store status (active/pending/inactive) but it does NOT actually pause serving/rendering |

## 2. Account settings
| SEO4Ajax | Us | Notes |
|---|---|---|
| Change password | ✅ | account page |
| Change email | ❌ | email field is read-only |
| API token (read-only) | ✅ | security page |
| Share account with other users ("allowed users") | ✅ | Team (invite) |
| Switch to a shared account | ✅ | Account switcher |
| Credit-card details | ✅ | Stripe portal |
| Billing address | 🟡 | handled inside Stripe portal, not in-app |
| **Service usage table (per-site captured pages this month)** | ❌ | we show total usage, not a per-site breakdown |
| **Real invoices (download past + preview upcoming)** | ❌ | billing page currently shows HARD-CODED/mock invoices — needs real Stripe invoices |

## 3. Subscription
| SEO4Ajax | Us | Notes |
|---|---|---|
| Change plan / cancel / commitment | ✅ | Stripe checkout + portal |

## 4. Site status (their biggest section)
| SEO4Ajax | Us | Notes |
|---|---|---|
| Activate / deactivate crawler per site | ❌ | no real on/off |
| Captures list (path + capture date + preview) | ✅ | Cache Manager (list + view HTML) |
| **Errors view with typed errors** (HTTP code, blank page, unresponsive, net error, invalid mime, timeout, quota, tech error) | 🟡 | we have queue "failed" + error_message, but no dedicated typed-errors view |
| Pendings view (pending/processing/paused) | ✅ | Caching Queue |
| **Debug logs view (per-capture logs)** | ❌ | we don't store per-render debug logs |
| **Cache freshness stats** (bar charts: cached pages/redirects/errors/pendings by age, click bar → filtered list) | ❌ | not present |
| Re-capture selected / all / filtered | 🟡 | we have refresh/re-render & queue process, but not "filtered" set |
| Capture new paths | ✅ | Caching Queue → add URLs |
| Delete captures (single / all) | ✅ | Cache Manager |
| Delete filtered | ❌ | |
| **Download generated sitemap (.xml)** | ❌ | we read sitemaps but don't generate/serve a downloadable sitemap |
| **Export data as CSV (captures / errors / pendings)** | 🟡 | only Render History has CSV export |
| **Advanced filters** (path wildcard `*`, exclude `-term`, date period, redirect status) | 🟡 | we have site/status filters only |
| Sort by any column | 🟡 | not all tables sortable |

## 5. SEO Reports (refreshed 2×/day) — mostly MISSING, high SEO value
| SEO4Ajax | Us | Notes |
|---|---|---|
| **Duplicate contents** report | ❌ | |
| **Duplicate titles** report | ❌ | |
| **Low word-count** pages report | ❌ | |
| JavaScript errors per page | 🟡 | Bot Visibility shows console errors per URL (no grouped report) |
| Broken links report | ✅ | 404 Checker |
| **Missing hreflang links** report | ❌ | |
| **Page explorer** (per path: HTTP status, title, canonical, inner links, referrers) | ❌ | Bot Visibility is per-URL diagnostics but lacks canonical/inner-links/referrers |
| **Site structure totals** (analyzed pages, inner links, canonical count, inner redirects) | ❌ | |

## 6. Site dashboard (bot traffic stats)
| SEO4Ajax | Us | Notes |
|---|---|---|
| Date-period filter | ✅ | dashboard RangePicker |
| Hits by bot (bar) | ✅ | Bot Activity / CDN Analytics |
| **Hits by HTTP status code (pie + bar)** | ❌ | we split by bot type, not status code |
| **Mean response time by HTTP status (line)** | 🟡 | we have avg response times, not per-status-over-time |
| Filter by status code / by bot | 🟡 | partial |

## 7. Site settings — Advanced (per-site) — mostly MISSING
| SEO4Ajax | Us | Notes |
|---|---|---|
| Editable name, read-only URL & token | ✅ | domain-manager/[id] + security |
| Remove site | ✅ | |
| "Crawl site" button | ✅ | Sitemaps fetch/recheck |
| Sitemaps config (add URLs, lastmod) | ✅ | lastmod ✅, **changefreq ❌** |
| **Entry points** (extra crawl seeds) | ❌ | |
| **Excluded paths** (never capture) | ❌ | |
| **Rewrite rules + "Test rules" popup** | ❌ | big feature |
| **Block resources by URL fragment (per-site)** | 🟡 | only a global admin image/font/media block |
| **Custom HTTP headers on crawl** | ❌ | |
| **Emulate mobile device (per-site)** | 🟡 | renderer supports it, no per-site UI |
| **Crawler language** | ❌ | |
| **Custom user-agent** | ❌ | |
| **Max delay for resources / JS execution (per-site)** | 🟡 | global admin timeout only |
| Cache capture on Facebook | ❌ | niche |

## 8. Site settings — API configuration (per-site)
| SEO4Ajax | Us | Notes |
|---|---|---|
| Capture expired pages (auto re-capture) | ✅ | smart revalidation / recheck |
| **Per-path expiration regex** | 🟡 | single global TTL, not per-path |
| Capture new pages (auto on-the-fly) | ✅ | proxy renders unknown bot URLs |
| **Crawl inner links of captured pages** | 🟡 | sitemap discovery only, not link-following |
| **Enable JS redirects detection** | ❌ | |
| **Configurable bot UA fragments (on-the-fly)** | 🟡 | built-in list, not per-site editable |
| Max delay for on-the-fly captures | 🟡 | global |

## 9. Automatic emails (per-site)
| SEO4Ajax | Us | Notes |
|---|---|---|
| Quota-exceeded email (% threshold) | ✅ | usage-check (80%/100%) |
| **Errors-quota email (% threshold)** | 🟡 | settings has a toggle but no real error-email cron |
| **Offline/disconnected-site notification** | ❌ | |

## 10. Other
| SEO4Ajax | Us | Notes |
|---|---|---|
| Server config snippets (Apache/Nginx/IIS) | ✅ | Integration Wizard |
| **Authenticated API (manage captures programmatically)** | 🟡 | we have proxy/render; no documented authed management API |
| **Chrome extension ("companion")** | ❌ | out of scope likely |
| **CSV export everywhere** | 🟡 | only render history |

---

## Suggested implementation order (by value ÷ effort)

### Phase 1 — quick wins / fixes  ✅ DONE
1. ✅ **Real Stripe invoices** in Billing (replaced the hard-coded mock). `/api/billing/invoices`
2. ✅ **Change email** in Account settings (Supabase email-change flow + /api/auth/me self-heal).
3. ✅ **Per-site crawler pause/resume** — proxy now honours `status=inactive`; toggle on Domain Manager.
4. ✅ **Download generated sitemap (.xml)** — `/api/sitemaps/download` + button on Sitemaps.
5. ✅ **CSV export** on Cache, Caching Queue (full paginated) & 404 Checker (shared `lib/export-csv`).
6. ✅ **Per-site usage breakdown** — `/api/billing/usage-by-site` + "Renders by Site" table.
> Phase 1 needs NO database migration — safe to deploy as-is.

### Phase 2 — SEO Reports suite (highest SEO value)  ✅ DONE
7. ✅ **Duplicate titles** + **Duplicate contents** (content-hash; canonicalised pages excluded).
8. ✅ **Low word-count** pages report.
9. ✅ **Missing hreflang** confirmation-link report.
10. ✅ **Page explorer** (status, title, canonical, inner links, referrers) + **site-structure totals**.
11. ✅ Bonus: **JavaScript errors** per page.
> Built on migration 020 + diagnostics metadata capture. New /seo-reports page +
> /api/seo-reports/[siteId]. **Run migration 020 in Supabase before deploy.**

### Phase 3 — Status views & dashboard depth  ✅ DONE
11. ✅ **Render Errors** view with typed error reasons (+ retry/export).
12. ✅ **Cache freshness** distribution chart.
13. ✅ Dashboard: **hits by HTTP status** (donut) + **response time by status** (migration 021).
14. ✅ **Advanced filters** (path wildcard `*` / `-exclude`, date range) on Cache & Queue.

### Phase 4 — Advanced per-site settings  ✅ CORE DONE (migration 022)
15. ✅ **Excluded paths** + **Entry points** (wired into proxy/queue/sitemap).
16. ✅ **Custom user-agent**, **custom headers**, **emulate mobile**, **per-site block-resources** (→ renderer).
17. ✅ **Per-path expiration rules** (cache TTL override).
18. ⏸️ **JS redirect detection** — deferred (large standalone; needs renderer to report final URL).
19. ⏸️ **Rewrite rules + test** — deferred (a full mod_rewrite-style engine; biggest single item).

### Phase 5  ✅ DONE / scoped
20. ✅(equiv) Debug logs per capture — console errors + failed requests already captured per render
    (shown in Bot Visibility) and JS errors in SEO Reports.
21. ✅ **Error-rate** email + **offline-site** email (daily cron, opt-in).
22. 🟡 Authenticated API — api-key endpoints exist (`/api/render`, `/api/recache`); a formal public
    API docs page is the only remaining bit.
23. ❌ Chrome extension — out of scope (separate distributable, not part of this app).

---
## Remaining (explicitly deferred)
- Rewrite-rules engine + test tool (Phase 4 #19) — large; design as its own feature.
- JS-redirect detection (Phase 4 #18).
- Public-API documentation page (Phase 5 #22).
- Chrome extension (Phase 5 #23) — out of scope.

## Migrations to run in Supabase (idempotent, in order)
019_analytics_aggregates · 020_seo_reports · 021_analytics_status_split · 022_site_settings
