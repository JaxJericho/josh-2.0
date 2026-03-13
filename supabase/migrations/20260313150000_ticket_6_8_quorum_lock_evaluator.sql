begin;

create or replace function public.lock_linkup_quorum(
  p_linkup_id uuid,
  p_confirmation_message text,
  p_sms_encryption_key text,
  p_now timestamptz default now()
)
returns table (
  status text,
  accepted_count int,
  locked_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linkup public.linkups%rowtype;
  v_locked_at timestamptz;
  v_accepted_count int := 0;
begin
  if p_linkup_id is null then
    raise exception 'lock_linkup_quorum requires p_linkup_id';
  end if;

  if btrim(coalesce(p_confirmation_message, '')) = '' then
    raise exception 'lock_linkup_quorum requires p_confirmation_message';
  end if;

  if btrim(coalesce(p_sms_encryption_key, '')) = '' then
    raise exception 'lock_linkup_quorum requires p_sms_encryption_key';
  end if;

  select *
  into v_linkup
  from public.linkups
  where public.linkups.id = p_linkup_id
  for update;

  if not found then
    return query
    select 'not_found'::text, 0, null::timestamptz;
    return;
  end if;

  select count(*)::int
  into v_accepted_count
  from public.invitations
  where public.invitations.linkup_id = p_linkup_id
    and public.invitations.state = 'accepted';

  if v_linkup.state = 'locked' then
    return query
    select 'already_locked'::text, v_accepted_count, v_linkup.locked_at;
    return;
  end if;

  if v_linkup.state <> 'broadcasting' then
    return query
    select 'not_broadcasting'::text, v_accepted_count, v_linkup.locked_at;
    return;
  end if;

  update public.linkups
  set
    state = 'locked',
    locked_at = coalesce(locked_at, p_now),
    acceptance_window_ends_at = p_now,
    lock_version = lock_version + 1,
    updated_at = p_now
  where id = p_linkup_id
    and state = 'broadcasting'
  returning public.linkups.locked_at into v_locked_at;

  if not found then
    select public.linkups.locked_at
    into v_locked_at
    from public.linkups
    where public.linkups.id = p_linkup_id;

    return query
    select 'already_locked'::text, v_accepted_count, v_locked_at;
    return;
  end if;

  insert into public.linkup_participants (
    linkup_id,
    user_id,
    role,
    status,
    joined_at
  )
  select
    p_linkup_id,
    public.invitations.user_id,
    'participant',
    'confirmed',
    p_now
  from public.invitations
  where public.invitations.linkup_id = p_linkup_id
    and public.invitations.state = 'accepted'
  on conflict (linkup_id, user_id) do nothing;

  -- invitation_state has no "closed" value, so pending invitation rows are
  -- transitioned to expired to remove them from future response handling.
  update public.invitations
  set
    state = 'expired',
    updated_at = p_now
  where public.invitations.linkup_id = p_linkup_id
    and public.invitations.state = 'pending';

  update public.linkup_invites
  set
    state = 'closed',
    closed_at = coalesce(closed_at, p_now),
    terminal_reason = coalesce(terminal_reason, 'linkup_locked'),
    updated_at = p_now
  where public.linkup_invites.linkup_id = p_linkup_id
    and public.linkup_invites.state = 'pending';

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
  select
    public.invitations.user_id,
    public.users.phone_e164,
    public.encrypt_sms_body(p_confirmation_message, p_sms_encryption_key),
    null,
    null,
    1,
    'linkup_lock_confirmation',
    'pending',
    p_now,
    format(
      'linkup_lock_confirmation:%s:%s',
      p_linkup_id::text,
      public.invitations.user_id::text
    ),
    v_linkup.correlation_id
  from public.invitations
  join public.users
    on public.users.id = public.invitations.user_id
  where public.invitations.linkup_id = p_linkup_id
    and public.invitations.state = 'accepted'
    and coalesce(public.users.phone_e164, '') <> ''
  on conflict (idempotency_key) do nothing;

  return query
  select 'locked'::text, v_accepted_count, v_locked_at;
end;
$$;

revoke all on function public.lock_linkup_quorum(
  uuid,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.lock_linkup_quorum(
  uuid,
  text,
  text,
  timestamptz
) to service_role;

commit;
