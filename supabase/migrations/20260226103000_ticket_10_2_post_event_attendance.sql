-- Ticket 10.2: post-event attendance capture + deterministic state progression.

alter table public.linkup_outcomes
  add column if not exists attendance_result text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'linkup_outcomes_attendance_result_chk'
      and conrelid = 'public.linkup_outcomes'::regclass
  ) then
    alter table public.linkup_outcomes
      add constraint linkup_outcomes_attendance_result_chk
      check (attendance_result in ('attended', 'no_show', 'cancelled', 'unclear'));
  end if;
end $$;

create or replace function public.capture_post_event_attendance(
  p_user_id uuid,
  p_inbound_message_id uuid,
  p_inbound_message_sid text,
  p_attendance_result text,
  p_correlation_id text default null
)
returns table (
  session_id uuid,
  linkup_id uuid,
  mode public.conversation_mode,
  previous_state_token text,
  next_state_token text,
  attendance_result text,
  duplicate boolean,
  reason text,
  correlation_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.conversation_sessions%rowtype;
  v_idempotency_key text;
  v_correlation_id text;
  v_next_state_token text;
  v_attendance_response text;
begin
  if p_user_id is null then
    raise exception 'capture_post_event_attendance requires p_user_id';
  end if;

  if p_inbound_message_sid is null or btrim(p_inbound_message_sid) = '' then
    raise exception 'capture_post_event_attendance requires p_inbound_message_sid';
  end if;

  if p_attendance_result is null
    or p_attendance_result not in ('attended', 'no_show', 'cancelled', 'unclear')
  then
    raise exception 'capture_post_event_attendance received invalid attendance_result %', p_attendance_result;
  end if;

  select *
  into v_session
  from public.conversation_sessions
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'Conversation session for user % not found', p_user_id;
  end if;

  if v_session.mode <> 'post_event' then
    raise exception 'Conversation session % is not in post_event mode', v_session.id;
  end if;

  if v_session.linkup_id is null then
    raise exception 'Conversation session % is missing linkup_id', v_session.id;
  end if;

  v_correlation_id := coalesce(
    nullif(btrim(coalesce(p_correlation_id, '')), ''),
    p_inbound_message_id::text,
    p_inbound_message_sid
  );

  v_idempotency_key := format(
    'post_event:attendance:%s:%s',
    p_user_id::text,
    p_inbound_message_sid
  );

  if exists (
    select 1
    from public.conversation_events
    where idempotency_key = v_idempotency_key
  ) then
    return query
    select
      v_session.id,
      v_session.linkup_id,
      v_session.mode,
      v_session.state_token,
      v_session.state_token,
      p_attendance_result,
      true,
      'duplicate_replay',
      v_correlation_id;
    return;
  end if;

  if v_session.state_token <> 'post_event:attendance' then
    return query
    select
      v_session.id,
      v_session.linkup_id,
      v_session.mode,
      v_session.state_token,
      v_session.state_token,
      p_attendance_result,
      false,
      'state_not_attendance',
      v_correlation_id;
    return;
  end if;

  v_attendance_response := case p_attendance_result
    when 'attended' then 'attended'
    when 'no_show' then 'no_show'
    when 'cancelled' then 'no_show'
    else 'unsure'
  end;

  insert into public.linkup_outcomes (
    linkup_id,
    user_id,
    attendance_response,
    attendance_result
  )
  values (
    v_session.linkup_id,
    p_user_id,
    v_attendance_response,
    p_attendance_result
  )
  on conflict on constraint linkup_outcomes_once do update
  set attendance_response = excluded.attendance_response,
      attendance_result = excluded.attendance_result,
      updated_at = now();

  update public.conversation_sessions
  set state_token = 'post_event:reflection',
      last_inbound_message_sid = p_inbound_message_sid
  where id = v_session.id
    and state_token = 'post_event:attendance'
  returning state_token
  into v_next_state_token;

  if not found then
    select state_token
    into v_next_state_token
    from public.conversation_sessions
    where id = v_session.id;
  end if;

  insert into public.conversation_events (
    conversation_session_id,
    user_id,
    event_type,
    step_token,
    twilio_message_sid,
    payload,
    idempotency_key,
    correlation_id
  )
  values (
    v_session.id,
    p_user_id,
    'post_event.attendance_captured',
    'post_event:attendance',
    p_inbound_message_sid,
    jsonb_build_object(
      'attendance_result', p_attendance_result,
      'inbound_message_id', p_inbound_message_id,
      'correlation_id', v_correlation_id
    ),
    v_idempotency_key,
    p_inbound_message_id
  );

  return query
  select
    v_session.id,
    v_session.linkup_id,
    v_session.mode,
    'post_event:attendance',
    coalesce(v_next_state_token, 'post_event:reflection'),
    p_attendance_result,
    false,
    'captured',
    v_correlation_id;
end;
$$;

revoke all on function public.capture_post_event_attendance(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.capture_post_event_attendance(uuid, uuid, text, text, text)
  to service_role;
