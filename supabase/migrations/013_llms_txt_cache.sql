-- Cached llms.txt per site (one row per site). The proxy serves this directly
-- for /llms.txt requests; a weekly cron regenerates it. Run once in Supabase.

create table if not exists public.llms_txt_cache (
  site_id      uuid primary key references public.sites(id) on delete cascade,
  content      text not null,
  generated_at timestamptz not null default now(),
  auto_enabled boolean not null default true
);

-- Row Level Security — owners can read their own row (proxy + cron use the
-- service role, which bypasses RLS).
alter table public.llms_txt_cache enable row level security;
drop policy if exists "llms_txt_cache_via_site" on public.llms_txt_cache;
create policy "llms_txt_cache_via_site" on public.llms_txt_cache
  for all using (
    exists (select 1 from public.sites s where s.id = site_id and s.user_id = auth.uid())
  );
