-- Ticket 5.2: Canonical waitlist operations + profile-based idempotency

-- 1) Canonicalize waitlist_entries around profile ownership and deterministic notification tracking.
alter table public.waitlist_entries
  add column if not exists id uuid,
  add column if not exists profile_id uuid references public.profiles(id) on delete cascade,
  add column if not exists reason text,
  add column if not exists last_notified_at timestamptz;

update public.waitlist_entries
set id = gen_random_uuid()
where id is null;

alter table public.waitlist_entries
  alter column id set default gen_random_uuid();

update public.waitlist_entries
set source = 'sms'
where source is null;

alter table public.waitlist_entries
  alter column source set default 'sms',
  alter column source set not null;

update public.waitlist_entries w
set profile_id = p.id
from public.profiles p
where p.user_id = w.user_id
  and w.profile_id is null;

-- Fail fast if any legacy waitlist rows cannot be mapped to profiles.
do $$
declare
  missing_profile_count int;
begin
  select count(*)
  into missing_profile_count
  from public.waitlist_entries
  where profile_id is null;

  if missing_profile_count > 0 then
    raise exception
      'ticket 5.2 aborted: % waitlist_entries rows could not be mapped to profiles',
      missing_profile_count;
  end if;
end $$;

alter table public.waitlist_entries
  alter column profile_id set not null;

update public.waitlist_entries
set last_notified_at = coalesce(last_notified_at, notified_at)
where last_notified_at is null
  and notified_at is not null;

alter table public.waitlist_entries
  drop constraint if exists waitlist_entries_pkey;

alter table public.waitlist_entries
  add constraint waitlist_entries_pkey primary key (id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'waitlist_entries_profile_id_uniq'
      and conrelid = 'public.waitlist_entries'::regclass
  ) then
    alter table public.waitlist_entries
      add constraint waitlist_entries_profile_id_uniq unique (profile_id);
  end if;
end $$;

create index if not exists waitlist_entries_profile_idx
  on public.waitlist_entries(profile_id);

create index if not exists waitlist_entries_region_status_idx
  on public.waitlist_entries(region_id, status);

create index if not exists waitlist_entries_created_at_idx
  on public.waitlist_entries(created_at);

-- 2) RLS: own-profile reads; explicit service/admin access.
alter table public.waitlist_entries enable row level security;

drop policy if exists waitlist_entries_select_self on public.waitlist_entries;
drop policy if exists waitlist_entries_select_own on public.waitlist_entries;
create policy waitlist_entries_select_own
  on public.waitlist_entries
  for select
  to authenticated
  using (public.owns_profile(profile_id));

drop policy if exists svc_select on public.waitlist_entries;
create policy svc_select
  on public.waitlist_entries
  for select
  to service_role
  using (true);

drop policy if exists svc_insert on public.waitlist_entries;
create policy svc_insert
  on public.waitlist_entries
  for insert
  to service_role
  with check (true);

drop policy if exists svc_update on public.waitlist_entries;
create policy svc_update
  on public.waitlist_entries
  for update
  to service_role
  using (true)
  with check (true);

drop policy if exists svc_delete on public.waitlist_entries;
create policy svc_delete
  on public.waitlist_entries
  for delete
  to service_role
  using (true);

drop policy if exists admin_select on public.waitlist_entries;
create policy admin_select
  on public.waitlist_entries
  for select
  to authenticated
  using (public.is_admin_user());
