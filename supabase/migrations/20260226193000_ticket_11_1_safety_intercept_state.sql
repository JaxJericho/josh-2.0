create table if not exists public.user_safety_state (
  user_id uuid primary key references public.users(id) on delete cascade,
  strike_count integer not null default 0,
  last_strike_at timestamptz,
  safety_hold boolean not null default false,
  rate_limit_window_start timestamptz,
  rate_limit_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_safety_event_at timestamptz
);

create index if not exists user_safety_state_hold_idx
  on public.user_safety_state(safety_hold)
  where safety_hold = true;

create index if not exists user_safety_state_last_strike_idx
  on public.user_safety_state(last_strike_at desc);

create table if not exists public.safety_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  inbound_message_id uuid references public.sms_messages(id) on delete set null,
  inbound_message_sid text,
  severity text,
  keyword_version text,
  matched_term text,
  action_taken text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists safety_events_user_created_idx
  on public.safety_events(user_id, created_at desc);

create index if not exists safety_events_action_created_idx
  on public.safety_events(action_taken, created_at desc);

create unique index if not exists safety_events_inbound_action_uniq
  on public.safety_events(inbound_message_sid, action_taken)
  where inbound_message_sid is not null;

create or replace function public.apply_user_safety_rate_limit(
  p_user_id uuid,
  p_window_seconds integer,
  p_threshold integer,
  p_now timestamptz default now()
)
returns table (
  exceeded boolean,
  rate_limit_window_start timestamptz,
  rate_limit_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if p_window_seconds is null or p_window_seconds <= 0 then
    raise exception 'p_window_seconds must be positive';
  end if;

  if p_threshold is null or p_threshold <= 0 then
    raise exception 'p_threshold must be positive';
  end if;

  insert into public.user_safety_state (
    user_id,
    rate_limit_window_start,
    rate_limit_count,
    last_safety_event_at
  )
  values (
    p_user_id,
    p_now,
    1,
    p_now
  )
  on conflict (user_id)
  do update set
    rate_limit_window_start = case
      when public.user_safety_state.rate_limit_window_start is null
        or public.user_safety_state.rate_limit_window_start + make_interval(secs => p_window_seconds) <= p_now
        then p_now
      else public.user_safety_state.rate_limit_window_start
    end,
    rate_limit_count = case
      when public.user_safety_state.rate_limit_window_start is null
        or public.user_safety_state.rate_limit_window_start + make_interval(secs => p_window_seconds) <= p_now
        then 1
      else public.user_safety_state.rate_limit_count + 1
    end,
    last_safety_event_at = p_now,
    updated_at = now();

  return query
  select
    (uss.rate_limit_count > p_threshold) as exceeded,
    uss.rate_limit_window_start,
    uss.rate_limit_count
  from public.user_safety_state uss
  where uss.user_id = p_user_id;
end;
$$;

create or replace function public.apply_user_safety_strikes(
  p_user_id uuid,
  p_increment integer,
  p_escalation_threshold integer,
  p_now timestamptz default now()
)
returns table (
  strike_count integer,
  safety_hold boolean,
  escalated boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior_strike_count integer;
  v_prior_hold boolean;
  v_next_strike_count integer;
  v_next_hold boolean;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if p_increment is null or p_increment < 0 then
    raise exception 'p_increment must be zero or positive';
  end if;

  if p_escalation_threshold is null or p_escalation_threshold <= 0 then
    raise exception 'p_escalation_threshold must be positive';
  end if;

  insert into public.user_safety_state (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select
    uss.strike_count,
    uss.safety_hold
  into
    v_prior_strike_count,
    v_prior_hold
  from public.user_safety_state uss
  where uss.user_id = p_user_id
  for update;

  v_next_strike_count := coalesce(v_prior_strike_count, 0) + p_increment;
  v_next_hold := coalesce(v_prior_hold, false) or v_next_strike_count >= p_escalation_threshold;

  update public.user_safety_state
  set
    strike_count = v_next_strike_count,
    last_strike_at = case
      when p_increment > 0 then p_now
      else last_strike_at
    end,
    safety_hold = v_next_hold,
    last_safety_event_at = p_now,
    updated_at = now()
  where user_id = p_user_id;

  return query
  select
    v_next_strike_count,
    v_next_hold,
    (not coalesce(v_prior_hold, false) and v_next_hold) as escalated;
end;
$$;

create or replace function public.set_user_safety_hold(
  p_user_id uuid,
  p_now timestamptz default now()
)
returns table (
  strike_count integer,
  safety_hold boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  insert into public.user_safety_state (
    user_id,
    safety_hold,
    last_safety_event_at
  )
  values (
    p_user_id,
    true,
    p_now
  )
  on conflict (user_id)
  do update set
    safety_hold = true,
    last_safety_event_at = p_now,
    updated_at = now();

  return query
  select
    uss.strike_count,
    uss.safety_hold
  from public.user_safety_state uss
  where uss.user_id = p_user_id;
end;
$$;

create or replace function public.prevent_safety_events_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'safety_events is append-only';
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'user_safety_state_set_updated_at'
  ) then
    create trigger user_safety_state_set_updated_at
    before update on public.user_safety_state
    for each row execute function public.set_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'safety_events_append_only'
  ) then
    create trigger safety_events_append_only
    before update or delete on public.safety_events
    for each row execute function public.prevent_safety_events_mutation();
  end if;
end $$;

alter table public.user_safety_state enable row level security;
alter table public.safety_events enable row level security;

drop policy if exists user_safety_state_service_select on public.user_safety_state;
drop policy if exists user_safety_state_service_insert on public.user_safety_state;
drop policy if exists user_safety_state_service_update on public.user_safety_state;
drop policy if exists user_safety_state_service_delete on public.user_safety_state;
create policy user_safety_state_service_select on public.user_safety_state
  for select to service_role using (true);
create policy user_safety_state_service_insert on public.user_safety_state
  for insert to service_role with check (true);
create policy user_safety_state_service_update on public.user_safety_state
  for update to service_role using (true) with check (true);
create policy user_safety_state_service_delete on public.user_safety_state
  for delete to service_role using (true);

drop policy if exists safety_events_service_select on public.safety_events;
drop policy if exists safety_events_service_insert on public.safety_events;
create policy safety_events_service_select on public.safety_events
  for select to service_role using (true);
create policy safety_events_service_insert on public.safety_events
  for insert to service_role with check (true);

insert into public.keyword_rules (
  rule_set,
  keyword,
  match_type,
  severity,
  action,
  hold_type,
  is_active,
  version,
  metadata
)
values
  ('safety_keywords_v1', 'loser', 'contains', 'low', 'flag', null, true, 1, '{"category":"harassment"}'::jsonb),
  ('safety_keywords_v1', 'shut up', 'contains', 'low', 'flag', null, true, 1, '{"category":"harassment"}'::jsonb),
  ('safety_keywords_v1', 'idiot', 'contains', 'low', 'flag', null, true, 1, '{"category":"harassment"}'::jsonb),
  ('safety_keywords_v1', 'hate you', 'contains', 'medium', 'flag', null, true, 1, '{"category":"abuse"}'::jsonb),
  ('safety_keywords_v1', 'go away forever', 'contains', 'medium', 'flag', null, true, 1, '{"category":"abuse"}'::jsonb),
  ('safety_keywords_v1', 'kill yourself', 'contains', 'high', 'hold', 'global_hold', true, 1, '{"category":"harm_threat"}'::jsonb),
  ('safety_keywords_v1', 'i will hurt you', 'contains', 'high', 'hold', 'global_hold', true, 1, '{"category":"harm_threat"}'::jsonb),
  ('safety_keywords_v1', 'i will find you', 'contains', 'high', 'hold', 'global_hold', true, 1, '{"category":"stalking"}'::jsonb),
  ('safety_keywords_v1', 'i want to die', 'contains', 'crisis', 'crisis_route', 'global_hold', true, 1, '{"category":"self_harm"}'::jsonb),
  ('safety_keywords_v1', 'suicide', 'contains', 'crisis', 'crisis_route', 'global_hold', true, 1, '{"category":"self_harm"}'::jsonb),
  ('safety_keywords_v1', 'end my life', 'contains', 'crisis', 'crisis_route', 'global_hold', true, 1, '{"category":"self_harm"}'::jsonb),
  ('safety_keywords_v1', 'hurt myself', 'contains', 'crisis', 'crisis_route', 'global_hold', true, 1, '{"category":"self_harm"}'::jsonb)
on conflict (rule_set, keyword, version)
do update set
  match_type = excluded.match_type,
  severity = excluded.severity,
  action = excluded.action,
  hold_type = excluded.hold_type,
  is_active = excluded.is_active,
  metadata = excluded.metadata,
  updated_at = now();
