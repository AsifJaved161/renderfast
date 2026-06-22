-- Tracks when each user last received an email digest, so the digest cron is
-- resumable (spread across daily runs) and idempotent (never double-sends within
-- the interval). Run once in the Supabase SQL editor.

alter table public.users add column if not exists last_digest_sent_at timestamptz;
