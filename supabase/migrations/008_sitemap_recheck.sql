-- Sitemap re-check interval: how often (in days) to re-crawl the sitemap and
-- queue only the URLs whose <lastmod> is newer than our cached copy.
-- Run once in the Supabase SQL editor.

alter table public.sitemaps add column if not exists check_interval_days integer not null default 5;
