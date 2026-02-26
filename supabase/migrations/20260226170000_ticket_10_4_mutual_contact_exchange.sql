-- Ticket 10.4: mutual contact exchange capture + safety-gated reveal.

alter table public.linkup_outcomes
  add column if not exists exchange_opt_in boolean;

alter table public.linkup_outcomes
  add column if not exists exchange_revealed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'linkup_outcomes_exchange_revealed_requires_opt_in_chk'
      and conrelid = 'public.linkup_outcomes'::regclass
  ) then
    alter table public.linkup_outcomes
      add constraint linkup_outcomes_exchange_revealed_requires_opt_in_chk
      check (exchange_revealed_at is null or exchange_opt_in is true);
  end if;
end $$;

create index if not exists linkup_outcomes_linkup_exchange_opt_in_idx
  on public.linkup_outcomes(linkup_id, exchange_opt_in)
  where exchange_opt_in is not null;

create index if not exists linkup_outcomes_exchange_revealed_at_idx
  on public.linkup_outcomes(exchange_revealed_at)
  where exchange_revealed_at is not null;

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
      set state_token = 'post_event:contact_exchange',
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
  set state_token = 'post_event:contact_exchange',
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
    coalesce(v_next_state_token, 'post_event:contact_exchange'),
    v_attendance_result,
    v_do_again,
    v_learning_signal_written,
    false,
    case when v_learning_signal_written then 'captured' else 'already_recorded' end,
    v_correlation_id;
end;
$$;

