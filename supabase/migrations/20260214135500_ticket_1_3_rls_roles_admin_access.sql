-- Ticket 1.3: RLS, role grants, and admin access hardening
-- Security-only migration: fail-closed defaults, explicit service-role access, strict per-user isolation.

-- 0) Fail fast if canonical tables are missing.
do $$
declare
  missing_tables text;
begin
  with required_tables(table_name) as (
    values
      ('users'),
      ('profiles'),
      ('profile_events'),
      ('conversation_sessions'),
      ('conversation_events'),
      ('sms_messages'),
      ('sms_outbound_jobs'),
      ('regions'),
      ('waitlist_entries'),
      ('region_memberships'),
      ('linkups'),
      ('linkup_members'),
      ('linkup_invites'),
      ('linkup_participants'),
      ('linkup_outcomes'),
      ('contact_exchange_choices'),
      ('contact_exchanges'),
      ('match_runs'),
      ('match_candidates'),
      ('entitlements'),
      ('entitlement_ledger'),
      ('entitlement_events'),
      ('stripe_events'),
      ('safety_holds'),
      ('safety_incidents'),
      ('user_blocks'),
      ('user_reports'),
      ('user_strikes'),
      ('keyword_rules'),
      ('learning_signals'),
      ('user_derived_state'),
      ('learning_jobs'),
      ('admin_users'),
      ('audit_log')
  )
  select string_agg(r.table_name, ', ' order by r.table_name)
  into missing_tables
  from required_tables r
  left join pg_tables t
    on t.schemaname = 'public'
   and t.tablename = r.table_name
  where t.tablename is null;

  if missing_tables is not null then
    raise exception 'ticket 1.3 aborted: missing required public tables: %', missing_tables;
  end if;
end $$;

-- 1) Admin mapping must be explicit and JWT-linked.
alter table public.admin_users
  add column if not exists user_id uuid references public.users(id) on delete set null;

create unique index if not exists admin_users_user_id_uniq
  on public.admin_users(user_id)
  where user_id is not null;

-- 2) Helper predicates for policy readability and consistency.
create or replace function public.owns_profile(profile_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = profile_uuid
      and p.user_id = auth.uid()
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

create or replace function public.is_linkup_visible_to_current_user(linkup_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.linkups l
    where l.id = linkup_uuid
      and l.initiator_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.linkup_members lm
    where lm.linkup_id = linkup_uuid
      and lm.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.linkup_participants lp
    where lp.linkup_id = linkup_uuid
      and lp.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.linkup_invites li
    where li.linkup_id = linkup_uuid
      and li.invited_user_id = auth.uid()
  );
$$;

-- 3) Remove broad unauthenticated table privileges.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke usage on schema public from anon;

-- 4) Fail-closed baseline: reset policies, enable RLS, add explicit service/admin policy on every public table.
do $$
declare
  t record;
  p record;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);

    for p in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = t.tablename
    loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t.tablename);
    end loop;

    execute format(
      'create policy svc_select on public.%I for select to service_role using (true)',
      t.tablename
    );

    execute format(
      'create policy svc_insert on public.%I for insert to service_role with check (true)',
      t.tablename
    );

    execute format(
      'create policy svc_update on public.%I for update to service_role using (true) with check (true)',
      t.tablename
    );

    execute format(
      'create policy svc_delete on public.%I for delete to service_role using (true)',
      t.tablename
    );

    execute format(
      'create policy admin_select on public.%I for select to authenticated using (public.is_admin_user())',
      t.tablename
    );
  end loop;
end $$;

-- 5) Authenticated user isolation policies (self-only access).

-- users
create policy users_select_self
  on public.users
  for select
  to authenticated
  using (id = auth.uid());

-- regions (read-only lookup)
create policy regions_select_authenticated
  on public.regions
  for select
  to authenticated
  using (true);

-- memberships + waitlist
create policy region_memberships_select_self
  on public.region_memberships
  for select
  to authenticated
  using (user_id = auth.uid());

create policy waitlist_entries_select_self
  on public.waitlist_entries
  for select
  to authenticated
  using (user_id = auth.uid());

-- profiles
create policy profiles_select_self
  on public.profiles
  for select
  to authenticated
  using (user_id = auth.uid());

