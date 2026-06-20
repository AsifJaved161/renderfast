-- Performance indexes matching the hot query patterns. Pure speed-up — no
-- behaviour change. Run once in the Supabase SQL editor.

-- cache_entries: smart-revalidation / sitemap-recheck / drain look up by url,
-- and the Cache Manager lists by user ordered by cached_at.
create index if not exists idx_cache_entries_site_url on public.cache_entries(site_id, url);
create index if not exists idx_cache_entries_url      on public.cache_entries(url);
create index if not exists idx_cache_entries_user     on public.cache_entries(user_id, cached_at desc);

-- caching_queue: drain picks pending by priority; counts filter by site/user+status.
create index if not exists idx_caching_queue_site_status on public.caching_queue(site_id, status);
create index if not exists idx_caching_queue_user_status on public.caching_queue(user_id, status);

-- renders: hit-rate & history filter by user / site over time.
create index if not exists idx_renders_user_created on public.renders(user_id, created_at desc);
