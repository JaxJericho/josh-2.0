create table if not exists public.moderation_incidents (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references public.users(id) on delete restrict,
  reported_user_id uuid not null references public.users(id) on delete restrict,
  linkup_id uuid references public.linkups(id) on delete set null,
  reason_category text not null,
  free_text text,
  status text not null default 'open' check (status in ('open', 'reviewed', 'resolved')),
  prompt_token text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint moderation_incidents_idempotency_uniq unique (idempotency_key),
  constraint moderation_incidents_prompt_token_uniq unique (prompt_token)
);

create index if not exists moderation_incidents_status_created_idx
  on public.moderation_incidents(status, created_at desc);

create index if not exists moderation_incidents_reporter_created_idx
  on public.moderation_incidents(reporter_user_id, created_at desc);

create index if not exists moderation_incidents_reported_created_idx
  on public.moderation_incidents(reported_user_id, created_at desc);

create index if not exists moderation_incidents_linkup_idx
  on public.moderation_incidents(linkup_id, created_at desc);

create or replace view public.admin_moderation_incident_queue as
select
  mi.id,
  mi.reporter_user_id,
  mi.reported_user_id,
  mi.linkup_id,
  mi.reason_category,
  mi.free_text,
  mi.status,
  mi.metadata,
  mi.created_at
from public.moderation_incidents mi
where mi.status = 'open'
order by mi.created_at desc;

create or replace function public.prevent_moderation_incidents_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'moderation_incidents is append-only';
end;
$$;

create or replace function public.create_user_block(
  p_blocker_user_id uuid,
  p_blocked_user_id uuid,
  p_created_at timestamptz default now()
)
returns table (
  created boolean,
  blocker_user_id uuid,
  blocked_user_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_blocker uuid;
  v_blocked uuid;
begin
  if p_blocker_user_id is null then
    raise exception 'p_blocker_user_id is required';
  end if;

  if p_blocked_user_id is null then
    raise exception 'p_blocked_user_id is required';
  end if;

  if p_blocker_user_id = p_blocked_user_id then
    raise exception 'cannot block self';
  end if;

  insert into public.user_blocks (
    blocker_user_id,
    blocked_user_id,
    created_at
  )
  values (
    p_blocker_user_id,
    p_blocked_user_id,
    p_created_at
  )
  on conflict on constraint user_blocks_once
  do nothing
  returning public.user_blocks.blocker_user_id, public.user_blocks.blocked_user_id
  into v_blocker, v_blocked;

  if v_blocker is not null and v_blocked is not null then
    return query select true, v_blocker, v_blocked;
    return;
  end if;

  return query select false, p_blocker_user_id, p_blocked_user_id;
end;
$$;

create or replace function public.create_moderation_incident(
  p_reporter_user_id uuid,
  p_reported_user_id uuid,
  p_linkup_id uuid,
  p_reason_category text,
  p_free_text text,
  p_status text default 'open',
  p_prompt_token text default null,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_created_at timestamptz default now()
)
returns table (
  incident_id uuid,
  status text,
  created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident_id uuid;
  v_incident_status text;
begin
  if p_reporter_user_id is null then
    raise exception 'p_reporter_user_id is required';
  end if;

  if p_reported_user_id is null then
    raise exception 'p_reported_user_id is required';
  end if;

  if p_reason_category is null or btrim(p_reason_category) = '' then
    raise exception 'p_reason_category is required';
  end if;

  if p_status not in ('open', 'reviewed', 'resolved') then
    raise exception 'p_status must be open, reviewed, or resolved';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'p_idempotency_key is required';
  end if;

  insert into public.moderation_incidents (
    reporter_user_id,
    reported_user_id,
    linkup_id,
    reason_category,
    free_text,
    status,
    prompt_token,
    idempotency_key,
    metadata,
    created_at
  )
  values (
    p_reporter_user_id,
    p_reported_user_id,
    p_linkup_id,
    btrim(p_reason_category),
    nullif(left(coalesce(p_free_text, ''), 1000), ''),
    p_status,
    nullif(btrim(coalesce(p_prompt_token, '')), ''),
    btrim(p_idempotency_key),
    coalesce(p_metadata, '{}'::jsonb),
    p_created_at
  )
  on conflict (idempotency_key)
  do nothing
  returning id, moderation_incidents.status
  into v_incident_id, v_incident_status;

  if v_incident_id is not null then
    return query select v_incident_id, v_incident_status, true;
    return;
  end if;

  select
    mi.id,
    mi.status
  into
    v_incident_id,
    v_incident_status
  from public.moderation_incidents mi
  where mi.idempotency_key = btrim(p_idempotency_key)
  limit 1;

  if v_incident_id is null then
    raise exception 'unable to resolve moderation incident row';
  end if;

  return query select v_incident_id, v_incident_status, false;
end;
$$;

create or replace function public.append_safety_event(
  p_user_id uuid,
  p_inbound_message_id uuid,
  p_inbound_message_sid text,
  p_severity text,
  p_keyword_version text,
  p_matched_term text,
  p_action_taken text,
  p_metadata jsonb default '{}'::jsonb,
  p_created_at timestamptz default now()
)
returns table (
  inserted boolean,
  event_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  if p_action_taken is null or btrim(p_action_taken) = '' then
    raise exception 'p_action_taken is required';
  end if;

  if p_inbound_message_sid is null or btrim(p_inbound_message_sid) = '' then
    insert into public.safety_events (
      user_id,
      inbound_message_id,
      inbound_message_sid,
      severity,
      keyword_version,
      matched_term,
      action_taken,
      metadata,
      created_at
    )
    values (
      p_user_id,
      p_inbound_message_id,
      null,
      nullif(btrim(coalesce(p_severity, '')), ''),
      nullif(btrim(coalesce(p_keyword_version, '')), ''),
      nullif(btrim(coalesce(p_matched_term, '')), ''),
      btrim(p_action_taken),
      coalesce(p_metadata, '{}'::jsonb),
      p_created_at
    )
    returning id into v_event_id;

    return query select true, v_event_id;
    return;
  end if;

  insert into public.safety_events (
    user_id,
    inbound_message_id,
    inbound_message_sid,
    severity,
    keyword_version,
    matched_term,
    action_taken,
    metadata,
    created_at
  )
  values (
    p_user_id,
    p_inbound_message_id,
    btrim(p_inbound_message_sid),
    nullif(btrim(coalesce(p_severity, '')), ''),
    nullif(btrim(coalesce(p_keyword_version, '')), ''),
    nullif(btrim(coalesce(p_matched_term, '')), ''),
    btrim(p_action_taken),
    coalesce(p_metadata, '{}'::jsonb),
    p_created_at
  )
  on conflict (inbound_message_sid, action_taken)
  where inbound_message_sid is not null
  do nothing
  returning id into v_event_id;

  return query select v_event_id is not null, v_event_id;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'moderation_incidents_append_only'
  ) then
    create trigger moderation_incidents_append_only
    before update or delete on public.moderation_incidents
    for each row execute function public.prevent_moderation_incidents_mutation();
  end if;
end $$;

alter table public.moderation_incidents enable row level security;

drop policy if exists moderation_incidents_service_select on public.moderation_incidents;
drop policy if exists moderation_incidents_service_insert on public.moderation_incidents;
create policy moderation_incidents_service_select on public.moderation_incidents
  for select to service_role using (true);
create policy moderation_incidents_service_insert on public.moderation_incidents
  for insert to service_role with check (true);
