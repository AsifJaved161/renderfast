-- AI Visibility Tracker — expand the set of answer engines from {chatgpt,
-- perplexity} to {chatgpt, gemini, claude, grok, perplexity}. Run once in the
-- Supabase SQL editor (after 025_ai_visibility.sql).

alter table public.ai_visibility_checks
  drop constraint if exists ai_visibility_checks_engine_check;

alter table public.ai_visibility_checks
  add constraint ai_visibility_checks_engine_check
  check (engine in ('chatgpt', 'gemini', 'claude', 'grok', 'perplexity'));
