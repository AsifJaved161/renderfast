-- Adds a flag the proxy sets when it SKIPS injecting a generated schema because
-- the page already ships its own JSON-LD of that type. Lets the client dashboard
-- show "already present on page, not modified" instead of the schema looking
-- un-served. Run once in the Supabase SQL editor (after 027_generated_schemas.sql).

alter table public.generated_schemas
  add column if not exists already_present boolean not null default false;
