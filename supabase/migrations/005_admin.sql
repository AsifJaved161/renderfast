-- Admin dashboard support — columns + tables the /api/admin/* routes expect.
-- Run once in the Supabase SQL editor.

-- ── users: admin / moderation columns ───────────────────────────────────────
alter table public.users add column if not exists is_admin       boolean not null default false;
alter table public.users add column if not exists is_banned      boolean not null default false;
alter table public.users add column if not exists ban_reason     text;
alter table public.users add column if not exists banned_at      timestamptz;
alter table public.users add column if not exists last_login_at  timestamptz;
alter table public.users add column if not exists notes          text;

-- ── plans (admin-managed pricing tiers) ─────────────────────────────────────
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

-- ── admin_logs (audit trail) ────────────────────────────────────────────────
-- FK auto-named admin_logs_admin_id_fkey (used by the logs route join).
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
create index if not exists idx_admin_logs_created on public.admin_logs(created_at desc);
create index if not exists idx_admin_logs_admin   on public.admin_logs(admin_id);

-- ── RLS — admin-only (service role bypasses; admin APIs use service role) ────
alter table public.plans      enable row level security;
alter table public.admin_logs enable row level security;

drop policy if exists "plans_admin_all" on public.plans;
create policy "plans_admin_all" on public.plans
  for all using (exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin));

drop policy if exists "admin_logs_admin_all" on public.admin_logs;
create policy "admin_logs_admin_all" on public.admin_logs
  for all using (exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin));

-- ── Seed default plans (idempotent) ─────────────────────────────────────────
insert into public.plans (name, slug, price_monthly, render_limit, site_limit, cache_size_gb, sort_order)
values
  ('Free',    'free',       0,    1000,    1,    0.1, 0),
  ('Starter', 'starter',   19,   25000,    3,    1,   1),
  ('Pro',     'pro',       49,  200000,   10,   10,   2),
  ('Agency',  'agency',   199, 1000000, 9999,  100,   3)
on conflict (slug) do nothing;

-- ── Seed the first admin (change the email to your admin account) ───────────
update public.users set is_admin = true where email = 'sadiid161@gmail.com';
