-- Ticket 3.2: Invitation expiry runner RPC
-- Narrowly scoped atomic transition for expiring one pending invitation.

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
        'time_window', v_invitation.time_window
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
