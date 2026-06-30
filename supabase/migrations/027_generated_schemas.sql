-- Generated structured-data (JSON-LD) per page, with a review state machine:
--   generated → pending → (client reviews) → approved / rejected / edited → served
-- One row per (site_id, url, schema_type). Re-generation upserts in place (no
-- duplicates) via the upsert_generated_schema() RPC below, which preserves a
-- prior client decision unless the content meaningfully changed. Run once in the
-- Supabase SQL editor (after 026_ai_visibility_engines.sql).

create table if not exists public.generated_schemas (
  id               uuid primary key default gen_random_uuid(),
  site_id          uuid not null references public.sites(id) on delete cascade,
  url              text not null,
  schema_type      text not null
                     check (schema_type in ('Article', 'Product', 'FAQPage', 'Organization')),
  json_ld          jsonb not null,                 -- the auto-generated JSON-LD
  extracted_fields jsonb not null default '{}'::jsonb, -- field → {value, source} breakdown
  confidence       text not null default 'medium'
                     check (confidence in ('high', 'medium', 'low')),
  status           text not null default 'pending'
                     check (status in ('pending', 'approved', 'rejected', 'edited')),
  -- The client's manual edits (when status = 'edited'); null otherwise. Preserved
  -- across re-generations so a client's edits are never silently discarded.
  edited_json_ld   jsonb,
  -- True when a re-generation reset a previously-reviewed row back to 'pending'
  -- because the content changed — lets the UI flag "content changed, re-review".
  changed          boolean not null default false,
  generated_at     timestamptz not null default now(),
  reviewed_at      timestamptz,
  reviewed_by      uuid references public.users(id),
  created_at       timestamptz not null default now()
);

-- One schema of each type per URL (the upsert conflict target).
create unique index if not exists uniq_generated_schema_site_url_type
  on public.generated_schemas (site_id, url, schema_type);

-- Listing pending/changed items for review.
create index if not exists idx_generated_schemas_site_status
  on public.generated_schemas (site_id, status);

-- Fast lookup of what to actually serve for a page (approved or client-edited).
create index if not exists idx_generated_schemas_serve
  on public.generated_schemas (site_id, url)
  where status in ('approved', 'edited');

-- ── Smart upsert RPC ──────────────────────────────────────────────────────────
-- Insert a freshly generated schema, or update the existing row for this
-- (site_id, url, schema_type). Decision logic:
--   • No existing row            → insert as 'pending'.
--   • Existing row still pending  → refresh content, keep 'pending'.
--   • Existing row reviewed AND content unchanged → refresh metadata only,
--     KEEP the prior decision (approved/rejected/edited) so re-scans don't
--     reset client decisions.
--   • Existing row reviewed AND content changed   → refresh content, RESET to
--     'pending', set changed = true, clear reviewed_at/by so the client
--     re-reviews instead of silently auto-approving new content under an old
--     approval. The client's edited_json_ld is left intact.
-- "Content changed" = jsonb inequality (IS DISTINCT FROM). jsonb compares
-- semantically (key order / whitespace independent), so a cosmetic
-- re-serialization won't be treated as a change.
create or replace function public.upsert_generated_schema(
  p_site_id          uuid,
  p_url              text,
  p_schema_type      text,
  p_json_ld          jsonb,
  p_extracted_fields jsonb,
  p_confidence       text
) returns public.generated_schemas
language plpgsql
as $$
declare
  existing public.generated_schemas;
  result   public.generated_schemas;
begin
  select * into existing
    from public.generated_schemas
   where site_id = p_site_id and url = p_url and schema_type = p_schema_type;

  if not found then
    insert into public.generated_schemas
      (site_id, url, schema_type, json_ld, extracted_fields, confidence, status, changed, generated_at)
    values
      (p_site_id, p_url, p_schema_type, p_json_ld, p_extracted_fields, p_confidence, 'pending', false, now())
    returning * into result;
    return result;
  end if;

  if existing.status in ('approved', 'rejected', 'edited')
     and existing.json_ld is distinct from p_json_ld then
    -- Reviewed before, but the content meaningfully changed → re-review.
    update public.generated_schemas
       set json_ld          = p_json_ld,
           extracted_fields = p_extracted_fields,
           confidence       = p_confidence,
           status           = 'pending',
           changed          = true,
           generated_at     = now(),
           reviewed_at      = null,
           reviewed_by      = null
     where id = existing.id
    returning * into result;
  else
    -- Still pending, or content identical → refresh content, keep the decision.
    update public.generated_schemas
       set json_ld          = p_json_ld,
           extracted_fields = p_extracted_fields,
           confidence       = p_confidence,
           generated_at     = now()
     where id = existing.id
    returning * into result;
  end if;

  return result;
end;
$$;

-- ── Row Level Security — site-scoped (service role bypasses for the APIs) ──────
alter table public.generated_schemas enable row level security;
drop policy if exists "generated_schemas_via_site" on public.generated_schemas;
create policy "generated_schemas_via_site" on public.generated_schemas
  for all using (
    exists (select 1 from public.sites s where s.id = site_id and s.user_id = auth.uid())
  );
