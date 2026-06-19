-- Change-detection validators for smart cache revalidation.
-- Lets us re-render a page ONLY when its content actually changed (cheap
-- conditional GET / fingerprint) instead of on a fixed timer.
-- Run once in the Supabase SQL editor.

alter table public.cache_entries add column if not exists content_hash  text;
alter table public.cache_entries add column if not exists etag          text;
alter table public.cache_entries add column if not exists last_modified text;
