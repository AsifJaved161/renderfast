-- Team / multi-user accounts. An "account" is still a row in public.users (the
-- OWNER). team_members grants OTHER users access to an owner's account with a
-- role. Sites/cache/etc. ownership (sites.user_id) is unchanged — a member acts
-- *as* the owner via the effective-account resolution in middleware.
-- Run once in the Supabase SQL editor.

create table if not exists public.team_members (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references public.users(id) on delete cascade, -- account being shared
  member_user_id uuid references public.users(id) on delete cascade,          -- null until invite accepted
  invited_email  text not null,
  role           text not null default 'member' check (role in ('admin', 'member', 'viewer')),
  status         text not null default 'pending' check (status in ('pending', 'active')),
  invite_token   text,                                                        -- accept-link token
  invited_by     uuid references public.users(id),
  created_at     timestamptz not null default now(),
  accepted_at    timestamptz,
  unique (owner_user_id, invited_email)
);

create index if not exists idx_team_members_owner  on public.team_members (owner_user_id);
create index if not exists idx_team_members_member on public.team_members (member_user_id) where member_user_id is not null;
create index if not exists idx_team_members_token  on public.team_members (invite_token) where invite_token is not null;

-- RLS: the owner sees their own team; a member sees rows where they are the
-- member. Server routes use the service role (bypasses RLS); middleware uses the
-- anon client as the logged-in user, which this policy permits for resolution.
alter table public.team_members enable row level security;
drop policy if exists "team_members_visible" on public.team_members;
create policy "team_members_visible" on public.team_members
  for all using (owner_user_id = auth.uid() or member_user_id = auth.uid());
