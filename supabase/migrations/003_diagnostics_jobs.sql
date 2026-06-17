-- Diagnostics scan jobs — one row per "Re-scan" request for a site.
-- The worker (service role) renders the job's URLs and captures diagnostics,
-- updating progress as it goes. Run this once in the Supabase SQL editor.

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

-- Latest job per site (status polling) + active-job lookups (dedupe / per-user cap).
create index if not exists idx_diag_jobs_site
  on public.diagnostics_jobs (site_id, created_at desc);
create index if not exists idx_diag_jobs_user_status
  on public.diagnostics_jobs (user_id, status);

-- Race-proof dedupe: at most ONE active (queued/running) job per site. Two
-- concurrent enqueue requests → the second insert fails (handled in the API).
create unique index if not exists uniq_active_diag_job_per_site
  on public.diagnostics_jobs (site_id)
  where status in ('queued', 'running');

-- Row Level Security — site-scoped, identical to render_diagnostics.
-- The worker uses the service role (which bypasses RLS); clients can only ever
-- read/write jobs for sites they own.
alter table public.diagnostics_jobs enable row level security;

drop policy if exists "diagnostics_jobs_via_site" on public.diagnostics_jobs;
create policy "diagnostics_jobs_via_site" on public.diagnostics_jobs
  for all using (
    exists (select 1 from public.sites s where s.id = site_id and s.user_id = auth.uid())
  );
