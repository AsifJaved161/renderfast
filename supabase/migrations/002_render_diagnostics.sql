-- Render Diagnostics — per-render health + content-visibility data.
-- Run this once in the Supabase SQL editor on existing databases.
-- (New installs also get this via the updated schema.sql.)

create table if not exists public.render_diagnostics (
  id                      uuid primary key default uuid_generate_v4(),
  site_id                 uuid not null references public.sites(id) on delete cascade,
  url                     text not null,
  rendered_at             timestamptz not null default now(),
  console_errors          jsonb not null default '[]'::jsonb,   -- string[]
  failed_requests         jsonb not null default '[]'::jsonb,   -- {url,resourceType,reason}[]
  content_diff_percentage numeric(5,2) not null default 0,      -- % rendered text missing from raw HTML
  missing_seo_elements    jsonb not null default '[]'::jsonb,   -- {element,inRaw,inRendered,jsOnly}[]
  render_succeeded        boolean not null default true,
  render_time_ms          integer
);

-- Latest-per-site and latest-per-URL lookups (also drives the N-run prune).
create index if not exists idx_render_diagnostics_site
  on public.render_diagnostics (site_id, rendered_at desc);

create index if not exists idx_render_diagnostics_url
  on public.render_diagnostics (site_id, url, rendered_at desc);

-- Row Level Security — scoped through the parent site (service role bypasses this).
alter table public.render_diagnostics enable row level security;

drop policy if exists "render_diagnostics_via_site" on public.render_diagnostics;
create policy "render_diagnostics_via_site" on public.render_diagnostics
  for all using (
    exists (select 1 from public.sites s where s.id = site_id and s.user_id = auth.uid())
  );
