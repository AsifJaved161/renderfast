-- /api/render can prerender ANY URL on demand, which may not belong to a
-- registered site. Previously renders.site_id / cache_entries.site_id were NOT
-- NULL, so those generic renders failed their insert silently (page served +
-- billed, but invisible in Render History / Cache Manager). Make site_id
-- nullable so every render is logged; registered-domain renders still link to
-- their site. Idempotent. Run once in the Supabase SQL editor.

alter table public.renders       alter column site_id drop not null;
alter table public.cache_entries alter column site_id drop not null;
