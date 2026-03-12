-- Ticket 3.0: invitation response atomicity foundation

do $$
begin
  if exists (
    select 1
    from public.invitations
    where response_message_sid is not null
    group by response_message_sid
    having count(*) > 1
  ) then
    raise exception
      'Duplicate non-null invitations.response_message_sid values exist; cannot add replay-safe uniqueness guarantee.';
  end if;
end $$;

create unique index if not exists invitations_response_message_sid_uniq
  on public.invitations(response_message_sid)
  where response_message_sid is not null;

create or replace function public.apply_invitation_response(
  p_invitation_id uuid,
  p_user_id uuid,
  p_inbound_message_id uuid,
  p_inbound_message_sid text,
  p_action text,
  p_outbound_message text,
  p_sms_encryption_key text,
  p_now timestamptz default now()
)
returns table (
  invitation_id uuid,
  user_id uuid,
  invitation_type public.invitation_type,
  resulting_state public.invitation_state,
  duplicate boolean,
  processed boolean,
  learning_signal_written boolean,
  outbound_job_id uuid,
  next_mode public.conversation_mode,
  next_state_token text,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_message_sid text := btrim(coalesce(p_inbound_message_sid, ''));
  v_invitation public.invitations%rowtype;
  v_session public.conversation_sessions%rowtype;
  v_user public.users%rowtype;
  v_result_state public.invitation_state;
  v_signal_type public.learning_signal_type;
  v_signal_idempotency_key text;
  v_outbound_idempotency_key text;
  v_outbound_job_id uuid;
begin
  if p_invitation_id is null then
    raise exception 'apply_invitation_response requires p_invitation_id';
  end if;

  if p_user_id is null then
    raise exception 'apply_invitation_response requires p_user_id';
  end if;

  if p_inbound_message_id is null then
    raise exception 'apply_invitation_response requires p_inbound_message_id';
  end if;

  if v_message_sid = '' then
    raise exception 'apply_invitation_response requires p_inbound_message_sid';
  end if;

  if v_action not in ('accept', 'pass') then
    raise exception 'apply_invitation_response received invalid action %', p_action;
  end if;

  if btrim(coalesce(p_outbound_message, '')) = '' then
    raise exception 'apply_invitation_response requires p_outbound_message';
  end if;

  if btrim(coalesce(p_sms_encryption_key, '')) = '' then
    raise exception 'apply_invitation_response requires p_sms_encryption_key';
  end if;

  select *
  into v_session
  from public.conversation_sessions
  where public.conversation_sessions.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Conversation session for user % not found', p_user_id;
  end if;

  select *
  into v_invitation
  from public.invitations
  where public.invitations.id = p_invitation_id
  for update;

  if not found then
    update public.conversation_sessions
    set mode = 'idle',
        state_token = 'idle',
        last_inbound_message_sid = v_message_sid
    where id = v_session.id;

    return query
    select
      p_invitation_id,
      p_user_id,
      null::public.invitation_type,
      null::public.invitation_state,
      false,
      false,
      false,
      null::uuid,
      'idle'::public.conversation_mode,
      'idle',
      'invitation_not_found';
    return;
  end if;

  if v_invitation.user_id <> p_user_id then
    return query
    select
      v_invitation.id,
      p_user_id,
      v_invitation.invitation_type,
      v_invitation.state,
      false,
      false,
      false,
      null::uuid,
      v_session.mode,
      v_session.state_token,
      'invitation_user_mismatch';
    return;
  end if;

  if v_invitation.response_message_sid is not null then
    if v_invitation.response_message_sid = v_message_sid then
      select id
      into v_outbound_job_id
      from public.sms_outbound_jobs
      where public.sms_outbound_jobs.idempotency_key = format(
        'invitation_response:sms:%s',
        v_invitation.id::text
      )
      limit 1;

      return query
      select
        v_invitation.id,
        v_invitation.user_id,
        v_invitation.invitation_type,
        v_invitation.state,
        true,
        false,
        false,
        v_outbound_job_id,
        v_session.mode,
        v_session.state_token,
        'duplicate_replay';
      return;
    end if;

    update public.conversation_sessions
    set mode = 'idle',
        state_token = 'idle',
        last_inbound_message_sid = v_message_sid
    where id = v_session.id;

    return query
    select
      v_invitation.id,
      v_invitation.user_id,
      v_invitation.invitation_type,
      v_invitation.state,
      false,
      false,
      false,
      null::uuid,
      'idle'::public.conversation_mode,
      'idle',
      format('already_%s', v_invitation.state::text);
    return;
  end if;

  if v_invitation.state <> 'pending' then
    update public.conversation_sessions
    set mode = 'idle',
        state_token = 'idle',
        last_inbound_message_sid = v_message_sid
    where id = v_session.id;

    return query
    select
      v_invitation.id,
      v_invitation.user_id,
      v_invitation.invitation_type,
      v_invitation.state,
      false,
      false,
      false,
      null::uuid,
      'idle'::public.conversation_mode,
      'idle',
      format('already_%s', v_invitation.state::text);
    return;
  end if;

  if v_action = 'accept' and v_invitation.expires_at <= p_now then
    update public.conversation_sessions
    set mode = 'idle',
        state_token = 'idle',
        last_inbound_message_sid = v_message_sid
    where id = v_session.id;

    return query
    select
      v_invitation.id,
      v_invitation.user_id,
      v_invitation.invitation_type,
      v_invitation.state,
      false,
      false,
      false,
      null::uuid,
      'idle'::public.conversation_mode,
      'idle',
      'accept_window_elapsed';
    return;
  end if;

  select *
  into v_user
  from public.users
  where public.users.id = v_invitation.user_id
  for update;

  if not found then
    raise exception 'User % for invitation % not found', v_invitation.user_id, v_invitation.id;
  end if;

  v_result_state := case
    when v_action = 'accept' then 'accepted'::public.invitation_state
    else 'passed'::public.invitation_state
  end;
  v_signal_type := case
    when v_action = 'accept' then 'invitation_accepted'::public.learning_signal_type
    else 'invitation_passed'::public.learning_signal_type
  end;
  v_signal_idempotency_key := format('ls:invitation_response:%s', v_invitation.id::text);
  v_outbound_idempotency_key := format(
    'invitation_response:sms:%s',
    v_invitation.id::text
  );

  begin
    update public.invitations
    set state = v_result_state,
        responded_at = p_now,
        response_message_sid = v_message_sid
    where id = v_invitation.id;
  exception
    when unique_violation then
      select *
      into v_invitation
      from public.invitations
      where public.invitations.response_message_sid = v_message_sid
      limit 1;

      if found and v_invitation.id = p_invitation_id then
        select id
        into v_outbound_job_id
        from public.sms_outbound_jobs
        where public.sms_outbound_jobs.idempotency_key = v_outbound_idempotency_key
        limit 1;

        return query
        select
          v_invitation.id,
          v_invitation.user_id,
          v_invitation.invitation_type,
          v_invitation.state,
          true,
          false,
          false,
          v_outbound_job_id,
          v_session.mode,
          v_session.state_token,
          'duplicate_replay';
        return;
      end if;

      update public.conversation_sessions
      set mode = 'idle',
          state_token = 'idle',
          last_inbound_message_sid = v_message_sid
      where id = v_session.id;

      return query
      select
        p_invitation_id,
        p_user_id,
        null::public.invitation_type,
        null::public.invitation_state,
        false,
        false,
        false,
        null::uuid,
        'idle'::public.conversation_mode,
        'idle',
        'message_sid_already_used';
      return;
  end;

  insert into public.learning_signals (
    user_id,
    signal_type,
    subject_id,
    value_bool,
    meta,
    occurred_at,
    ingested_at,
    idempotency_key
  )
  values (
    v_invitation.user_id,
    v_signal_type,
    v_invitation.id,
    case when v_action = 'accept' then true else false end,
    jsonb_strip_nulls(
      jsonb_build_object(
        'invitation_id', v_invitation.id,
        'invitation_type', v_invitation.invitation_type,
        'activity_key', v_invitation.activity_key,
        'time_window', v_invitation.time_window,
        'linkup_id', v_invitation.linkup_id
      )
    ),
    p_now,
    p_now,
    v_signal_idempotency_key
  );

  update public.users
  set invitation_backoff_count = case
      when v_action = 'accept' then 0
      else invitation_backoff_count + 1
    end
  where id = v_invitation.user_id;

  update public.conversation_sessions
  set mode = 'idle',
      state_token = 'idle',
      last_inbound_message_sid = v_message_sid
  where id = v_session.id;

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
    v_invitation.user_id,
    v_user.phone_e164,
    public.encrypt_sms_body(p_outbound_message, p_sms_encryption_key),
    null,
    null,
    1,
    'invitation_response_confirmation',
    'pending',
    p_now,
    v_outbound_idempotency_key,
    p_inbound_message_id
  )
  returning id into v_outbound_job_id;

  return query
  select
    v_invitation.id,
    v_invitation.user_id,
    v_invitation.invitation_type,
    v_result_state,
    false,
    true,
    true,
    v_outbound_job_id,
    'idle'::public.conversation_mode,
    'idle',
    case
      when v_action = 'accept' then 'accepted'
      else 'passed'
    end;
end;
$$;

revoke all on function public.apply_invitation_response(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_invitation_response(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  timestamptz
) to service_role;
