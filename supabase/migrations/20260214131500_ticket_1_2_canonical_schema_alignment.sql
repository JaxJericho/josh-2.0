-- Ticket 1.2: Canonical MVP schema alignment
-- Additive migration to align existing schema with canonical docs/specs/josh-2.0.

-- 1) Additional enums for state-machine safety and explicit status typing.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'sms_direction') then
    create type public.sms_direction as enum ('in', 'out');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'job_state') then
    create type public.job_state as enum ('pending', 'sending', 'sent', 'failed', 'canceled');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'safety_hold_type') then
    create type public.safety_hold_type as enum ('match_hold', 'linkup_hold', 'contact_hold', 'global_hold');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'linkup_member_role') then
    create type public.linkup_member_role as enum ('initiator', 'participant');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'linkup_member_status') then
    create type public.linkup_member_status as enum ('confirmed', 'canceled', 'no_show', 'attended', 'left');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'keyword_match_type') then
    create type public.keyword_match_type as enum ('exact', 'contains', 'regex');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'keyword_rule_action') then
    create type public.keyword_rule_action as enum ('flag', 'hold', 'block', 'crisis_route');
  end if;
end $$;

-- 2) Conversation schema hardening + event audit table.
alter table public.conversation_sessions
  add column if not exists linkup_id uuid references public.linkups(id) on delete set null,
  add column if not exists current_step_id text;

create index if not exists conversation_sessions_linkup_idx
  on public.conversation_sessions(linkup_id);

create table if not exists public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  conversation_session_id uuid not null references public.conversation_sessions(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  step_token text,
  twilio_message_sid text,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  correlation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists conversation_events_idempotency_key_uniq
  on public.conversation_events(idempotency_key)
  where idempotency_key is not null;

create index if not exists conversation_events_session_created_idx
  on public.conversation_events(conversation_session_id, created_at desc);

create index if not exists conversation_events_user_created_idx
  on public.conversation_events(user_id, created_at desc);

create index if not exists conversation_events_type_idx
  on public.conversation_events(event_type);

-- 3) Profile completeness/status markers.
alter table public.profiles
  add column if not exists completeness_percent smallint not null default 0,
  add column if not exists is_complete_mvp boolean not null default false,
  add column if not exists status_reason text,
  add column if not exists state_changed_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_completeness_percent_chk'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_completeness_percent_chk
      check (completeness_percent between 0 and 100);
  end if;
end $$;

create index if not exists profiles_is_complete_mvp_idx
  on public.profiles(is_complete_mvp);

-- 4) Messaging indexes and explicit queue scheduling/index shape.
alter table public.sms_messages
  add column if not exists profile_id uuid references public.profiles(id) on delete set null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sms_messages'
      and column_name = 'direction'
      and udt_name <> 'sms_direction'
  ) then
    alter table public.sms_messages
      drop constraint if exists sms_messages_direction_check;

    alter table public.sms_messages
      alter column direction type public.sms_direction
      using direction::public.sms_direction;
  end if;
end $$;

create index if not exists sms_messages_profile_created_idx
  on public.sms_messages(profile_id, created_at desc);

alter table public.sms_outbound_jobs
  add column if not exists run_at timestamptz;

update public.sms_outbound_jobs
set run_at = coalesce(run_at, next_attempt_at, created_at)
where run_at is null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sms_outbound_jobs'
      and column_name = 'status'
      and udt_name <> 'job_state'
  ) then
    alter table public.sms_outbound_jobs
      drop constraint if exists sms_outbound_jobs_status_check;

    alter table public.sms_outbound_jobs
      alter column status drop default;

    alter table public.sms_outbound_jobs
      alter column status type public.job_state
      using status::public.job_state;

    alter table public.sms_outbound_jobs
      alter column status set default 'pending'::public.job_state;
  end if;
end $$;

create index if not exists sms_outbound_jobs_status_run_at_idx
  on public.sms_outbound_jobs(status, run_at);

-- 5) LinkUps: canonical scheduling aliases + required indexes.
alter table public.linkups
  add column if not exists scheduled_at timestamptz;

update public.linkups
set scheduled_at = coalesce(scheduled_at, event_time)
where scheduled_at is null;

create index if not exists linkups_state_region_created_idx
  on public.linkups(state, region_id, created_at desc);

-- Add a status alias to satisfy status-based indexing while preserving existing state column.
alter table public.linkup_invites
  add column if not exists status public.invite_state generated always as (state) stored;

create index if not exists linkup_invites_linkup_status_idx
  on public.linkup_invites(linkup_id, status);

create unique index if not exists linkup_invites_response_message_sid_uniq
  on public.linkup_invites(response_message_sid)
  where response_message_sid is not null;

