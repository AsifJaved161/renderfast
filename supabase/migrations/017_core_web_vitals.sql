-- Core Web Vitals (field data from the Chrome UX Report) stored per diagnostic.
-- NULLABLE so existing rows are untouched (they stay NULL until re-scanned with
-- a Google API key configured). Run once in the Supabase SQL editor.
--
-- Shape: { source: 'url'|'origin', collectedFrom, lcp:{value,rating}, cls, inp,
--          fcp, ttfb, overall: 'good'|'needs-improvement'|'poor' }

alter table public.render_diagnostics
  add column if not exists core_web_vitals jsonb;
