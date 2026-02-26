-- Ticket 12.1: Admin authentication and RBAC hardening
-- Adds admin role enum, authoritative admin identity mapping, append-only admin audit log,
-- and RLS policies enforcing admin-only access with super-admin role management.

-- 1) Canonical admin role enum.
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'admin_role'
  ) then
    create type public.admin_role as enum ('super_admin', 'moderator', 'ops');
  end if;
end $$;

-- 2) Ensure admin_users has required columns and role shape.
alter table if exists public.admin_users
  add column if not exists user_id uuid,
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.admin_users
  add column if not exists role text;

-- Remove any legacy role CHECK constraints before type conversion.
do $$
declare
  role_constraint record;
begin
  for role_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.admin_users'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%role%'
  loop
    execute format('alter table public.admin_users drop constraint %I', role_constraint.conname);
  end loop;
end $$;

-- Normalize legacy role values and convert role column to enum.
do $$
declare
  role_udt text;
begin
  select c.udt_name
  into role_udt
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'admin_users'
    and c.column_name = 'role';

  if role_udt = 'admin_role' then
    update public.admin_users
    set role =
      case role::text
        when 'super_admin' then 'super_admin'::public.admin_role
        when 'moderator' then 'moderator'::public.admin_role
        when 'ops' then 'ops'::public.admin_role
        when 'support' then 'moderator'::public.admin_role
        when 'viewer' then 'moderator'::public.admin_role
        when 'engineering' then 'ops'::public.admin_role
        when 'operator' then 'ops'::public.admin_role
        else 'ops'::public.admin_role
      end
    where role::text not in ('super_admin', 'moderator', 'ops');
  elsif role_udt is distinct from 'admin_role' then
    update public.admin_users
    set role =
      case role::text
        when 'super_admin' then 'super_admin'
        when 'moderator' then 'moderator'
        when 'ops' then 'ops'
        when 'support' then 'moderator'
        when 'viewer' then 'moderator'
        when 'engineering' then 'ops'
        when 'operator' then 'ops'
        else 'ops'
      end
    where role is null
       or role::text not in ('super_admin', 'moderator', 'ops');

    alter table public.admin_users
      alter column role type public.admin_role
      using (
        case role::text
          when 'super_admin' then 'super_admin'::public.admin_role
          when 'moderator' then 'moderator'::public.admin_role
          when 'ops' then 'ops'::public.admin_role
          when 'support' then 'moderator'::public.admin_role
          when 'viewer' then 'moderator'::public.admin_role
          when 'engineering' then 'ops'::public.admin_role
          when 'operator' then 'ops'::public.admin_role
          else 'ops'::public.admin_role
        end
      );
  end if;
end $$;

-- admin_users is authoritative; every row must map to an auth user id.
do $$
begin
  if exists (select 1 from public.admin_users where user_id is null) then
    raise exception 'ticket 12.1 migration aborted: admin_users contains rows with null user_id';
  end if;
end $$;

alter table public.admin_users
  alter column user_id set not null,
  alter column role set not null;

alter table public.admin_users
  alter column email drop not null;

create unique index if not exists admin_users_user_id_uniq
  on public.admin_users(user_id);

create unique index if not exists admin_users_id_uniq_idx
  on public.admin_users(id);

-- Move admin_users foreign key to auth.users (separate from member user profile rows).
do $$
begin
  alter table public.admin_users
    drop constraint if exists admin_users_user_id_fkey;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_users_user_id_fkey_auth'
      and conrelid = 'public.admin_users'::regclass
  ) then
    alter table public.admin_users
      add constraint admin_users_user_id_fkey_auth
      foreign key (user_id)
      references auth.users(id)
      on delete cascade;
  end if;
end $$;

-- Keep legacy id-addressable relationships valid while making user_id the primary key.
do $$
declare
  pk_name text;
  pk_is_user_id boolean;
begin
  select c.conname,
         (
           array_length(c.conkey, 1) = 1
           and exists (
             select 1
             from unnest(c.conkey) as k(attnum)
             join pg_attribute a
               on a.attrelid = c.conrelid
              and a.attnum = k.attnum
             where a.attname = 'user_id'
           )
         )
  into pk_name, pk_is_user_id
  from pg_constraint c
  where c.conrelid = 'public.admin_users'::regclass
    and c.contype = 'p'
  limit 1;

  if pk_name is null then
    alter table public.admin_users
      add constraint admin_users_pkey primary key (user_id);
  elsif not coalesce(pk_is_user_id, false) then
    if to_regclass('public.audit_log') is not null then
      alter table public.audit_log
        drop constraint if exists audit_log_admin_user_id_fkey;
    end if;

    execute format('alter table public.admin_users drop constraint %I', pk_name);

    alter table public.admin_users
      add constraint admin_users_pkey primary key (user_id);

    if to_regclass('public.audit_log') is not null then
      alter table public.audit_log
        add constraint audit_log_admin_user_id_fkey
        foreign key (admin_user_id)
        references public.admin_users(id)
        on delete set null;
    end if;
  end if;
