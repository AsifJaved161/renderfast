-- AI Visibility Tracker — measures whether a client's brand gets mentioned/cited
-- by AI answer engines (ChatGPT via OpenAI, Perplexity Sonar) for a set of
-- niche prompts the client tracks. Paid-tier only; per-plan prompt quota is set
-- by the platform admin (app_settings). Run once in the Supabase SQL editor.

-- ── Per-site tracking config (brand name + last-checked) ──────────────────────
create table if not exists public.ai_visibility_sites (
  site_id         uuid primary key references public.sites(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  brand_name      text not null,
  tracking        boolean not null default false,
  last_checked_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_ai_vis_sites_user on public.ai_visibility_sites (user_id);

-- ── Tracked prompts (one row per query the client wants to monitor) ───────────
create table if not exists public.ai_visibility_prompts (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.sites(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  prompt     text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_vis_prompts_site on public.ai_visibility_prompts (site_id);

-- ── Check results (one row per prompt × engine per scan run) ──────────────────
-- prompt_id is nullable + ON DELETE SET NULL so editing the prompt list never
-- wipes historical results (the trend graph keeps working). prompt_text snapshots
-- the wording at scan time. Rows of one scan share the same run_at.
create table if not exists public.ai_visibility_checks (
  id           uuid primary key default gen_random_uuid(),
  site_id      uuid not null references public.sites(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  prompt_id    uuid references public.ai_visibility_prompts(id) on delete set null,
  prompt_text  text not null,
  engine       text not null check (engine in ('chatgpt', 'perplexity')),
  mentioned    boolean not null default false,
  citation_url text,
  snippet      text,
  error        text,
  run_at       timestamptz not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_ai_vis_checks_site_run
  on public.ai_visibility_checks (site_id, run_at desc);

-- ── Row Level Security — site-scoped (service role bypasses for the APIs) ──────
alter table public.ai_visibility_sites enable row level security;
drop policy if exists "ai_vis_sites_via_site" on public.ai_visibility_sites;
create policy "ai_vis_sites_via_site" on public.ai_visibility_sites
  for all using (
    exists (select 1 from public.sites s where s.id = site_id and s.user_id = auth.uid())
  );

alter table public.ai_visibility_prompts enable row level security;
drop policy if exists "ai_vis_prompts_via_site" on public.ai_visibility_prompts;
create policy "ai_vis_prompts_via_site" on public.ai_visibility_prompts
  for all using (
    exists (select 1 from public.sites s where s.id = site_id and s.user_id = auth.uid())
  );

alter table public.ai_visibility_checks enable row level security;
drop policy if exists "ai_vis_checks_via_site" on public.ai_visibility_checks;
create policy "ai_vis_checks_via_site" on public.ai_visibility_checks
  for all using (
    exists (select 1 from public.sites s where s.id = site_id and s.user_id = auth.uid())
  );
