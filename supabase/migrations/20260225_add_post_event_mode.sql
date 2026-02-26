-- Ticket 10.1: post_event session mode + deterministic post-event transition.

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
      and t.typname = 'conversation_mode'
      and e.enumlabel = 'post_event'
  ) then
    alter type public.conversation_mode add value 'post_event';
  end if;
end $$;

create or replace function public.transition_session_to_post_event_if_linkup_completed(
  p_session_id uuid,
  p_correlation_id text default null
)
returns table (
  session_id uuid,
  transitioned boolean,
  reason text,
  previous_mode public.conversation_mode,
  next_mode public.conversation_mode,
  state_token text,
  linkup_id uuid,
  linkup_state public.linkup_state,
  correlation_id text,
  linkup_correlation_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.conversation_sessions%rowtype;
  v_linkup public.linkups%rowtype;
  v_previous_mode public.conversation_mode;
  v_next_mode public.conversation_mode;
  v_state_token text;
  v_correlation_id text;
begin
  if p_session_id is null then
    raise exception 'transition_session_to_post_event_if_linkup_completed requires p_session_id';
  end if;

  select *
  into v_session
  from public.conversation_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'Conversation session % not found', p_session_id;
  end if;

  v_previous_mode := v_session.mode;
  v_next_mode := v_session.mode;
  v_state_token := v_session.state_token;
  v_correlation_id := coalesce(p_correlation_id, '');

  if v_session.linkup_id is null then
    return query
    select
      v_session.id,
      false,
      'no_linkup',
      v_previous_mode,
      v_next_mode,
      v_state_token,
      null::uuid,
      null::public.linkup_state,
      nullif(v_correlation_id, ''),
      null::uuid;
    return;
  end if;

  select *
  into v_linkup
  from public.linkups
  where id = v_session.linkup_id;

  if not found then
    return query
    select
      v_session.id,
      false,
      'linkup_missing',
      v_previous_mode,
      v_next_mode,
      v_state_token,
      v_session.linkup_id,
      null::public.linkup_state,
      nullif(v_correlation_id, ''),
      null::uuid;
    return;
  end if;

  v_correlation_id := coalesce(nullif(v_correlation_id, ''), v_linkup.correlation_id::text);

  if v_linkup.state <> 'completed' then
    return query
    select
      v_session.id,
      false,
      'linkup_not_completed',
      v_previous_mode,
      v_next_mode,
      v_state_token,
      v_session.linkup_id,
      v_linkup.state,
      v_correlation_id,
      v_linkup.correlation_id;
    return;
  end if;

  if v_session.mode = 'post_event' then
    return query
    select
      v_session.id,
      false,
      'already_post_event',
      v_previous_mode,
      v_next_mode,
      v_state_token,
      v_session.linkup_id,
      v_linkup.state,
      v_correlation_id,
      v_linkup.correlation_id;
    return;
  end if;

  if v_session.mode not in ('idle', 'linkup_forming', 'awaiting_invite_reply') then
    return query
    select
      v_session.id,
      false,
      'mode_protected',
      v_previous_mode,
      v_next_mode,
      v_state_token,
      v_session.linkup_id,
      v_linkup.state,
      v_correlation_id,
      v_linkup.correlation_id;
    return;
  end if;

  update public.conversation_sessions
  set mode = 'post_event',
      state_token = 'post_event:attendance',
      current_step_id = null
  where id = v_session.id
    and mode = v_previous_mode
  returning mode, state_token
  into v_next_mode, v_state_token;

  if not found then
    select mode, state_token
    into v_next_mode, v_state_token
    from public.conversation_sessions
    where id = v_session.id;

    return query
    select
      v_session.id,
      false,
      'concurrent_update',
      v_previous_mode,
      v_next_mode,
      v_state_token,
      v_session.linkup_id,
      v_linkup.state,
      v_correlation_id,
      v_linkup.correlation_id;
    return;
  end if;

  return query
  select
    v_session.id,
    true,
    'transitioned',
    v_previous_mode,
    v_next_mode,
    v_state_token,
    v_session.linkup_id,
    v_linkup.state,
    v_correlation_id,
    v_linkup.correlation_id;
end;
$$;

revoke all on function public.transition_session_to_post_event_if_linkup_completed(uuid, text)
  from public, anon, authenticated;
grant execute on function public.transition_session_to_post_event_if_linkup_completed(uuid, text)
  to service_role;
