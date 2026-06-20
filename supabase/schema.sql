-- RenderFast — Supabase PostgreSQL Schema
-- Run this in your Supabase SQL editor to set up the database.

-- ── Extensions ────────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. USERS
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.users (
  id                     uuid primary key references auth.users(id) on delete cascade,
  email                  text not null unique,
  full_name              text,
  company_name           text,
  avatar_url             text,
  plan                   text not null default 'free' check (plan in ('free', 'starter', 'pro', 'agency')),
  render_count           integer not null default 0,
  render_limit           integer not null default 1000,
  api_key                text unique default ('rf_' || replace(gen_random_uuid()::text, '-', '')),
  stripe_customer_id     text,
  stripe_subscription_id text,
  notification_email     boolean not null default true,
  monthly_reset_at       timestamptz not null default now(),
  is_admin               boolean not null default false,
  is_banned              boolean not null default false,
  ban_reason             text,
  banned_at              timestamptz,
  last_login_at          timestamptz,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. SITES
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.sites (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references public.users(id) on delete cascade,
  domain           text not null,
  name             text,
  integration_type text check (integration_type in ('script', 'middleware', 'worker', 'nginx', 'dns', 'wordpress')),
  status           text not null default 'pending' check (status in ('active', 'inactive', 'pending')),
  render_count     integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, domain)
);

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. RENDERS
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.renders (
  id             uuid primary key default uuid_generate_v4(),
  site_id        uuid not null references public.sites(id) on delete cascade,
  user_id        uuid not null references public.users(id) on delete cascade,
  url            text not null,
  bot_name       text,
  bot_type       text check (bot_type in ('search', 'ai', 'social', 'unknown')),
  status_code    integer,
  render_time_ms integer,
  cache_hit      boolean not null default false,
  user_agent     text,
  ip_address     text,
  created_at     timestamptz not null default now()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. BOT_VISITS
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.bot_visits (
  id               uuid primary key default uuid_generate_v4(),
  site_id          uuid not null references public.sites(id) on delete cascade,
  url              text not null,
  bot_name         text,
  bot_type         text check (bot_type in ('search', 'ai', 'social', 'unknown')),
  user_agent       text,
  ip_address       text,
  served_markdown  boolean not null default false,
  created_at       timestamptz not null default now()
);

-- Per-bot, per-site, per-day traffic volume (one row per site+bot+day, NOT per
-- request — incremented via increment_bot_traffic(). Unknown bots → 'other').
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

-- Atomic upsert+increment (race-safe via the unique constraint + ON CONFLICT).
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

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. SITEMAPS
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.sitemaps (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.users(id) on delete cascade,
  site_id         uuid not null references public.sites(id) on delete cascade,
  sitemap_url     text not null,
  last_crawled_at timestamptz,
  urls_found      integer not null default 0,
  status          text not null default 'active' check (status in ('active', 'paused', 'error')),
  check_interval_days integer not null default 5,
  created_at      timestamptz not null default now()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. CACHE_ENTRIES
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.cache_entries (
  id              uuid primary key default uuid_generate_v4(),
  site_id         uuid not null references public.sites(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  url             text not null,
  url_hash        text not null unique,
  status_code     integer,
  html_size_bytes integer,
  render_time_ms  integer,
  cached_at       timestamptz not null default now(),
  expires_at      timestamptz,
  is_mobile       boolean not null default false,
  content_hash    text,
  etag            text,
  last_modified   text
);

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. CACHING_QUEUE
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.caching_queue (
  id            uuid primary key default uuid_generate_v4(),
  site_id       uuid not null references public.sites(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  url           text not null,
  priority      integer not null default 5,
  status        text not null default 'pending' check (status in ('pending', 'rendering', 'completed', 'failed')),
  error_message text,
  attempts      integer not null default 0,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

-- ══════════════════════════════════════════════════════════════════════════════
-- 8. BROKEN_LINKS
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.broken_links (
  id          uuid primary key default uuid_generate_v4(),
  site_id     uuid not null references public.sites(id) on delete cascade,
  url         text not null,
  source_url  text,
  status_code integer,
  detected_at timestamptz not null default now(),
  resolved    boolean not null default false
);

-- ══════════════════════════════════════════════════════════════════════════════
-- 9. RENDER_DIAGNOSTICS — per-render health + content-visibility data
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.render_diagnostics (
  id                      uuid primary key default uuid_generate_v4(),
  site_id                 uuid not null references public.sites(id) on delete cascade,
  url                     text not null,
  rendered_at             timestamptz not null default now(),
  console_errors          jsonb not null default '[]'::jsonb,
  failed_requests         jsonb not null default '[]'::jsonb,
  content_diff_percentage numeric(5,2) not null default 0,
  missing_seo_elements    jsonb not null default '[]'::jsonb,
  render_succeeded        boolean not null default true,
  render_time_ms          integer,
  geo_signals             jsonb,
  ai_citation_score       numeric
);

-- ══════════════════════════════════════════════════════════════════════════════
-- 10. DIAGNOSTICS_JOBS — one row per "Re-scan" request (worker-processed)
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.diagnostics_jobs (
  id            uuid primary key default uuid_generate_v4(),
  site_id       uuid not null references public.sites(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  urls          jsonb not null default '[]'::jsonb,
  status        text not null default 'queued'
                  check (status in ('queued', 'running', 'done', 'failed')),
  total_count   integer not null default 0,
  done_count    integer not null default 0,
  error_message text,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);

-- ══════════════════════════════════════════════════════════════════════════════
-- 11. GSC_CONNECTIONS — Google Search Console OAuth tokens (one per user)
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.gsc_connections (
  user_id          uuid primary key references public.users(id) on delete cascade,
  google_email     text,
  access_token     text not null,
  refresh_token    text,
  token_expires_at timestamptz,
  scope            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- 12. PLANS + ADMIN_LOGS — admin dashboard
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.plans (
  id             uuid primary key default uuid_generate_v4(),
  name           text not null,
  slug           text not null unique,
  price_monthly  numeric(10,2) not null default 0,
  render_limit   integer not null default 1000,
  site_limit     integer not null default 1,
  cache_size_gb  numeric(10,2) not null default 0,
  features       jsonb,
  stripe_price_id text,
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.admin_logs (
  id          uuid primary key default uuid_generate_v4(),
  admin_id    uuid not null references public.users(id) on delete cascade,
  action      text not null,
  target_type text,
  target_id   text,
  details     jsonb,
  ip_address  text,
  created_at  timestamptz not null default now()
);

-- Admin-editable platform settings (overrides env vars).
create table if not exists public.app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ══════════════════════════════════════════════════════════════════════════════
create index if not exists idx_renders_site_created    on public.renders(site_id, created_at desc);
create index if not exists idx_renders_user_created    on public.renders(user_id, created_at desc);
create index if not exists idx_admin_logs_created      on public.admin_logs(created_at desc);
create index if not exists idx_admin_logs_admin        on public.admin_logs(admin_id);
create index if not exists idx_cache_entries_site_url  on public.cache_entries(site_id, url);
create index if not exists idx_cache_entries_url       on public.cache_entries(url);
create index if not exists idx_cache_entries_user      on public.cache_entries(user_id, cached_at desc);
create index if not exists idx_caching_queue_site_status on public.caching_queue(site_id, status);
create index if not exists idx_caching_queue_user_status on public.caching_queue(user_id, status);
create index if not exists idx_cache_entries_url_hash  on public.cache_entries(url_hash);
create index if not exists idx_bot_visits_site_created on public.bot_visits(site_id, created_at desc);
create index if not exists idx_sites_user_id           on public.sites(user_id);
create index if not exists idx_caching_queue_status    on public.caching_queue(status, priority desc);
create index if not exists idx_sitemaps_site_id        on public.sitemaps(site_id);
create index if not exists idx_broken_links_site_id    on public.broken_links(site_id);
create index if not exists idx_render_diag_site         on public.render_diagnostics(site_id, rendered_at desc);
create index if not exists idx_render_diag_url          on public.render_diagnostics(site_id, url, rendered_at desc);
create index if not exists idx_diag_jobs_site           on public.diagnostics_jobs(site_id, created_at desc);
create index if not exists idx_diag_jobs_user_status    on public.diagnostics_jobs(user_id, status);
create unique index if not exists uniq_active_diag_job_per_site
  on public.diagnostics_jobs(site_id) where status in ('queued', 'running');

-- ══════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY — users only see their own data
-- ══════════════════════════════════════════════════════════════════════════════
alter table public.users         enable row level security;
alter table public.sites         enable row level security;
alter table public.renders       enable row level security;
alter table public.bot_visits    enable row level security;
alter table public.sitemaps      enable row level security;
alter table public.cache_entries enable row level security;
alter table public.caching_queue enable row level security;
alter table public.broken_links  enable row level security;
alter table public.render_diagnostics enable row level security;
alter table public.diagnostics_jobs enable row level security;
alter table public.gsc_connections enable row level security;
alter table public.plans enable row level security;
alter table public.admin_logs enable row level security;
alter table public.app_settings enable row level security;

-- users: own row
create policy "users_own_row" on public.users
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- sites: own rows (user_id column)
create policy "sites_own" on public.sites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- renders: own rows
create policy "renders_own" on public.renders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- sitemaps: own rows
create policy "sitemaps_own" on public.sitemaps
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- cache_entries: own rows
create policy "cache_entries_own" on public.cache_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- caching_queue: own rows
create policy "caching_queue_own" on public.caching_queue
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- bot_visits: scoped through parent site (no user_id column)
create policy "bot_visits_via_site" on public.bot_visits
  for all using (
    exists (select 1 from public.sites s where s.id = site_id and s.user_id = auth.uid())
  );

-- broken_links: scoped through parent site (no user_id column)
create policy "broken_links_via_site" on public.broken_links
  for all using (
    exists (select 1 from public.sites s where s.id = site_id and s.user_id = auth.uid())
  );

-- render_diagnostics: scoped through parent site (no user_id column)
create policy "render_diagnostics_via_site" on public.render_diagnostics
  for all using (
    exists (select 1 from public.sites s where s.id = site_id and s.user_id = auth.uid())
  );

-- diagnostics_jobs: scoped through parent site
create policy "diagnostics_jobs_via_site" on public.diagnostics_jobs
  for all using (
    exists (select 1 from public.sites s where s.id = site_id and s.user_id = auth.uid())
  );

-- gsc_connections: own row
create policy "gsc_connections_own" on public.gsc_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- plans / admin_logs: admin-only (service role bypasses for the admin APIs)
create policy "plans_admin_all" on public.plans
  for all using (exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin));
create policy "admin_logs_admin_all" on public.admin_logs
  for all using (exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin));
create policy "app_settings_admin_all" on public.app_settings
  for all using (exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin));

-- ══════════════════════════════════════════════════════════════════════════════
-- TRIGGER — auto-insert public.users row on auth signup
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
