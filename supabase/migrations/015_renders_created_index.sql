-- Admin Renders Monitor scales by ordering/filtering on created_at. The existing
-- idx_renders_user_created is (user_id, created_at) — its leading column is
-- user_id, so it can't serve the unfiltered "newest first" tail or the
-- date-window stat counts (today / month / 7d). Add a standalone created_at
-- index for those. Run once in the Supabase SQL editor.

create index if not exists idx_renders_created on public.renders (created_at desc);