end $$;

-- 3) Admin role helper predicates for RLS and server-side checks.
create or replace function public.current_admin_role()
returns public.admin_role
language sql
stable
security definer
set search_path = public
as $$
  select au.role
  from public.admin_users au
  where au.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.has_admin_role(required_roles public.admin_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
      and au.role = any(required_roles)
  );
$$;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  );
$$;

-- 4) RLS on admin_users: super_admin-only management.
alter table public.admin_users enable row level security;

drop policy if exists admin_users_service_select on public.admin_users;
drop policy if exists admin_users_service_insert on public.admin_users;
drop policy if exists admin_users_service_update on public.admin_users;
drop policy if exists admin_users_service_delete on public.admin_users;
drop policy if exists svc_select on public.admin_users;
drop policy if exists svc_insert on public.admin_users;
drop policy if exists svc_update on public.admin_users;
drop policy if exists svc_delete on public.admin_users;
drop policy if exists admin_select on public.admin_users;
drop policy if exists admin_users_select_self on public.admin_users;
drop policy if exists admin_users_select_super_admin on public.admin_users;
drop policy if exists admin_users_insert_super_admin on public.admin_users;
drop policy if exists admin_users_update_super_admin on public.admin_users;

create policy admin_users_service_select
  on public.admin_users
  for select
  to service_role
  using (true);

create policy admin_users_select_self
  on public.admin_users
  for select
  to authenticated
  using (user_id = auth.uid());

create policy admin_users_select_super_admin
  on public.admin_users
  for select
  to authenticated
  using (public.has_admin_role(array['super_admin'::public.admin_role]));

create policy admin_users_insert_super_admin
  on public.admin_users
  for insert
  to authenticated
  with check (public.has_admin_role(array['super_admin'::public.admin_role]));

create policy admin_users_update_super_admin
  on public.admin_users
  for update
  to authenticated
  using (public.has_admin_role(array['super_admin'::public.admin_role]))
  with check (public.has_admin_role(array['super_admin'::public.admin_role]));

-- 5) Admin audit log: append-only and admin-RBAC constrained.
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.admin_users(user_id) on delete restrict,
  action text not null,
  target_type text not null,
  target_id text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_admin_user_created_idx
  on public.admin_audit_log(admin_user_id, created_at desc);

create index if not exists admin_audit_log_action_idx
  on public.admin_audit_log(action);

create index if not exists admin_audit_log_target_idx
  on public.admin_audit_log(target_type, target_id);

alter table public.admin_audit_log enable row level security;

drop policy if exists admin_audit_log_service_select on public.admin_audit_log;
drop policy if exists admin_audit_log_select_own on public.admin_audit_log;
drop policy if exists admin_audit_log_select_all_super_admin on public.admin_audit_log;
drop policy if exists admin_audit_log_insert_self on public.admin_audit_log;

create policy admin_audit_log_service_select
  on public.admin_audit_log
  for select
  to service_role
  using (true);

create policy admin_audit_log_select_own
  on public.admin_audit_log
  for select
  to authenticated
  using (
    public.is_admin_user()
    and admin_user_id = auth.uid()
  );

create policy admin_audit_log_select_all_super_admin
  on public.admin_audit_log
  for select
  to authenticated
  using (public.has_admin_role(array['super_admin'::public.admin_role]));

create policy admin_audit_log_insert_self
  on public.admin_audit_log
  for insert
  to authenticated
  with check (
    public.is_admin_user()
    and admin_user_id = auth.uid()
  );

create or replace function public.prevent_admin_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'admin_audit_log is append-only';
end;
$$;

drop trigger if exists admin_audit_log_prevent_update on public.admin_audit_log;
create trigger admin_audit_log_prevent_update
before update on public.admin_audit_log
for each row
execute function public.prevent_admin_audit_log_mutation();

drop trigger if exists admin_audit_log_prevent_delete on public.admin_audit_log;
create trigger admin_audit_log_prevent_delete
before delete on public.admin_audit_log
for each row
execute function public.prevent_admin_audit_log_mutation();
