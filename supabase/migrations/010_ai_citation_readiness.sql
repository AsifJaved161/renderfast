-- AI Citation Readiness — a scoring layer on top of render diagnostics.
-- Adds two NULLABLE columns to render_diagnostics so existing rows are untouched
-- (they simply stay NULL until re-analysed). Run once in the Supabase SQL editor.

-- Per-page "generative engine optimization" signals:
--   { hasQaSchema: boolean, answerUpfront: boolean, quotesCount: int,
--     statsCount: int, citationsCount: int, headingCount: int,
--     hasListOrTable: boolean, fluencyScore: numeric }
alter table public.render_diagnostics
  add column if not exists geo_signals jsonb;

-- Overall AI-citation readiness score (0–100). Nullable; NULL = not yet scored.
alter table public.render_diagnostics
  add column if not exists ai_citation_score numeric;

-- Keep the score within 0–100 without breaking existing NULL rows.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'render_diagnostics_ai_citation_score_range'
  ) then
    alter table public.render_diagnostics
      add constraint render_diagnostics_ai_citation_score_range
      check (ai_citation_score is null or (ai_citation_score >= 0 and ai_citation_score <= 100));
  end if;
end $$;
