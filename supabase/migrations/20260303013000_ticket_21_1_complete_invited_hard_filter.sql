-- Ticket 21.1: enforce complete_invited hard filter at LinkUp SQL boundaries.
-- Forward migration only: redefine existing functions with hard query-level exclusions.

create or replace function public.linkup_send_next_wave(
  p_linkup_id uuid,
  p_idempotency_key text default null,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linkup public.linkups%rowtype;
  v_wave_no int;
  v_wave_size int;
  v_invites_created int := 0;
  v_lock_attempt jsonb;
  v_status text;
  v_event_key text;
begin
  if p_idempotency_key is not null then
    if exists (
      select 1
      from public.linkup_events
      where idempotency_key = p_idempotency_key
    ) then
      return jsonb_build_object(
        'status', 'idempotent_replay',
        'linkup_id', p_linkup_id
      );
    end if;
  end if;

  v_lock_attempt := public.linkup_attempt_lock(
    p_linkup_id,
    format('linkup:auto_lock_before_wave:%s:%s', p_linkup_id::text, coalesce(p_idempotency_key, 'none')),
    p_now
  );

  if (v_lock_attempt ->> 'status') in ('locked', 'already_locked') then
    return jsonb_build_object(
      'status', 'already_locked',
      'linkup_id', p_linkup_id,
      'lock_status', v_lock_attempt
    );
  end if;

  select *
  into v_linkup
  from public.linkups
  where id = p_linkup_id
  for update;

  if not found then
    return jsonb_build_object(
      'status', 'not_found',
      'linkup_id', p_linkup_id
    );
  end if;

  if v_linkup.state <> 'broadcasting' then
    return jsonb_build_object(
      'status', 'not_broadcasting',
      'linkup_id', p_linkup_id,
      'state', v_linkup.state
    );
  end if;

  if v_linkup.acceptance_window_ends_at is not null and p_now >= v_linkup.acceptance_window_ends_at then
    if public.linkup_maybe_expire(p_linkup_id, p_now) then
      return jsonb_build_object(
        'status', 'expired',
        'linkup_id', p_linkup_id
      );
    end if;
  end if;

  if v_linkup.waves_sent >= v_linkup.max_waves then
    return jsonb_build_object(
      'status', 'max_waves_reached',
      'linkup_id', p_linkup_id,
      'waves_sent', v_linkup.waves_sent,
      'max_waves', v_linkup.max_waves
    );
  end if;

  v_wave_no := v_linkup.waves_sent + 1;
  v_wave_size := public.resolve_linkup_wave_size(v_linkup.wave_sizes, v_wave_no, 6);

  with eligible_candidates as (
    select
      s.candidate_user_id,
      s.rank_score,
      s.rank_position
    from public.linkup_candidate_seeds s
    join public.users u
      on u.id = s.candidate_user_id
    join public.profiles p
      on p.user_id = u.id
    left join public.profile_entitlements pe
      on pe.profile_id = p.id
    where s.linkup_id = p_linkup_id
      and coalesce(s.is_eligible, true)
      and s.invited_at is null
      and s.candidate_user_id <> v_linkup.initiator_user_id
      and u.state = 'active'
      and u.deleted_at is null
      -- complete_invited hard filter: never relax
      and p.state <> 'complete_invited'
      and (p.is_complete_mvp = true or p.state = 'complete_full')
      and coalesce(pe.can_participate, false)
      and not exists (
        select 1
        from public.safety_holds sh
        where sh.user_id = s.candidate_user_id
          and sh.status = 'active'
          and (sh.expires_at is null or sh.expires_at > p_now)
      )
      and not exists (
        select 1
        from public.user_blocks ub
        where (
          ub.blocker_user_id = v_linkup.initiator_user_id
          and ub.blocked_user_id = s.candidate_user_id
        )
        or (
          ub.blocker_user_id = s.candidate_user_id
          and ub.blocked_user_id = v_linkup.initiator_user_id
        )
      )
      and not exists (
        select 1
        from public.linkup_invites li_existing
        where li_existing.linkup_id = p_linkup_id
          and li_existing.invited_user_id = s.candidate_user_id
      )
    order by coalesce(s.rank_position, 2147483647), coalesce(s.rank_score, 0) desc, s.candidate_user_id
    limit v_wave_size
  ),
  inserted_invites as (
    insert into public.linkup_invites (
      linkup_id,
      invited_user_id,
      state,
      offered_options,
      sent_at,
      expires_at,
      wave_no,
      idempotency_key,
      explainability
    )
    select
      p_linkup_id,
      c.candidate_user_id,
      'pending',
      case
        when jsonb_typeof(v_linkup.brief -> 'time_window_options') = 'array' then v_linkup.brief -> 'time_window_options'
        when v_linkup.brief ? 'time_window' then jsonb_build_array(v_linkup.brief ->> 'time_window')
        else '[]'::jsonb
      end,
      p_now,
      v_linkup.acceptance_window_ends_at,
      v_wave_no,
      format('linkup_invite:%s:%s', p_linkup_id::text, c.candidate_user_id::text),
      jsonb_build_object(
        'seed_source', 'linkup_candidate_seeds',
        'rank_score', c.rank_score,
        'rank_position', c.rank_position,
        'wave_no', v_wave_no
      )
    from eligible_candidates c
    on conflict (linkup_id, invited_user_id) do nothing
    returning id, invited_user_id
  ),
  outbound_jobs as (
    insert into public.sms_outbound_jobs (
      user_id,
      to_e164,
      purpose,
      status,
      run_at,
      idempotency_key,
      correlation_id
    )
    select
      ii.invited_user_id,
      u.phone_e164,
      'linkup_invite_wave',
      'pending',
      p_now,
      format('invite_sms:%s:v1', ii.id::text),
      v_linkup.correlation_id
    from inserted_invites ii
    join public.users u
      on u.id = ii.invited_user_id
    on conflict (idempotency_key) do nothing
    returning id
  )
  select count(*)::int
  into v_invites_created
  from inserted_invites;

  update public.linkup_candidate_seeds s
  set
    invited_wave = v_wave_no,
    invited_at = p_now,
    updated_at = p_now
  where s.linkup_id = p_linkup_id
    and exists (
      select 1
      from public.linkup_invites li
      where li.linkup_id = p_linkup_id
        and li.invited_user_id = s.candidate_user_id
        and li.wave_no = v_wave_no
    );

  update public.linkups
  set
    waves_sent = v_wave_no,
    broadcast_started_at = coalesce(broadcast_started_at, p_now),
    acceptance_window_ends_at = coalesce(acceptance_window_ends_at, p_now + interval '24 hours'),
    updated_at = p_now
  where id = p_linkup_id;

  v_status := case when v_invites_created > 0 then 'wave_sent' else 'no_candidates' end;
  v_event_key := coalesce(
    p_idempotency_key,
    format('linkup:wave:%s:%s', p_linkup_id::text, v_wave_no::text)
  );

  insert into public.linkup_events (
    linkup_id,
    event_type,
    from_state,
    to_state,
    idempotency_key,
    payload
  )
  values (
    p_linkup_id,
    'invite_wave_sent',
    'broadcasting',
    'broadcasting',
    v_event_key,
    jsonb_build_object(
      'wave_no', v_wave_no,
      'wave_size', v_wave_size,
      'invites_created', v_invites_created,
      'status', v_status
    )
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'status', v_status,
    'linkup_id', p_linkup_id,
    'wave_no', v_wave_no,
    'wave_size', v_wave_size,
    'invites_created', v_invites_created
  );
end;
$$;

create or replace function public.linkup_create_from_seed(
  p_initiator_user_id uuid,
  p_region_id uuid,
  p_brief jsonb,
  p_linkup_create_key text,
  p_seed_user_ids uuid[] default null,
  p_seed_scores double precision[] default null,
  p_seed_match_run_id uuid default null,
  p_max_waves int default 3,
  p_wave_sizes int[] default array[6, 6, 8]::int[],
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linkup_id uuid;
  v_created_new boolean := false;
  v_existing_state public.linkup_state;
  v_min_size int;
  v_max_size int;
  v_has_seed_users boolean;
  v_has_match_seed boolean;
  v_wave_result jsonb;
  v_region_state public.region_state;
  v_user_state public.user_state;
  v_profile_state public.profile_state;
  v_profile_complete boolean;
  v_profile_is_complete_invited boolean := false;
  v_can_initiate boolean := false;
  v_has_active_hold boolean := false;
begin
  if p_initiator_user_id is null then
    raise exception 'linkup_create_from_seed requires p_initiator_user_id';
  end if;

  if p_region_id is null then
    raise exception 'linkup_create_from_seed requires p_region_id';
  end if;

  if p_brief is null or jsonb_typeof(p_brief) <> 'object' then
    raise exception 'linkup_create_from_seed requires object brief payload';
  end if;

  if p_linkup_create_key is null or length(trim(p_linkup_create_key)) = 0 then
    raise exception 'linkup_create_from_seed requires non-empty linkup_create_key';
  end if;

  v_has_seed_users := coalesce(array_length(p_seed_user_ids, 1), 0) > 0;
  v_has_match_seed := p_seed_match_run_id is not null;

  if not v_has_seed_users and not v_has_match_seed then
    raise exception 'linkup_create_from_seed requires p_seed_user_ids or p_seed_match_run_id';
  end if;

  select
    u.state,
    p.state,
    p.is_complete_mvp,
    coalesce((p.state)::text = 'complete_invited', false),
    coalesce(pe.can_initiate, false),
    exists (
      select 1
      from public.safety_holds sh
      where sh.user_id = u.id
        and sh.status = 'active'
        and (sh.expires_at is null or sh.expires_at > p_now)
    )
  into
    v_user_state,
    v_profile_state,
    v_profile_complete,
    v_profile_is_complete_invited,
    v_can_initiate,
    v_has_active_hold
  from public.users u
  left join public.profiles p
    on p.user_id = u.id
  left join public.profile_entitlements pe
    on pe.profile_id = p.id
  where u.id = p_initiator_user_id;

  if not found then
    raise exception 'Initiator user not found: %', p_initiator_user_id;
  end if;

  select r.state
  into v_region_state
  from public.regions r
  where r.id = p_region_id;

  if not found then
    raise exception 'Region not found: %', p_region_id;
  end if;

  if v_user_state <> 'active' then
    raise exception 'Initiator must be active to create LinkUp';
  end if;

  if v_profile_is_complete_invited then
    -- complete_invited hard filter: never relax
    raise exception 'Initiator with complete_invited profile cannot create LinkUp';
  end if;

  if coalesce(v_profile_complete, false) is false
    and coalesce(v_profile_state::text, '') <> 'complete_full' then
    raise exception 'Initiator profile must be complete before LinkUp creation';
  end if;

  if v_region_state <> 'open' then
    raise exception 'Region must be open before LinkUp broadcasting';
  end if;

  if v_can_initiate is false then
    raise exception 'Initiator not entitled to create LinkUps';
  end if;

  if v_has_active_hold then
    raise exception 'Initiator blocked by active safety hold';
  end if;

  v_min_size := greatest(
    2,
    least(
      10,
      coalesce((p_brief -> 'group_size' ->> 'min')::int, 2)
    )
  );

  v_max_size := least(
    10,
    coalesce((p_brief -> 'group_size' ->> 'max')::int, 6)
  );

  if v_max_size <= v_min_size then
    v_max_size := least(10, v_min_size + 1);
  end if;

  insert into public.linkups (
    initiator_user_id,
    region_id,
    state,
    brief,
    min_size,
    max_size,
    lock_version,
    linkup_create_key,
    broadcast_started_at,
    acceptance_window_ends_at,
    waves_sent,
    max_waves,
    wave_sizes
  )
  values (
    p_initiator_user_id,
    p_region_id,
    'broadcasting',
    p_brief,
    v_min_size,
    v_max_size,
    0,
    trim(p_linkup_create_key),
    p_now,
    p_now + interval '24 hours',
    0,
    greatest(1, coalesce(p_max_waves, 3)),
    coalesce(p_wave_sizes, array[6, 6, 8]::int[])
  )
  on conflict (linkup_create_key) do nothing
  returning id into v_linkup_id;

  if v_linkup_id is null then
    select id, state
    into v_linkup_id, v_existing_state
    from public.linkups
    where linkup_create_key = trim(p_linkup_create_key)
    limit 1;

    if v_linkup_id is null then
      raise exception 'Failed to resolve linkup by create key';
    end if;

    return jsonb_build_object(
      'status', 'existing_linkup',
      'linkup_id', v_linkup_id,
      'state', v_existing_state,
      'created_new', false,
      'idempotent_replay', true
    );
  end if;

  v_created_new := true;

  if v_has_match_seed then
    insert into public.linkup_candidate_seeds (
      linkup_id,
      candidate_user_id,
      source_match_run_id,
      seed_source,
      rank_score,
      rank_position,
      is_eligible
    )
    select
      v_linkup_id,
      mc.candidate_user_id,
      p_seed_match_run_id,
      'match_run',
      mc.total_score,
      row_number() over (order by mc.total_score desc, mc.candidate_user_id),
      true
    from public.match_candidates mc
    where mc.match_run_id = p_seed_match_run_id
      and mc.source_user_id = p_initiator_user_id
      and mc.candidate_user_id <> p_initiator_user_id
      and not exists (
        -- complete_invited hard filter: never relax
        select 1
        from public.profiles p_candidate
        where p_candidate.user_id = mc.candidate_user_id
          and p_candidate.state = 'complete_invited'
      )
    on conflict (linkup_id, candidate_user_id) do nothing;
  end if;

  if v_has_seed_users then
    insert into public.linkup_candidate_seeds (
      linkup_id,
      candidate_user_id,
      source_match_run_id,
      seed_source,
      rank_score,
      rank_position,
      is_eligible
    )
    select
      v_linkup_id,
      seeded.user_id,
      null,
      'eligible_seed',
      seeded.rank_score,
      seeded.rank_position,
      true
    from (
      select
        u.user_id,
        u.ordinality::int as rank_position,
        case
          when p_seed_scores is not null and array_length(p_seed_scores, 1) >= u.ordinality then p_seed_scores[u.ordinality]
          else null::double precision
        end as rank_score
      from unnest(p_seed_user_ids) with ordinality as u(user_id, ordinality)
      where u.user_id is not null
        and u.user_id <> p_initiator_user_id
    ) as seeded
    where not exists (
      -- complete_invited hard filter: never relax
      select 1
      from public.profiles p_seed_profile
      where p_seed_profile.user_id = seeded.user_id
        and p_seed_profile.state = 'complete_invited'
    )
    on conflict (linkup_id, candidate_user_id) do nothing;
  end if;

  v_wave_result := public.linkup_send_next_wave(
    v_linkup_id,
    format('linkup:start_wave_1:%s', v_linkup_id::text),
    p_now
  );

  insert into public.linkup_events (
    linkup_id,
    event_type,
    from_state,
    to_state,
    idempotency_key,
    payload
  )
  values (
    v_linkup_id,
    'broadcast_started',
    'draft',
    'broadcasting',
    format('linkup:broadcast_started:%s', v_linkup_id::text),
    jsonb_build_object(
      'created_new', v_created_new,
      'wave_result', v_wave_result
    )
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'status', 'created',
    'linkup_id', v_linkup_id,
    'created_new', v_created_new,
    'wave_result', v_wave_result
  );
end;
$$;
