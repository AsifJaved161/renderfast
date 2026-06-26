-- SEO Reports data — extra per-render page metadata captured by the diagnostics
-- module, used to build the duplicate-titles / duplicate-contents / low-word-
-- count / missing-hreflang reports and the page explorer. All NULLABLE so
-- existing render_diagnostics rows are untouched (they stay NULL until re-scanned
-- or re-rendered). Run once in the Supabase SQL editor.

alter table public.render_diagnostics add column if not exists page_title     text;
alter table public.render_diagnostics add column if not exists canonical_url  text;
alter table public.render_diagnostics add column if not exists word_count     integer;
alter table public.render_diagnostics add column if not exists content_hash   text;   -- hash of visible body text (duplicate detection)
alter table public.render_diagnostics add column if not exists inner_links    jsonb;  -- string[] of same-domain paths linked from the page
alter table public.render_diagnostics add column if not exists hreflang_links jsonb;  -- { lang, href }[] alternate-language links
alter table public.render_diagnostics add column if not exists http_status    integer; -- status the (no-JS) crawler fetch returned

-- Grouping by content hash / title for the duplicate reports.
create index if not exists idx_render_diag_content_hash
  on public.render_diagnostics (site_id, content_hash);