-- Canonical table requested for upcoming ticket surfaces.
create table if not exists public.linkup_members (
  id uuid primary key default gen_random_uuid(),
  linkup_id uuid not null references public.linkups(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role public.linkup_member_role not null,
  status public.linkup_member_status not null default 'confirmed',
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkup_members_once unique (linkup_id, user_id)
);

insert into public.linkup_members (linkup_id, user_id, role, status, joined_at, left_at, created_at, updated_at)
select
  lp.linkup_id,
  lp.user_id,
  lp.role::public.linkup_member_role,
  lp.status::public.linkup_member_status,
  lp.joined_at,
  lp.left_at,
  lp.created_at,
  lp.updated_at
from public.linkup_participants lp
on conflict (linkup_id, user_id) do nothing;

create index if not exists linkup_members_linkup_status_idx
  on public.linkup_members(linkup_id, status);

create index if not exists linkup_members_user_idx
  on public.linkup_members(user_id);

-- 6) Matching: explicit profile linkage to satisfy profile-based candidate inspection.
alter table public.match_candidates
  add column if not exists subject_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists candidate_profile_id uuid references public.profiles(id) on delete set null;

create index if not exists match_candidates_candidate_profile_idx
  on public.match_candidates(candidate_profile_id);

-- 7) Safety: typed hold categories + keyword rules.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'safety_holds'
      and column_name = 'hold_type'
      and udt_name <> 'safety_hold_type'
  ) then
    alter table public.safety_holds
      alter column hold_type type public.safety_hold_type
      using (
        case
          when hold_type in ('match_hold', 'linkup_hold', 'contact_hold', 'global_hold') then hold_type::public.safety_hold_type
          else 'global_hold'::public.safety_hold_type
        end
      );
  end if;
end $$;

create table if not exists public.keyword_rules (
  id uuid primary key default gen_random_uuid(),
  rule_set text not null default 'default',
  keyword text not null,
  match_type public.keyword_match_type not null default 'contains',
  severity text not null,
  action public.keyword_rule_action not null,
  hold_type public.safety_hold_type,
  response_template text,
  is_active boolean not null default true,
  version int not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint keyword_rules_rule_uniq unique (rule_set, keyword, version)
);

create index if not exists keyword_rules_active_idx
  on public.keyword_rules(is_active, rule_set);

create index if not exists keyword_rules_action_idx
  on public.keyword_rules(action);

alter table public.safety_incidents
  add column if not exists incident_type text;

update public.safety_incidents
set incident_type = coalesce(incident_type, category)
where incident_type is null;

-- 8) Entitlements/Billing: canonical entitlement_events table for ledger-style eventing.
create table if not exists public.entitlement_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  entitlement_type text not null,
  quantity int,
  event_type text not null,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entitlement_events_idempotency_key_uniq unique (idempotency_key)
);

create index if not exists entitlement_events_user_occurred_idx
  on public.entitlement_events(user_id, occurred_at desc);

-- 9) Admin + audit tables required by ticket.
create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  role text not null check (role in ('support', 'ops', 'engineering')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references public.admin_users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  correlation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists audit_log_idempotency_key_uniq
  on public.audit_log(idempotency_key)
  where idempotency_key is not null;

create index if not exists audit_log_action_idx
  on public.audit_log(action);

create index if not exists audit_log_target_idx
  on public.audit_log(target_type, target_id);

create index if not exists audit_log_created_idx
  on public.audit_log(created_at desc);

-- 10) created_at/updated_at consistency for append-only tables required by this ticket.
alter table public.profile_events
  add column if not exists updated_at timestamptz not null default now();

alter table public.linkup_events
  add column if not exists updated_at timestamptz not null default now();

alter table public.match_runs
  add column if not exists updated_at timestamptz not null default now();

alter table public.match_candidates
  add column if not exists updated_at timestamptz not null default now();

alter table public.user_blocks
  add column if not exists updated_at timestamptz not null default now();

alter table public.user_strikes
  add column if not exists updated_at timestamptz not null default now();

alter table public.stripe_events
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.entitlement_ledger
  add column if not exists updated_at timestamptz not null default now();

-- Backfill stripe_events.created_at from received_at when available.
update public.stripe_events
set created_at = coalesce(created_at, received_at)
where created_at is null;

