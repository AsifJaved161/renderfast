-- RenderFast — Admin system additions
-- Run AFTER schema.sql. Safe to re-run (idempotent where possible).

-- ══════════════════════════════════════════════════════════════════════════════
-- A) Extend public.users with admin/moderation columns
-- ══════════════════════════════════════════════════════════════════════════════
alter table public.users add column if not exists is_admin       boolean not null default false;
alter table public.users add column if not exists is_banned      boolean not null default false;
alter table public.users add column if not exists ban_reason     text;
alter table public.users add column if not exists banned_at      timestamptz;
alter table public.users add column if not exists last_login_at  timestamptz;
alter table public.users add column if not exists notes          text;

-- ══════════════════════════════════════════════════════════════════════════════
-- B) admin_logs
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.admin_logs (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references public.users(id) on delete set null,
  action      text not null,
  target_type text,
  target_id   text,
  details     jsonb,
  ip_address  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_admin_logs_admin_id   on public.admin_logs(admin_id);
create index if not exists idx_admin_logs_created_at on public.admin_logs(created_at desc);

-- ══════════════════════════════════════════════════════════════════════════════
-- C) plans (admin-managed)
-- ══════════════════════════════════════════════════════════════════════════════
create table if not exists public.plans (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text unique not null,
  price_monthly  numeric not null,
  render_limit   integer not null,
  site_limit     integer not null,   -- -1 = unlimited
  cache_size_gb  integer not null,
  is_active      boolean not null default true,
  stripe_price_id text,
  features       jsonb,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- D) Seed plans
-- ══════════════════════════════════════════════════════════════════════════════
insert into public.plans (name, slug, price_monthly, render_limit, site_limit, cache_size_gb, features, sort_order)
values
  ('Free',    'free',     0,    1000,    1,   0,
    '["1,000 renders/mo","1 site","Community support"]'::jsonb, 0),
  ('Starter', 'starter',  9,   25000,    3,   1,
    '["25,000 renders/mo","3 sites","Email support"]'::jsonb, 1),
  ('Pro',     'pro',      29, 200000,   10,  10,
    '["200,000 renders/mo","10 sites","Priority support"]'::jsonb, 2),
  ('Agency',  'agency',   79, 1000000,  -1, 100,
    '["1,000,000 renders/mo","Unlimited sites","Dedicated support"]'::jsonb, 3)
on conflict (slug) do nothing;

-- ══════════════════════════════════════════════════════════════════════════════
-- E) RLS — admin_logs: only admins
-- ══════════════════════════════════════════════════════════════════════════════
alter table public.admin_logs enable row level security;

drop policy if exists "admin_logs_admin_only" on public.admin_logs;
create policy "admin_logs_admin_only" on public.admin_logs
  for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin));

-- ══════════════════════════════════════════════════════════════════════════════
-- F) RLS — plans: anyone reads, only admins write
-- ══════════════════════════════════════════════════════════════════════════════
alter table public.plans enable row level security;

drop policy if exists "plans_public_read" on public.plans;
create policy "plans_public_read" on public.plans
  for select using (true);

drop policy if exists "plans_admin_write" on public.plans;
create policy "plans_admin_write" on public.plans
  for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin));
