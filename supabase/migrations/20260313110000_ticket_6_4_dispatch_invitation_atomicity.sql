-- Ticket 6.4: dispatch invitation schema alignment and atomic dispatch RPC.

begin;

alter type public.invitation_type rename value 'group' to 'linkup';

alter table public.invitations
  rename column time_window to proposed_time_window;

alter table public.invitations
  add column if not exists offered_at timestamptz,
  add column if not exists location_hint text,
  add column if not exists group_size_preference_snapshot jsonb;

update public.invitations
set offered_at = coalesce(offered_at, created_at)
where offered_at is null;

alter table public.invitations
  alter column offered_at set not null;

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
        'proposed_time_window', v_invitation.proposed_time_window,
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

create or replace function public.expire_invitation(
  p_invitation_id uuid,
  p_correlation_id uuid,
  p_now timestamptz default now()
)
returns table (
  invitation_id uuid,
  user_id uuid,
  expired boolean,
  learning_signal_written boolean,
  session_reset boolean,
  backoff_incremented boolean,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.invitations%rowtype;
  v_signal_id uuid;
  v_session_id uuid;
begin
  if p_invitation_id is null then
    raise exception 'expire_invitation requires p_invitation_id';
  end if;

  if p_correlation_id is null then
    raise exception 'expire_invitation requires p_correlation_id';
  end if;

  select *
  into v_invitation
  from public.invitations
  where public.invitations.id = p_invitation_id
  for update;

  if not found then
    return query
    select
      p_invitation_id,
      null::uuid,
      false,
      false,
      false,
      false,
      'invitation_not_found';
    return;
  end if;

  if v_invitation.state <> 'pending' then
    return query
    select
      v_invitation.id,
      v_invitation.user_id,
      false,
      false,
      false,
      false,
      format('already_%s', v_invitation.state::text);
    return;
  end if;

  if v_invitation.expires_at > p_now then
    return query
    select
      v_invitation.id,
      v_invitation.user_id,
      false,
      false,
      false,
      false,
      'not_expired';
    return;
  end if;

  update public.invitations
  set state = 'expired'
  where id = p_invitation_id
    and state = 'pending'
  returning *
  into v_invitation;

  if not found then
    return query
    select
      p_invitation_id,
      null::uuid,
      false,
      false,
      false,
      false,
      'pending_guard_blocked';
    return;
  end if;

  insert into public.learning_signals (
    user_id,
    signal_type,
    subject_id,
    meta,
    occurred_at,
    ingested_at,
    idempotency_key
  )
  values (
    v_invitation.user_id,
    'invitation_expired',
    v_invitation.id,
    jsonb_strip_nulls(
      jsonb_build_object(
        'invitation_id', v_invitation.id,
        'invitation_type', v_invitation.invitation_type,
        'activity_key', v_invitation.activity_key,
        'proposed_time_window', v_invitation.proposed_time_window
      )
    ),
    p_now,
    p_now,
    format('invitation_expired:%s', v_invitation.id::text)
  )
  on conflict (idempotency_key) do nothing
  returning id into v_signal_id;

  update public.users
  set invitation_backoff_count = invitation_backoff_count + 1
  where id = v_invitation.user_id;

  update public.conversation_sessions
  set mode = 'idle',
      state_token = 'idle'
  where user_id = v_invitation.user_id
    and mode = 'awaiting_invitation_response'
  returning id into v_session_id;

  return query
  select
    v_invitation.id,
    v_invitation.user_id,
    true,
    v_signal_id is not null,
    v_session_id is not null,
    true,
    'expired';
end;
$$;

revoke all on function public.expire_invitation(
  uuid,
  uuid,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.expire_invitation(
  uuid,
  uuid,
  timestamptz
) to service_role;

create or replace function public.dispatch_invitation(
  p_user_id uuid,
  p_invitation_type public.invitation_type,
  p_activity_key text,
  p_proposed_time_window text,
  p_expiry_hours integer,
  p_location_hint text,
  p_linkup_id uuid,
  p_correlation_id uuid,
  p_idempotency_key text,
  p_outbound_message text,
  p_sms_encryption_key text,
  p_now timestamptz default now()
)
returns table (
  invitation_id uuid,
  dispatched boolean,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_existing_invitation_id uuid;
  v_invitation_id uuid;
  v_group_size_preference jsonb;
  v_week_start timestamptz;
  v_expires_at timestamptz;
  v_outbound_idempotency_key text;
begin
  if p_user_id is null then
    raise exception 'dispatch_invitation requires p_user_id';
  end if;

  if p_invitation_type is null then
    raise exception 'dispatch_invitation requires p_invitation_type';
  end if;

  if btrim(coalesce(p_activity_key, '')) = '' then
    raise exception 'dispatch_invitation requires p_activity_key';
  end if;

  if btrim(coalesce(p_proposed_time_window, '')) = '' then
    raise exception 'dispatch_invitation requires p_proposed_time_window';
  end if;

  if p_expiry_hours is null or p_expiry_hours <= 0 then
    raise exception 'dispatch_invitation requires positive p_expiry_hours';
  end if;

  if p_correlation_id is null then
    raise exception 'dispatch_invitation requires p_correlation_id';
  end if;

  if btrim(coalesce(p_idempotency_key, '')) = '' then
    raise exception 'dispatch_invitation requires p_idempotency_key';
  end if;

  if btrim(coalesce(p_outbound_message, '')) = '' then
    raise exception 'dispatch_invitation requires p_outbound_message';
  end if;

  if btrim(coalesce(p_sms_encryption_key, '')) = '' then
    raise exception 'dispatch_invitation requires p_sms_encryption_key';
  end if;

  if p_invitation_type = 'linkup' and p_linkup_id is null then
    raise exception 'dispatch_invitation requires p_linkup_id for linkup invitations';
  end if;

  if p_invitation_type = 'solo' and p_linkup_id is not null then
    raise exception 'dispatch_invitation forbids p_linkup_id for solo invitations';
  end if;

  select *
  into v_user
  from public.users
  where public.users.id = p_user_id
  for update;

  if not found then
    raise exception 'User % not found for dispatch_invitation', p_user_id;
  end if;

  perform 1
  from public.conversation_sessions
  where public.conversation_sessions.user_id = p_user_id
  for update;

  select public.profiles.group_size_preference
  into v_group_size_preference
  from public.profiles
  where public.profiles.user_id = p_user_id;

  v_week_start := date_trunc('week', p_now);
  v_expires_at := p_now + make_interval(hours => p_expiry_hours);
  v_outbound_idempotency_key := format(
    'dispatch_invitation:sms:%s',
    p_idempotency_key
  );

  insert into public.invitations (
    user_id,
    invitation_type,
    linkup_id,
    activity_key,
    proposed_time_window,
    location_hint,
    state,
    offered_at,
    expires_at,
    group_size_preference_snapshot,
    idempotency_key,
    correlation_id
  )
  values (
    p_user_id,
    p_invitation_type,
    p_linkup_id,
    btrim(p_activity_key),
    btrim(p_proposed_time_window),
    nullif(btrim(coalesce(p_location_hint, '')), ''),
    'pending',
    p_now,
    v_expires_at,
    v_group_size_preference,
    btrim(p_idempotency_key),
    p_correlation_id
  )
  on conflict (idempotency_key) do nothing
  returning id into v_invitation_id;

  if v_invitation_id is null then
    select public.invitations.id
    into v_existing_invitation_id
    from public.invitations
    where public.invitations.idempotency_key = btrim(p_idempotency_key)
    limit 1;

    return query
    select
      v_existing_invitation_id,
      false,
      'already_invited_this_week';
    return;
  end if;

  insert into public.conversation_sessions (
    user_id,
    mode,
    state_token,
    current_step_id,
    last_inbound_message_sid,
    linkup_id
  )
  values (
    p_user_id,
    'awaiting_invitation_response',
    'invitation:awaiting_response',
    null,
    null,
    p_linkup_id
  )
  on conflict (user_id) do update
  set mode = 'awaiting_invitation_response',
      state_token = 'invitation:awaiting_response',
      linkup_id = excluded.linkup_id;

  update public.users
  set last_invited_at = p_now,
      invitation_week_start = case
        when invitation_week_start is null
          or p_now > invitation_week_start + interval '7 days'
          then v_week_start
        else invitation_week_start
      end,
      invitation_count_this_week = case
        when invitation_week_start is null
          or p_now > invitation_week_start + interval '7 days'
          then 1
        else invitation_count_this_week + 1
      end
  where id = p_user_id;

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
    correlation_id,
    idempotency_key
  )
  values (
    p_user_id,
    v_user.phone_e164,
    public.encrypt_sms_body(p_outbound_message, p_sms_encryption_key),
    null,
    null,
    1,
    'invitation_dispatch_v1',
    'pending',
    p_now,
    p_correlation_id,
    v_outbound_idempotency_key
  )
  on conflict (idempotency_key) do nothing;

  return query
  select
    v_invitation_id,
    true,
    null::text;
end;
$$;

revoke all on function public.dispatch_invitation(
  uuid,
  public.invitation_type,
  text,
  text,
  integer,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.dispatch_invitation(
  uuid,
  public.invitation_type,
  text,
  text,
  integer,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz
) to service_role;

commit;
