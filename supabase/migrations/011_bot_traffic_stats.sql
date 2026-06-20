-- Per-bot, per-site, per-day traffic volume.
--
-- One row per (site_id, bot_name, date) — NOT one row per request. Each served
-- bot request increments request_count + bytes_served on the day's row, so the
-- table stays tiny (≈ sites × distinct-bots × days) no matter the traffic.
-- Unknown/unclassified bots are grouped under bot_name = 'other' by the caller.
-- Run once in the Supabase SQL editor.

create table if not exists public.bot_traffic_stats (
  id            uuid primary key default gen_random_uuid(),
  site_id       uuid not null references public.sites(id) on delete cascade,
  bot_name      text not null,
  date          date not null default current_date,
  request_count integer not null default 0,
  bytes_served  bigint  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (site_id, bot_name, date)
);

create index if not exists idx_bot_traffic_site_date
  on public.bot_traffic_stats (site_id, date desc);

-- Atomic upsert+increment. Supabase JS .upsert() overwrites; this RPC adds.
-- One round-trip, race-safe via the unique constraint + ON CONFLICT.
create or replace function public.increment_bot_traffic(
  p_site_id  uuid,
  p_bot_name text,
  p_bytes    bigint
) returns void
language sql
as $$
  insert into public.bot_traffic_stats (site_id, bot_name, date, request_count, bytes_served)
  values (p_site_id, coalesce(nullif(p_bot_name, ''), 'other'), current_date, 1, greatest(p_bytes, 0))
  on conflict (site_id, bot_name, date) do update
    set request_count = public.bot_traffic_stats.request_count + 1,
        bytes_served  = public.bot_traffic_stats.bytes_served + greatest(excluded.bytes_served, 0),
        updated_at    = now();
$$;
