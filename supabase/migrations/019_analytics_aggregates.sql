-- Server-side analytics aggregation. Replaces the old "fetch every renders +
-- bot_visits row in the range and aggregate in JS" approach — which fetched
-- huge row sets for wide ranges / busy accounts — with a single SQL function
-- that returns only the small aggregated result. Output JSON matches the shape
-- the dashboard/cdn-analytics/billing pages already consume.
--
-- Scoping: renders are filtered by user_id (+ optional site_id); bot_visits have
-- no user_id, so they are scoped to the caller's own site ids (or the one
-- requested, only if owned) — identical to the previous route logic. The route
-- calls this with the service-role client (uid comes from the verified session).
-- Run once in the Supabase SQL editor.

create or replace function public.get_analytics_overview(
  p_uid      uuid,
  p_site_id  uuid,         -- nullable; when set, restrict to this site (if owned)
  p_bot_type text,         -- nullable; 'search' | 'ai' | 'social' | 'unknown'
  p_start    timestamptz,
  p_end      timestamptz
) returns jsonb
language sql
stable
as $$
with scope as ( -- the caller's owned sites that match the optional site filter
  select id from public.sites
  where user_id = p_uid
    and (p_site_id is null or id = p_site_id)
),
r as ( -- renders in range, scoped to the user (+ optional site / bot type)
  select url, bot_name, bot_type, cache_hit, render_time_ms, created_at
  from public.renders
  where user_id = p_uid
    and created_at >= p_start and created_at <= p_end
    and (p_site_id is null or site_id = p_site_id)
    and (p_bot_type is null or bot_type = p_bot_type)
),
v as ( -- bot visits in range, scoped to owned sites (+ optional bot type)
  select url, bot_name, bot_type, created_at
  from public.bot_visits
  where site_id in (select id from scope)
    and created_at >= p_start and created_at <= p_end
    and (p_bot_type is null or bot_type = p_bot_type)
),
trend as (
  select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as d,
         count(*) as renders,
         count(*) filter (where cache_hit) as cache_hits
  from r group by 1 order by 1
),
timeline as (
  select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as d,
         count(*) filter (where lower(coalesce(bot_name,'')) like '%google%') as googlebot,
         count(*) filter (where lower(coalesce(bot_name,'')) like '%gpt%')    as gptbot,
         count(*) filter (where lower(coalesce(bot_name,'')) like '%bing%')   as bingbot,
         count(*) filter (where lower(coalesce(bot_name,'')) not like all (array['%google%','%gpt%','%bing%'])) as others
  from v group by 1 order by 1
),
pages_base as ( -- top pages by bot hits (from bot_visits only — no row blow-up)
  select url,
         count(*)                 as hits,
         count(distinct bot_name) as unique_bots,
         max(created_at)          as last_crawled
  from v group by url order by hits desc limit 10
),
pages_cache as ( -- did any render of those URLs serve from cache?
  select url, bool_or(cache_hit) as cache_hit
  from r where url in (select url from pages_base) group by url
),
pages as (
  select pb.url, pb.hits, pb.unique_bots, pb.last_crawled,
         coalesce(pc.cache_hit, false) as cache_hit
  from pages_base pb left join pages_cache pc on pc.url = pb.url
  order by pb.hits desc
),
crawlers as (
  select coalesce(nullif(bot_name, ''), 'Unknown') as bot, count(*) as reqs
  from v group by 1 order by reqs desc limit 10
),
totals as (
  select
    (select count(*) from v) as total_visits,
    (select count(*) from r) as total_renders,
    (select count(*) from r where cache_hit) as cache_hits,
    (select count(distinct url) from (select url from v union select url from r) u) as unique_urls,
    (select round(avg(render_time_ms)) from r where render_time_ms is not null) as avg_response,
    (select round(avg(render_time_ms)) from r where cache_hit and render_time_ms is not null) as avg_cache_serve,
    (select round(avg(render_time_ms)) from r where not cache_hit and render_time_ms is not null) as avg_render
)
select jsonb_build_object(
  'summary', jsonb_build_object(
    'totalBotRequests', t.total_visits,
    'totalRenders',     t.total_renders,
    'uniqueUrls',       t.unique_urls,
    'cacheHitRate',     case when t.total_renders > 0 then round(t.cache_hits::numeric / t.total_renders * 100) else 0 end,
    'avgResponseTime',  coalesce(t.avg_response, 0),
    'avgCacheServeTime',coalesce(t.avg_cache_serve, 0),
    'avgRenderTime',    coalesce(t.avg_render, 0)
  ),
  'renderTrend', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'renders', renders, 'cacheHits', cache_hits)) from trend), '[]'::jsonb),
  'botTimeline', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'googlebot', googlebot, 'gptbot', gptbot, 'bingbot', bingbot, 'others', others)) from timeline), '[]'::jsonb),
  'botTypeSplit', jsonb_build_object(
    'search',  (select count(*) from v where bot_type = 'search'),
    'ai',      (select count(*) from v where bot_type = 'ai'),
    'social',  (select count(*) from v where bot_type = 'social'),
    'unknown', (select count(*) from v where bot_type is null or bot_type not in ('search','ai','social'))
  ),
  'topPages', coalesce((select jsonb_agg(jsonb_build_object('url', url, 'hits', hits, 'uniqueBots', unique_bots, 'lastCrawled', last_crawled, 'cacheHit', cache_hit)) from pages), '[]'::jsonb),
  'topCrawlers', coalesce((select jsonb_agg(jsonb_build_object('botName', bot, 'requests', reqs, 'percentage', case when (select total_visits from totals) > 0 then round(reqs::numeric / (select total_visits from totals) * 100) else 0 end)) from crawlers), '[]'::jsonb)
)
from totals t
$$;

-- Only the service role (used by /api/analytics) may call it.
revoke all on function public.get_analytics_overview(uuid, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
