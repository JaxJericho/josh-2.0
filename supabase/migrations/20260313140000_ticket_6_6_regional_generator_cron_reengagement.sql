begin;

create or replace function public.send_reengagement_message(
  p_user_id uuid,
  p_threshold integer,
  p_message_template text,
  p_sms_encryption_key text,
  p_state_token text default 'interview:awaiting_next_input',
  p_now timestamptz default now()
)
returns table (
  sent boolean,
  user_id uuid,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_first_name text;
  v_message_text text;
  v_outbound_idempotency_key text;
  v_correlation_id uuid;
begin
  if p_user_id is null then
    raise exception 'send_reengagement_message requires p_user_id';
  end if;

  if p_threshold is null or p_threshold <= 0 then
    raise exception 'send_reengagement_message requires positive p_threshold';
  end if;

  if btrim(coalesce(p_message_template, '')) = '' then
    raise exception 'send_reengagement_message requires p_message_template';
  end if;

  if btrim(coalesce(p_sms_encryption_key, '')) = '' then
    raise exception 'send_reengagement_message requires p_sms_encryption_key';
  end if;

  if btrim(coalesce(p_state_token, '')) = '' then
    raise exception 'send_reengagement_message requires p_state_token';
  end if;

  select *
  into v_user
  from public.users
  where public.users.id = p_user_id
  for update;

  if not found then
    raise exception 'User % not found for send_reengagement_message', p_user_id;
  end if;

  perform 1
  from public.conversation_sessions
  where public.conversation_sessions.user_id = p_user_id
  for update;

  if exists (
    select 1
    from public.safety_holds
    where public.safety_holds.user_id = p_user_id
      and public.safety_holds.status = 'active'
  ) then
    return query
    select
      false,
      null::uuid,
      'safety_hold'::text;
    return;
  end if;

  if coalesce(v_user.invitation_backoff_count, 0) < p_threshold then
    return query
    select
      false,
      null::uuid,
      'threshold_not_met'::text;
    return;
  end if;

  v_first_name := nullif(btrim(v_user.first_name), '');
  if v_first_name is null then
    v_first_name := 'there';
  end if;

  v_message_text := replace(p_message_template, '{firstName}', v_first_name);
  v_correlation_id := gen_random_uuid();
  v_outbound_idempotency_key := format(
    're_engagement:%s:%s:%s',
    p_user_id::text,
    coalesce(
      to_char(v_user.last_invited_at at time zone 'UTC', 'YYYYMMDDHH24MISS.US'),
      'never'
    ),
    coalesce(v_user.invitation_backoff_count::text, '0')
  );

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
    public.encrypt_sms_body(v_message_text, p_sms_encryption_key),
    null,
    null,
    1,
    'invitation_reengagement',
    'pending',
    p_now,
    v_correlation_id,
    v_outbound_idempotency_key
  )
  on conflict (idempotency_key) do nothing;

  update public.users
  set invitation_backoff_count = 0
  where public.users.id = p_user_id;

  insert into public.conversation_sessions (
    user_id,
    mode,
    state_token,
    current_step_id,
    last_inbound_message_sid,
    linkup_id,
    dropout_nudge_sent_at
  )
  values (
    p_user_id,
    'interviewing',
    p_state_token,
    null,
    null,
    null,
    null
  )
  on conflict (user_id) do update
  set mode = 'interviewing',
      state_token = excluded.state_token,
      current_step_id = null,
      last_inbound_message_sid = null,
      linkup_id = null,
      dropout_nudge_sent_at = null;

  return query
  select
    true,
    p_user_id,
    null::text;
end;
$$;

revoke all on function public.send_reengagement_message(
  uuid,
  integer,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.send_reengagement_message(
  uuid,
  integer,
  text,
  text,
  text,
  timestamptz
) to service_role;

commit;