create policy profiles_insert_self
  on public.profiles
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy profiles_update_self
  on public.profiles
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy profile_events_select_self
  on public.profile_events
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.owns_profile(profile_id)
  );

-- conversation
create policy conversation_sessions_select_self
  on public.conversation_sessions
  for select
  to authenticated
  using (user_id = auth.uid());

create policy conversation_events_select_self
  on public.conversation_events
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or (profile_id is not null and public.owns_profile(profile_id))
    or exists (
      select 1
      from public.conversation_sessions cs
      where cs.id = conversation_events.conversation_session_id
        and cs.user_id = auth.uid()
    )
  );

-- messaging
create policy sms_messages_select_self
  on public.sms_messages
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or (profile_id is not null and public.owns_profile(profile_id))
  );

create policy sms_outbound_jobs_select_self
  on public.sms_outbound_jobs
  for select
  to authenticated
  using (user_id = auth.uid());

-- linkups
create policy linkups_select_self
  on public.linkups
  for select
  to authenticated
  using (public.is_linkup_visible_to_current_user(id));

create policy linkup_members_select_self
  on public.linkup_members
  for select
  to authenticated
  using (public.is_linkup_visible_to_current_user(linkup_id));

create policy linkup_invites_select_self
  on public.linkup_invites
  for select
  to authenticated
  using (
    invited_user_id = auth.uid()
    or public.is_linkup_visible_to_current_user(linkup_id)
  );

create policy linkup_participants_select_self
  on public.linkup_participants
  for select
  to authenticated
  using (public.is_linkup_visible_to_current_user(linkup_id));

create policy linkup_outcomes_select_self
  on public.linkup_outcomes
  for select
  to authenticated
  using (user_id = auth.uid());

create policy contact_exchange_choices_select_self
  on public.contact_exchange_choices
  for select
  to authenticated
  using (
    chooser_user_id = auth.uid()
    or target_user_id = auth.uid()
    or public.is_linkup_visible_to_current_user(linkup_id)
  );

create policy contact_exchanges_select_self
  on public.contact_exchanges
  for select
  to authenticated
  using (user_a_id = auth.uid() or user_b_id = auth.uid());

-- matching
create policy match_runs_select_self
  on public.match_runs
  for select
  to authenticated
  using (subject_user_id = auth.uid());

create policy match_candidates_select_self
  on public.match_candidates
  for select
  to authenticated
  using (
    subject_user_id = auth.uid()
    or candidate_user_id = auth.uid()
  );

-- entitlements
create policy entitlements_select_self
  on public.entitlements
  for select
  to authenticated
  using (user_id = auth.uid());

create policy entitlement_ledger_select_self
  on public.entitlement_ledger
  for select
  to authenticated
  using (user_id = auth.uid());

create policy entitlement_events_select_self
  on public.entitlement_events
  for select
  to authenticated
  using (user_id = auth.uid());

-- safety
create policy safety_holds_select_self
  on public.safety_holds
  for select
  to authenticated
  using (user_id = auth.uid());

create policy safety_incidents_select_self
  on public.safety_incidents
  for select
  to authenticated
  using (
    subject_user_id = auth.uid()
    or reporter_user_id = auth.uid()
  );

create policy user_blocks_select_self
  on public.user_blocks
  for select
  to authenticated
  using (
    blocker_user_id = auth.uid()
    or blocked_user_id = auth.uid()
  );

create policy user_reports_select_self
  on public.user_reports
  for select
  to authenticated
  using (
    reporter_user_id = auth.uid()
    or subject_user_id = auth.uid()
  );

create policy user_strikes_select_self
  on public.user_strikes
  for select
  to authenticated
  using (user_id = auth.uid());

-- learning
create policy learning_signals_select_self
  on public.learning_signals
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or counterparty_user_id = auth.uid()
  );

create policy user_derived_state_select_self
  on public.user_derived_state
  for select
  to authenticated
  using (user_id = auth.uid());

-- 6) Hard guard: fail migration if any anon/public policy exists.
do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and (
        'anon' = any(roles)
        or 'public' = any(roles)
      )
  ) then
    raise exception 'ticket 1.3 aborted: anon/public policies detected in public schema';
  end if;
end $$;
