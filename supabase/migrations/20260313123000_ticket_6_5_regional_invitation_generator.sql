begin;

alter table public.linkups
  add column if not exists activity_key text,
  add column if not exists proposed_time_window text;

create or replace function public.regional_generator_try_lock(p_region_id text)
returns boolean
language sql
as $$
  select pg_try_advisory_lock(hashtext(p_region_id));
$$;

create or replace function public.regional_generator_unlock(p_region_id text)
returns boolean
language sql
as $$
  select pg_advisory_unlock(hashtext(p_region_id));
$$;

commit;
