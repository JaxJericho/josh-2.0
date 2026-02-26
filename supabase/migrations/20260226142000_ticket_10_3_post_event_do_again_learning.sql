-- Ticket 10.3: post-event do-again capture + append-only learning signal write.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    inner join pg_enum e
      on e.enumtypid = t.oid
    inner join pg_namespace n
      on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'learning_signal_type'
      and e.enumlabel = 'linkup_do_again_unsure'
  ) then
    alter type public.learning_signal_type add value 'linkup_do_again_unsure';
  end if;
end $$;

create or replace function public.capture_post_event_do_again(
  p_user_id uuid,
  p_inbound_message_id uuid,
  p_inbound_message_sid text,
  p_do_again text,
  p_correlation_id text default null
)
returns table (
  session_id uuid,
  linkup_id uuid,
  mode public.conversation_mode,
  previous_state_token text,
  next_state_token text,
  attendance_result text,
  do_again text,
  learning_signal_written boolean,
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
  v_learning_idempotency_key text;
  v_correlation_id text;
  v_next_state_token text;
  v_attendance_result text;
  v_do_again text;
  v_do_again_bool boolean;
  v_signal_type public.learning_signal_type;
  v_signal_value_num numeric;
  v_signal_value_bool boolean;
  v_inserted_count integer := 0;
  v_learning_signal_written boolean := false;
begin
  if p_user_id is null then
    raise exception 'capture_post_event_do_again requires p_user_id';
  end if;

  if p_inbound_message_sid is null or btrim(p_inbound_message_sid) = '' then
    raise exception 'capture_post_event_do_again requires p_inbound_message_sid';
  end if;

  if p_do_again is null or p_do_again not in ('yes', 'no', 'unsure') then
    raise exception 'capture_post_event_do_again received invalid do_again %', p_do_again;
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
    'post_event:do_again:%s:%s',
    p_user_id::text,
    p_inbound_message_sid
  );

  v_learning_idempotency_key := format(
    'ls:do_again:%s:%s',
    v_session.linkup_id::text,
    p_user_id::text
  );

  select attendance_result
  into v_attendance_result
  from public.linkup_outcomes
  where linkup_id = v_session.linkup_id
    and user_id = p_user_id;

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
      v_attendance_result,
      p_do_again,
      false,
      true,
      'duplicate_replay',
      v_correlation_id;
    return;
  end if;

  if exists (
    select 1
    from public.learning_signals
    where idempotency_key = v_learning_idempotency_key
  ) then
    select state_token
    into v_next_state_token
    from public.conversation_sessions
    where id = v_session.id;

    if coalesce(v_next_state_token, '') = 'post_event:complete' then
      update public.conversation_sessions
      set state_token = 'post_event:finalized',
          last_inbound_message_sid = p_inbound_message_sid
      where id = v_session.id
        and state_token = 'post_event:complete'
      returning state_token
      into v_next_state_token;

      if not found then
        select state_token
        into v_next_state_token
        from public.conversation_sessions
        where id = v_session.id;
      end if;
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
      'post_event.do_again_captured',
      'post_event:complete',
      p_inbound_message_sid,
      jsonb_build_object(
        'do_again', p_do_again,
        'attendance_result', v_attendance_result,
        'learning_signal_written', false,
        'reason', 'already_recorded',
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
      v_session.state_token,
      coalesce(v_next_state_token, v_session.state_token),
      v_attendance_result,
      p_do_again,
      false,
      false,
      'already_recorded',
      v_correlation_id;
    return;
  end if;

  if v_session.state_token <> 'post_event:complete' then
    return query
    select
      v_session.id,
      v_session.linkup_id,
      v_session.mode,
      v_session.state_token,
      v_session.state_token,
      v_attendance_result,
      p_do_again,
      false,
      false,
      'state_not_complete',
      v_correlation_id;
    return;
  end if;

  v_do_again := p_do_again;
  v_do_again_bool := case v_do_again
    when 'yes' then true
    when 'no' then false
    else null
  end;

  v_signal_type := case v_do_again
    when 'yes' then 'linkup_do_again_yes'::public.learning_signal_type
    when 'no' then 'linkup_do_again_no'::public.learning_signal_type
    else 'linkup_do_again_unsure'::public.learning_signal_type
  end;

  v_signal_value_num := case v_do_again
    when 'yes' then 1.0
    when 'no' then 0.0
    else null
  end;

  v_signal_value_bool := case v_do_again
    when 'yes' then true
    when 'no' then false
    else null
  end;

  insert into public.linkup_outcomes (
    linkup_id,
    user_id,
    do_again
  )
  values (
    v_session.linkup_id,
    p_user_id,
    v_do_again_bool
  )
  on conflict on constraint linkup_outcomes_once do update
  set do_again = excluded.do_again,
      updated_at = now();

  select attendance_result
  into v_attendance_result
  from public.linkup_outcomes
  where linkup_id = v_session.linkup_id
    and user_id = p_user_id;

  insert into public.learning_signals (
    user_id,
    signal_type,
    subject_id,
    value_num,
    value_bool,
    value_text,
    meta,
    occurred_at,
    idempotency_key
  )
  values (
    p_user_id,
    v_signal_type,
    v_session.linkup_id,
    v_signal_value_num,
    v_signal_value_bool,
    null,
    jsonb_build_object(
      'attendance_result', v_attendance_result,
      'do_again', v_do_again,
      'source', 'post_event'
    ),
    now(),
    v_learning_idempotency_key
  )
  on conflict (idempotency_key) do nothing;

  get diagnostics v_inserted_count = row_count;
  v_learning_signal_written := v_inserted_count > 0;

  update public.conversation_sessions
  set state_token = 'post_event:finalized',
      last_inbound_message_sid = p_inbound_message_sid
  where id = v_session.id
    and state_token = 'post_event:complete'
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
    'post_event.do_again_captured',
    'post_event:complete',
    p_inbound_message_sid,
    jsonb_build_object(
      'do_again', v_do_again,
      'attendance_result', v_attendance_result,
      'learning_signal_written', v_learning_signal_written,
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
    'post_event:complete',
    coalesce(v_next_state_token, 'post_event:finalized'),
    v_attendance_result,
    v_do_again,
    v_learning_signal_written,
    false,
    case when v_learning_signal_written then 'captured' else 'already_recorded' end,
    v_correlation_id;
end;
$$;

revoke all on function public.capture_post_event_do_again(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.capture_post_event_do_again(uuid, uuid, text, text, text)
  to service_role;