create or replace function public.capture_post_event_exchange_choice(
  p_user_id uuid,
  p_inbound_message_id uuid,
  p_inbound_message_sid text,
  p_exchange_choice text,
  p_sms_encryption_key text default null,
  p_correlation_id text default null
)
returns table (
  session_id uuid,
  linkup_id uuid,
  mode public.conversation_mode,
  previous_state_token text,
  next_state_token text,
  exchange_choice text,
  exchange_opt_in boolean,
  mutual_detected boolean,
  reveal_sent boolean,
  blocked_by_safety boolean,
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
  v_exchange_choice text;
  v_exchange_opt_in boolean;
  v_mutual_detected boolean := false;
  v_reveal_sent boolean := false;
  v_blocked_by_safety boolean := false;
  v_counterpart record;
  v_counterpart_opt_in boolean;
  v_user_a uuid;
  v_user_b uuid;
  v_exchange_id uuid;
  v_has_active_hold boolean;
  v_total_strikes int;
  v_above_strike_threshold boolean;
  v_strike_threshold int := 3;
  v_linkup_correlation_id uuid;
  v_chooser_first_name text;
  v_chooser_phone_e164 text;
  v_suppression_reason text;
begin
  if p_user_id is null then
    raise exception 'capture_post_event_exchange_choice requires p_user_id';
  end if;

  if p_inbound_message_sid is null or btrim(p_inbound_message_sid) = '' then
    raise exception 'capture_post_event_exchange_choice requires p_inbound_message_sid';
  end if;

  if p_exchange_choice is null or p_exchange_choice not in ('yes', 'no', 'later') then
    raise exception 'capture_post_event_exchange_choice received invalid choice %', p_exchange_choice;
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

  select l.correlation_id
  into v_linkup_correlation_id
  from public.linkups l
  where l.id = v_session.linkup_id;

  select u.first_name, u.phone_e164
  into v_chooser_first_name, v_chooser_phone_e164
  from public.users u
  where u.id = p_user_id;

  if v_chooser_first_name is null or v_chooser_phone_e164 is null then
    raise exception 'capture_post_event_exchange_choice unable to resolve chooser contact details';
  end if;

  v_correlation_id := coalesce(
    nullif(btrim(coalesce(p_correlation_id, '')), ''),
    p_inbound_message_id::text,
    p_inbound_message_sid
  );

  v_idempotency_key := format(
    'post_event:contact_exchange:%s:%s',
    p_user_id::text,
    p_inbound_message_sid
  );

  if exists (
    select 1
    from public.conversation_events
    where idempotency_key = v_idempotency_key
  ) then
    select state_token
    into v_next_state_token
    from public.conversation_sessions
    where id = v_session.id;

    return query
    select
      v_session.id,
      v_session.linkup_id,
      v_session.mode,
      v_session.state_token,
      coalesce(v_next_state_token, v_session.state_token),
      p_exchange_choice,
      null,
      false,
      false,
      false,
      true,
      'duplicate_replay',
      v_correlation_id;
    return;
  end if;

  if v_session.state_token <> 'post_event:contact_exchange' then
    return query
    select
      v_session.id,
      v_session.linkup_id,
      v_session.mode,
      v_session.state_token,
      v_session.state_token,
      p_exchange_choice,
      null,
      false,
      false,
      false,
      false,
      'state_not_contact_exchange',
      v_correlation_id;
    return;
  end if;

  v_exchange_choice := p_exchange_choice;
  v_exchange_opt_in := case v_exchange_choice
    when 'yes' then true
    when 'no' then false
    else null
  end;

  insert into public.linkup_outcomes (
    linkup_id,
    user_id,
    exchange_opt_in
  )
  values (
    v_session.linkup_id,
    p_user_id,
    v_exchange_opt_in
  )
  on conflict on constraint linkup_outcomes_once do update
  set exchange_opt_in = excluded.exchange_opt_in,
      updated_at = now();

  if v_exchange_opt_in is true then
    for v_counterpart in
      select
        lp.user_id,
        u.first_name,
        u.phone_e164
      from public.linkup_participants lp
      inner join public.users u
        on u.id = lp.user_id
      where lp.linkup_id = v_session.linkup_id
        and lp.user_id <> p_user_id
        and lp.status = 'confirmed'
    loop
      select lo.exchange_opt_in
      into v_counterpart_opt_in
      from public.linkup_outcomes lo
      where lo.linkup_id = v_session.linkup_id
        and lo.user_id = v_counterpart.user_id;

      if coalesce(v_counterpart_opt_in, false) is not true then
        continue;
      end if;

      v_mutual_detected := true;

      v_user_a := least(p_user_id, v_counterpart.user_id);
      v_user_b := greatest(p_user_id, v_counterpart.user_id);

      select exists (
        select 1
        from public.safety_holds sh
        where sh.status = 'active'
          and sh.user_id in (p_user_id, v_counterpart.user_id)
          and (sh.expires_at is null or sh.expires_at > now())
      )
      into v_has_active_hold;

      select greatest(
        coalesce((
          select sum(us.points)::int
          from public.user_strikes us
          where us.user_id = p_user_id
            and us.window_end >= now()
        ), 0),
        coalesce((
          select sum(us.points)::int
          from public.user_strikes us
          where us.user_id = v_counterpart.user_id
            and us.window_end >= now()
        ), 0)
      )
      into v_total_strikes
      ;

      v_above_strike_threshold := v_total_strikes >= v_strike_threshold;

      if v_has_active_hold or v_above_strike_threshold then
        v_blocked_by_safety := true;
        v_suppression_reason := case
          when v_has_active_hold and v_above_strike_threshold then 'active_safety_hold_and_strike_threshold'
          when v_has_active_hold then 'active_safety_hold'
          else 'strike_threshold'
        end;

        insert into public.contact_exchange_events (
          linkup_id,
          event_type,
          idempotency_key,
          correlation_id,
          payload
        )
        values (
          v_session.linkup_id,
          'contact_exchange_suppressed',
          format(
            'contact_exchange:suppressed:%s:%s:%s',
            v_session.linkup_id::text,
            v_user_a::text,
            v_user_b::text
          ),
          v_linkup_correlation_id,
          jsonb_build_object(
            'user_a_id', v_user_a::text,
            'user_b_id', v_user_b::text,
            'chooser_user_id', p_user_id::text,
            'reason', v_suppression_reason,
            'strike_points', v_total_strikes,
            'strike_threshold', v_strike_threshold
          )
        )
        on conflict (idempotency_key) do nothing;

        continue;
      end if;

      v_exchange_id := null;

      insert into public.contact_exchanges (
        linkup_id,
        user_a_id,
        user_b_id,
        revealed_at
      )
      values (
        v_session.linkup_id,
        v_user_a,
        v_user_b,
        now()
      )
      on conflict on constraint contact_exchange_pair_once do nothing
      returning id
      into v_exchange_id;

      if v_exchange_id is null then
        continue;
      end if;

      v_reveal_sent := true;

      update public.linkup_outcomes
      set exchange_revealed_at = coalesce(exchange_revealed_at, now()),
          exchange_opt_in = true,
          updated_at = now()
      where linkup_id = v_session.linkup_id
        and user_id in (p_user_id, v_counterpart.user_id);

      insert into public.contact_exchange_events (
        linkup_id,
        event_type,
        idempotency_key,
        correlation_id,
        payload
      )
      values (
        v_session.linkup_id,
        'post_event.mutual_detected',
        format(
          'contact_exchange:mutual:%s:%s:%s',
          v_session.linkup_id::text,
          v_user_a::text,
          v_user_b::text
        ),
        v_linkup_correlation_id,
        jsonb_build_object(
          'user_a_id', v_user_a::text,
          'user_b_id', v_user_b::text
        )
      )
      on conflict (idempotency_key) do nothing;

      insert into public.contact_exchange_events (
        linkup_id,
        event_type,
        idempotency_key,
        correlation_id,
        payload
      )
      values (
        v_session.linkup_id,
        'post_event.reveal_sent',
        format(
          'contact_exchange:reveal:%s:%s:%s',
          v_session.linkup_id::text,
          v_user_a::text,
          v_user_b::text
        ),
        v_linkup_correlation_id,
        jsonb_build_object(
          'user_a_id', v_user_a::text,
          'user_b_id', v_user_b::text
        )
      )
      on conflict (idempotency_key) do nothing;

      if p_sms_encryption_key is null or length(trim(p_sms_encryption_key)) = 0 then
        raise exception
          'capture_post_event_exchange_choice missing p_sms_encryption_key for reveal';
      end if;

      insert into public.sms_outbound_jobs (
        user_id,
        to_e164,
        body_ciphertext,
        body_iv,
        body_tag,
        key_version,
        purpose,
        status,
        run_at,
        idempotency_key,
        correlation_id
      )
      values (
        p_user_id,
        v_chooser_phone_e164,
        public.encrypt_sms_body(
          format(
            'Good news — %s wants to stay in touch too. Here''s their number: %s. Reply STOP anytime.',
            v_counterpart.first_name,
            v_counterpart.phone_e164
          ),
          p_sms_encryption_key
        ),
        null,
        null,
        1,
        'post_event_contact_reveal',
        'pending',
        now(),
        format(
          'contact_reveal:%s:%s:%s:%s',
          v_session.linkup_id::text,
          v_user_a::text,
          v_user_b::text,
          p_user_id::text
        ),
        v_linkup_correlation_id
      )
      on conflict (idempotency_key) do nothing;

      insert into public.sms_outbound_jobs (
        user_id,
        to_e164,
        body_ciphertext,
        body_iv,
        body_tag,
        key_version,
        purpose,
        status,
        run_at,
        idempotency_key,
        correlation_id
      )
      values (
        v_counterpart.user_id,
        v_counterpart.phone_e164,
        public.encrypt_sms_body(
          format(
            'Good news — %s wants to stay in touch too. Here''s their number: %s. Reply STOP anytime.',
            v_chooser_first_name,
            v_chooser_phone_e164
          ),
          p_sms_encryption_key
        ),
        null,
        null,
        1,
        'post_event_contact_reveal',
        'pending',
        now(),
        format(
          'contact_reveal:%s:%s:%s:%s',
          v_session.linkup_id::text,
          v_user_a::text,
          v_user_b::text,
          v_counterpart.user_id::text
        ),
        v_linkup_correlation_id
      )
      on conflict (idempotency_key) do nothing;
    end loop;
  end if;

  update public.conversation_sessions
  set state_token = 'post_event:finalized',
      last_inbound_message_sid = p_inbound_message_sid
  where id = v_session.id
    and state_token = 'post_event:contact_exchange'
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
    'post_event.contact_exchange_captured',
    'post_event:contact_exchange',
    p_inbound_message_sid,
    jsonb_build_object(
      'exchange_choice', v_exchange_choice,
      'exchange_opt_in', v_exchange_opt_in,
      'mutual_detected', v_mutual_detected,
      'reveal_sent', v_reveal_sent,
      'blocked_by_safety', v_blocked_by_safety,
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
    'post_event:contact_exchange',
    coalesce(v_next_state_token, 'post_event:finalized'),
    v_exchange_choice,
    v_exchange_opt_in,
    v_mutual_detected,
    v_reveal_sent,
    v_blocked_by_safety,
    false,
    case
      when v_blocked_by_safety and not v_reveal_sent then 'blocked_by_safety'
      when v_reveal_sent then 'captured_revealed'
      when v_mutual_detected then 'mutual_already_revealed'
      else 'captured'
    end,
    v_correlation_id;
end;
$$;

revoke all on function public.capture_post_event_do_again(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.capture_post_event_do_again(uuid, uuid, text, text, text)
  to service_role;

revoke all on function public.capture_post_event_exchange_choice(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.capture_post_event_exchange_choice(uuid, uuid, text, text, text, text)
  to service_role;
