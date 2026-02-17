-- Ticket 5.1: Region model + deterministic profile assignment
-- Adds canonical region metadata, profile-level location fields, and replay-safe assignment storage.

-- 1) Profiles: persist derived location fields for deterministic assignment.
alter table public.profiles
  add column if not exists country_code text,
  add column if not exists state_code text;

create index if not exists profiles_country_state_idx
  on public.profiles(country_code, state_code);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_country_code_format_chk'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_country_code_format_chk
      check (country_code is null or country_code ~ '^[A-Z]{2}$');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_state_code_format_chk'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_state_code_format_chk
      check (state_code is null or state_code ~ '^[A-Z]{2}$');
  end if;
end $$;

-- 2) Regions: add canonical fields without breaking existing MVP columns.
alter table public.regions
  add column if not exists name text,
  add column if not exists country_code text,
  add column if not exists state_code text,
  add column if not exists is_active boolean not null default false,
  add column if not exists is_launch_region boolean not null default false;

-- Keep legacy inserts safe while retaining geometry/rules shape.
alter table public.regions
  alter column geometry set default '{}'::jsonb,
  alter column rules set default '{}'::jsonb;

update public.regions
set
  name = coalesce(name, display_name, initcap(replace(slug, '-', ' '))),
  country_code = coalesce(
    country_code,
    case
      when slug ~ '^us-[a-z]{2}$' then 'US'
      when slug like 'waitlist-us-%' then 'US'
      when slug = 'waitlist' then 'XX'
      else 'US'
    end
  ),
  state_code = coalesce(
    state_code,
    case
      when slug ~ '^us-[a-z]{2}$' then upper(substring(slug from '^us-([a-z]{2})$'))
      when slug like 'waitlist-us-%' then upper(substring(slug from '^waitlist-us-([a-z]{2})$'))
      else null
    end
  ),
  is_active = case
    when state = 'open' then true
    when state in ('closed', 'waitlisted') then false
    else is_active
  end,
  is_launch_region = case
    when state = 'open' then true
    else is_launch_region
  end
where
  name is null
  or country_code is null
  or (state = 'open' and (is_active = false or is_launch_region = false));

alter table public.regions
  alter column name set not null,
  alter column country_code set not null;

create index if not exists regions_country_state_idx
  on public.regions(country_code, state_code);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'regions_country_code_format_chk'
      and conrelid = 'public.regions'::regclass
  ) then
    alter table public.regions
      add constraint regions_country_code_format_chk
      check (country_code ~ '^[A-Z]{2}$');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'regions_state_code_format_chk'
      and conrelid = 'public.regions'::regclass
  ) then
    alter table public.regions
      add constraint regions_state_code_format_chk
      check (state_code is null or state_code ~ '^[A-Z]{2}$');
  end if;
end $$;

-- 3) Canonical profile assignment table.
create table if not exists public.profile_region_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  region_id uuid not null references public.regions(id) on delete restrict,
  assignment_source text not null,
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profile_region_assignments_profile_id_uniq'
      and conrelid = 'public.profile_region_assignments'::regclass
  ) then
    alter table public.profile_region_assignments
      add constraint profile_region_assignments_profile_id_uniq unique (profile_id);
  end if;
end $$;

create index if not exists profile_region_assignments_region_id_idx
  on public.profile_region_assignments(region_id);

-- updated_at trigger for assignment rows.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'profile_region_assignments_set_updated_at') then
    create trigger profile_region_assignments_set_updated_at
    before update on public.profile_region_assignments
    for each row execute function public.set_updated_at();
  end if;
end $$;

-- 4) RLS: users can read their own assignment via profile ownership; writes are service-role only.
alter table public.profile_region_assignments enable row level security;

drop policy if exists svc_select on public.profile_region_assignments;
create policy svc_select
  on public.profile_region_assignments
  for select
  to service_role
  using (true);

drop policy if exists svc_insert on public.profile_region_assignments;
create policy svc_insert
  on public.profile_region_assignments
  for insert
  to service_role
  with check (true);

drop policy if exists svc_update on public.profile_region_assignments;
create policy svc_update
  on public.profile_region_assignments
  for update
  to service_role
  using (true)
  with check (true);

drop policy if exists svc_delete on public.profile_region_assignments;
create policy svc_delete
  on public.profile_region_assignments
  for delete
  to service_role
  using (true);

drop policy if exists admin_select on public.profile_region_assignments;
create policy admin_select
  on public.profile_region_assignments
  for select
  to authenticated
  using (public.is_admin_user());

drop policy if exists profile_region_assignments_select_own on public.profile_region_assignments;
create policy profile_region_assignments_select_own
  on public.profile_region_assignments
  for select
  to authenticated
  using (public.owns_profile(profile_id));

-- 5) Canonical launch + waitlist region seed rows (idempotent by slug).
insert into public.regions (
  slug,
  display_name,
  state,
  geometry,
  rules,
  name,
  country_code,
  state_code,
  is_active,
  is_launch_region
)
values
  (
    'us-wa',
    'Washington',
    'open',
    '{}'::jsonb,
    '{}'::jsonb,
    'Washington',
    'US',
    'WA',
    true,
    true
  ),
  (
    'waitlist',
    'Waitlist',
    'waitlisted',
    '{}'::jsonb,
    '{}'::jsonb,
    'Waitlist',
    'XX',
    null,
    false,
    false
  )
on conflict (slug) do update
set
  display_name = excluded.display_name,
  state = excluded.state,
  geometry = excluded.geometry,
  rules = excluded.rules,
  name = excluded.name,
  country_code = excluded.country_code,
  state_code = excluded.state_code,
  is_active = excluded.is_active,
  is_launch_region = excluded.is_launch_region;
