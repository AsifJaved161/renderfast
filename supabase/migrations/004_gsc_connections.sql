-- Google Search Console OAuth connections — one row per user (their linked
-- Google account + tokens). Run once in the Supabase SQL editor.

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

-- Row Level Security — a user can only ever see/manage their own connection.
-- The server routes use the service role (which bypasses RLS).
alter table public.gsc_connections enable row level security;

drop policy if exists "gsc_connections_own" on public.gsc_connections;
create policy "gsc_connections_own" on public.gsc_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
