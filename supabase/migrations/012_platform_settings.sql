-- Platform-wide settings owned by RenderForAI's OWN admin (e.g. Asif) — never
-- editable or visible-as-editable by clients. Distinct from app_settings (which
-- holds text env-overrides); this stores structured jsonb config like the
-- bandwidth $/GB cost estimate. Run once in the Supabase SQL editor.

create table if not exists public.platform_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);

-- Historical record of every bandwidth rate that was EVER active. We never
-- overwrite the rate in place: changing it closes the current row (effective_to)
-- and opens a new one. A month's cost estimate is computed with the rate that
-- was active that day (getRateForDate), so past numbers never silently change
-- when the admin updates the current rate later.
--
-- Intervals are half-open [effective_from, effective_to): the active row has
-- effective_to = null. On any given date exactly one row matches.
create table if not exists public.bot_cost_rate_history (
  id              uuid primary key default gen_random_uuid(),
  rate_per_gb_usd numeric(10,4) not null check (rate_per_gb_usd >= 0),
  effective_from  date not null,
  effective_to    date,                                 -- null = currently active
  set_by          uuid references public.users(id),     -- null = system seed
  created_at      timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

-- Only one open (currently-active) rate row at a time.
create unique index if not exists uniq_bot_cost_rate_active
  on public.bot_cost_rate_history ((true)) where effective_to is null;

create index if not exists idx_bot_cost_rate_from
  on public.bot_cost_rate_history (effective_from desc);

-- ── Seed (date = 2026-06-20) ─────────────────────────────────────────────────
insert into public.platform_settings (key, value)
values (
  'bot_cost_estimate',
  '{"rate_per_gb_usd": 0.08, "rate_source": "Industry average estimate ($0.05–0.12/GB)", "effective_from": "2026-06-20"}'::jsonb
)
on conflict (key) do nothing;

insert into public.bot_cost_rate_history (rate_per_gb_usd, effective_from, effective_to, set_by)
select 0.08, date '2026-06-20', null, null
where not exists (select 1 from public.bot_cost_rate_history);

-- ── RLS — admin-only (service role bypasses for the admin APIs) ───────────────
alter table public.platform_settings enable row level security;
drop policy if exists "platform_settings_admin_all" on public.platform_settings;
create policy "platform_settings_admin_all" on public.platform_settings
  for all using (exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin));

alter table public.bot_cost_rate_history enable row level security;
drop policy if exists "bot_cost_rate_history_admin_all" on public.bot_cost_rate_history;
create policy "bot_cost_rate_history_admin_all" on public.bot_cost_rate_history
  for all using (exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin));
