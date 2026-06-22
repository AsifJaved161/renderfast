-- Cloudflare resource-usage aggregates for the admin panel, in ONE round-trip.
-- Designed to scale: each value is a single indexed count/sum, so it stays cheap
-- even at 1000+ clients (no per-client Cloudflare API calls). Run once in Supabase.
--
-- What maps to what we consume on Cloudflare:
--   renders_*    → Browser Rendering calls (1 render = 1 call)
--   kv_keys      → Workers KV keys stored (cached pages)
--   kv_bytes     → KV storage used (approx; uncompressed HTML — conservative ceiling)
--   reads_today  → KV reads today  (cache HITs)
--   writes_today → KV writes today (cache MISSes that stored a page)

create or replace function public.admin_cloudflare_usage()
returns table (
  renders_today bigint,
  renders_month bigint,
  renders_all   bigint,
  kv_keys       bigint,
  kv_bytes      bigint,
  reads_today   bigint,
  writes_today  bigint,
  total_sites   bigint
)
language sql
stable
as $$
  select
    (select count(*) from public.renders where created_at >= current_date),
    (select count(*) from public.renders where created_at >= now() - interval '30 days'),
    (select count(*) from public.renders),
    (select count(*) from public.cache_entries),
    (select coalesce(sum(html_size_bytes), 0) from public.cache_entries),
    (select count(*) from public.renders where created_at >= current_date and cache_hit = true),
    (select count(*) from public.renders where created_at >= current_date and cache_hit = false),
    (select count(*) from public.sites);
$$;

-- Only the service role (used by the admin API behind requireAdmin) may call it.
revoke all on function public.admin_cloudflare_usage() from public, anon, authenticated;
