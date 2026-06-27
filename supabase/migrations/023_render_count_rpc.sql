-- Atomic render-count increment (user + optional site). Replaces the read-then-
-- write pattern in proxy/recache/render and adds counting to the caching-queue
-- drainer, so concurrent renders can't lose updates (no double-spend / no
-- under-count). Safe to run repeatedly. Run once in the Supabase SQL editor.

create or replace function public.increment_render_counts(
  p_user uuid,
  p_site uuid,
  p_n    integer default 1
) returns void
language plpgsql
as $$
begin
  if p_n is null or p_n <= 0 then
    return;
  end if;
  update public.users set render_count = render_count + p_n, updated_at = now()
    where id = p_user;
  if p_site is not null then
    update public.sites set render_count = render_count + p_n, updated_at = now()
      where id = p_site;
  end if;
end;
$$;

revoke all on function public.increment_render_counts(uuid, uuid, integer) from public, anon, authenticated;
