-- Platform settings — admin-editable key/value config (Cloudflare creds,
-- render-queue limits, cache TTL, …). Values here OVERRIDE the matching env var;
-- if a key is absent the code falls back to the env var / built-in default.
-- Run once in the Supabase SQL editor.

create table if not exists public.app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

-- Admin-only (service role bypasses for the admin APIs).
alter table public.app_settings enable row level security;

drop policy if exists "app_settings_admin_all" on public.app_settings;
create policy "app_settings_admin_all" on public.app_settings
  for all using (exists (select 1 from public.users u where u.id = auth.uid() and u.is_admin));
