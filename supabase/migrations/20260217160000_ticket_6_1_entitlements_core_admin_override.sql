-- Ticket 6.1: Entitlements core + admin override
-- Canonical profile-based entitlement snapshot with strict RLS and admin override audit fields.

-- 0) Fail fast if required tables/helpers are missing.
do $$
declare
  missing_items text;
begin
  with required_items(name) as (
    values
      ('profiles'),
      ('users'),
      ('profile_region_assignments'),
      ('regions'),
      ('waitlist_entries'),
      ('safety_holds')
  )
  select string_agg(r.name, ', ' order by r.name)
  into missing_items
  from required_items r
  left join pg_tables t
    on t.schemaname = 'public'
   and t.tablename = r.name
  where t.tablename is null;

  if missing_items is not null then
    raise exception 'ticket 6.1 aborted: missing required public tables: %', missing_items;
  end if;
end $$;

-- 1) Canonical entitlements table keyed by profile_id.
create table if not exists public.profile_entitlements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  can_initiate boolean not null default false,
  can_participate boolean not null default false,
  can_exchange_contact boolean not null default false,
  region_override boolean not null default false,
  waitlist_override boolean not null default false,
  safety_override boolean not null default false,
  reason text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profile_entitlements_profile_id_uniq'
      and conrelid = 'public.profile_entitlements'::regclass
  ) then
    alter table public.profile_entitlements
      add constraint profile_entitlements_profile_id_uniq unique (profile_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profile_entitlements_override_reason_required_chk'
      and conrelid = 'public.profile_entitlements'::regclass
  ) then
    alter table public.profile_entitlements
      add constraint profile_entitlements_override_reason_required_chk
      check (
        not (region_override or waitlist_override or safety_override)
        or nullif(btrim(reason), '') is not null
      );
  end if;
end $$;

create index if not exists profile_entitlements_profile_id_idx
  on public.profile_entitlements(profile_id);

create index if not exists profile_entitlements_updated_by_idx
  on public.profile_entitlements(updated_by);

-- 2) updated_at trigger.
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'profile_entitlements_set_updated_at'
  ) then
    create trigger profile_entitlements_set_updated_at
    before update on public.profile_entitlements
    for each row execute function public.set_updated_at();
  end if;
end $$;

-- 3) RLS policies: own select, service full CRUD, admin select+update.
alter table public.profile_entitlements enable row level security;

drop policy if exists profile_entitlements_service_select on public.profile_entitlements;
create policy profile_entitlements_service_select
  on public.profile_entitlements
  for select
  to service_role
  using (true);

drop policy if exists profile_entitlements_service_insert on public.profile_entitlements;
create policy profile_entitlements_service_insert
  on public.profile_entitlements
  for insert
  to service_role
  with check (true);

drop policy if exists profile_entitlements_service_update on public.profile_entitlements;
create policy profile_entitlements_service_update
  on public.profile_entitlements
  for update
  to service_role
  using (true)
  with check (true);

drop policy if exists profile_entitlements_service_delete on public.profile_entitlements;
create policy profile_entitlements_service_delete
  on public.profile_entitlements
  for delete
  to service_role
  using (true);

drop policy if exists profile_entitlements_select_own on public.profile_entitlements;
create policy profile_entitlements_select_own
  on public.profile_entitlements
  for select
  to authenticated
  using (public.owns_profile(profile_id));

drop policy if exists profile_entitlements_admin_select on public.profile_entitlements;
create policy profile_entitlements_admin_select
  on public.profile_entitlements
  for select
  to authenticated
  using (public.is_admin_user());

drop policy if exists profile_entitlements_admin_update on public.profile_entitlements;
create policy profile_entitlements_admin_update
  on public.profile_entitlements
  for update
  to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());