-- 11) updated_at triggers.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'conversation_events_set_updated_at') then
    create trigger conversation_events_set_updated_at
    before update on public.conversation_events
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'linkup_members_set_updated_at') then
    create trigger linkup_members_set_updated_at
    before update on public.linkup_members
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'keyword_rules_set_updated_at') then
    create trigger keyword_rules_set_updated_at
    before update on public.keyword_rules
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'entitlement_events_set_updated_at') then
    create trigger entitlement_events_set_updated_at
    before update on public.entitlement_events
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'admin_users_set_updated_at') then
    create trigger admin_users_set_updated_at
    before update on public.admin_users
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'audit_log_set_updated_at') then
    create trigger audit_log_set_updated_at
    before update on public.audit_log
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'profile_events_set_updated_at') then
    create trigger profile_events_set_updated_at
    before update on public.profile_events
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'linkup_events_set_updated_at') then
    create trigger linkup_events_set_updated_at
    before update on public.linkup_events
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'match_runs_set_updated_at') then
    create trigger match_runs_set_updated_at
    before update on public.match_runs
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'match_candidates_set_updated_at') then
    create trigger match_candidates_set_updated_at
    before update on public.match_candidates
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'user_blocks_set_updated_at') then
    create trigger user_blocks_set_updated_at
    before update on public.user_blocks
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'user_strikes_set_updated_at') then
    create trigger user_strikes_set_updated_at
    before update on public.user_strikes
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'stripe_events_set_updated_at') then
    create trigger stripe_events_set_updated_at
    before update on public.stripe_events
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'entitlement_ledger_set_updated_at') then
    create trigger entitlement_ledger_set_updated_at
    before update on public.entitlement_ledger
    for each row execute function public.set_updated_at();
  end if;
end $$;

-- 12) Least-privilege default posture for newly added tables (service role only).
alter table public.conversation_events enable row level security;
alter table public.linkup_members enable row level security;
alter table public.keyword_rules enable row level security;
alter table public.entitlement_events enable row level security;
alter table public.admin_users enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists conversation_events_service_select on public.conversation_events;
drop policy if exists conversation_events_service_insert on public.conversation_events;
drop policy if exists conversation_events_service_update on public.conversation_events;
drop policy if exists conversation_events_service_delete on public.conversation_events;
create policy conversation_events_service_select on public.conversation_events for select to service_role using (true);
create policy conversation_events_service_insert on public.conversation_events for insert to service_role with check (true);
create policy conversation_events_service_update on public.conversation_events for update to service_role using (true) with check (true);
create policy conversation_events_service_delete on public.conversation_events for delete to service_role using (true);

drop policy if exists linkup_members_service_select on public.linkup_members;
drop policy if exists linkup_members_service_insert on public.linkup_members;
drop policy if exists linkup_members_service_update on public.linkup_members;
drop policy if exists linkup_members_service_delete on public.linkup_members;
create policy linkup_members_service_select on public.linkup_members for select to service_role using (true);
create policy linkup_members_service_insert on public.linkup_members for insert to service_role with check (true);
create policy linkup_members_service_update on public.linkup_members for update to service_role using (true) with check (true);
create policy linkup_members_service_delete on public.linkup_members for delete to service_role using (true);

drop policy if exists keyword_rules_service_select on public.keyword_rules;
drop policy if exists keyword_rules_service_insert on public.keyword_rules;
drop policy if exists keyword_rules_service_update on public.keyword_rules;
drop policy if exists keyword_rules_service_delete on public.keyword_rules;
create policy keyword_rules_service_select on public.keyword_rules for select to service_role using (true);
create policy keyword_rules_service_insert on public.keyword_rules for insert to service_role with check (true);
create policy keyword_rules_service_update on public.keyword_rules for update to service_role using (true) with check (true);
create policy keyword_rules_service_delete on public.keyword_rules for delete to service_role using (true);

drop policy if exists entitlement_events_service_select on public.entitlement_events;
drop policy if exists entitlement_events_service_insert on public.entitlement_events;
drop policy if exists entitlement_events_service_update on public.entitlement_events;
drop policy if exists entitlement_events_service_delete on public.entitlement_events;
create policy entitlement_events_service_select on public.entitlement_events for select to service_role using (true);
create policy entitlement_events_service_insert on public.entitlement_events for insert to service_role with check (true);
create policy entitlement_events_service_update on public.entitlement_events for update to service_role using (true) with check (true);
create policy entitlement_events_service_delete on public.entitlement_events for delete to service_role using (true);

drop policy if exists admin_users_service_select on public.admin_users;
drop policy if exists admin_users_service_insert on public.admin_users;
drop policy if exists admin_users_service_update on public.admin_users;
drop policy if exists admin_users_service_delete on public.admin_users;
create policy admin_users_service_select on public.admin_users for select to service_role using (true);
create policy admin_users_service_insert on public.admin_users for insert to service_role with check (true);
create policy admin_users_service_update on public.admin_users for update to service_role using (true) with check (true);
create policy admin_users_service_delete on public.admin_users for delete to service_role using (true);

drop policy if exists audit_log_service_select on public.audit_log;
drop policy if exists audit_log_service_insert on public.audit_log;
drop policy if exists audit_log_service_update on public.audit_log;
drop policy if exists audit_log_service_delete on public.audit_log;
create policy audit_log_service_select on public.audit_log for select to service_role using (true);
create policy audit_log_service_insert on public.audit_log for insert to service_role with check (true);
create policy audit_log_service_update on public.audit_log for update to service_role using (true) with check (true);
create policy audit_log_service_delete on public.audit_log for delete to service_role using (true);
