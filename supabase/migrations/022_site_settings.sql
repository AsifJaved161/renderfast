-- Per-site advanced settings (excluded paths, entry points, custom UA/headers,
-- mobile emulation, blocked resource patterns, per-path cache expiry). Stored as
-- one JSONB blob so new options can be added without further migrations.
-- NULL = use the platform defaults. Run once in the Supabase SQL editor.

alter table public.sites add column if not exists settings jsonb;
