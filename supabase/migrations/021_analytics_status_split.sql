-- Extends get_analytics_overview (migration 019) with HTTP-status breakdowns for
-- the dashboard: hits by status class (2xx/3xx/4xx/5xx) and mean response time
-- by status class. Additive — all existing JSON keys are unchanged. Idempotent
-- (create or replace). Run once in the Supabase SQL editor.

create or replace function public.get_analytics_overview(
  p_uid      uuid,
  p_site_id  uuid,
  p_bot_type text,
  p_start    timestamptz,
  p_end      timestamptz
) returns jsonb
language sql
stable
as $$
with scope as (
  select id from public.sites
  where user_id = p_uid
    and (p_site_id is null or id = p_site_id)
),
r as (
  select url, bot_name, bot_type, cache_hit, render_time_ms, status_code, created_at
  from public.renders
  where user_id = p_uid
    and created_at >= p_start and created_at <= p_end
    and (p_site_id is null or site_id = p_site_id)
    and (p_bot_type is null or bot_type = p_bot_type)
),
v as (
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
pages_base as (
  select url, count(*) as hits, count(distinct bot_name) as unique_bots, max(created_at) as last_crawled
  from v group by url order by hits desc limit 10
),
pages_cache as (
  select url, bool_or(cache_hit) as cache_hit from r where url in (select url from pages_base) group by url
),
pages as (
  select pb.url, pb.hits, pb.unique_bots, pb.last_crawled, coalesce(pc.cache_hit, false) as cache_hit
  from pages_base pb left join pages_cache pc on pc.url = pb.url
  order by pb.hits desc
),
crawlers as (
  select coalesce(nullif(bot_name, ''), 'Unknown') as bot, count(*) as reqs
  from v group by 1 order by reqs desc limit 10
),
status_split as ( -- hits + mean render time by HTTP status class
  select
    case
      when status_code >= 200 and status_code < 300 then '2xx'
      when status_code >= 300 and status_code < 400 then '3xx'
      when status_code >= 400 and status_code < 500 then '4xx'
      when status_code >= 500 then '5xx'
      else 'other'
    end as code,
    count(*) as hits,
    round(avg(render_time_ms) filter (where render_time_ms is not null)) as avg_ms
  from r
  where status_code is not null
  group by 1 order by 1
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
  'topCrawlers', coalesce((select jsonb_agg(jsonb_build_object('botName', bot, 'requests', reqs, 'percentage', case when (select total_visits from totals) > 0 then round(reqs::numeric / (select total_visits from totals) * 100) else 0 end)) from crawlers), '[]'::jsonb),
  'statusSplit', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'hits', hits)) from status_split), '[]'::jsonb),
  'responseByStatus', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'avgMs', coalesce(avg_ms, 0))) from status_split), '[]'::jsonb)
)
from totals t
$$;

revoke all on function public.get_analytics_overview(uuid, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
