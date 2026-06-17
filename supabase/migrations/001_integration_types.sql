-- Widen sites.integration_type to the real integration methods.
-- Run this once in the Supabase SQL editor on existing databases.
-- (New installs already get this via the updated schema.sql.)

alter table public.sites
  drop constraint if exists sites_integration_type_check;

alter table public.sites
  add constraint sites_integration_type_check
  check (
    integration_type is null
    or integration_type in ('script', 'middleware', 'worker', 'nginx', 'dns', 'wordpress')
  );
