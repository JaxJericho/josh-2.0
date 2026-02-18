-- Ticket 7.2: LinkUp orchestration state machine (waves, lock, reply idempotency)

-- 1) Canonical LinkUp/invite metadata needed for wave orchestration.
alter table public.linkups
  add column if not exists broadcast_started_at timestamptz,
  add column if not exists waves_sent int not null default 0,
  add column if not exists max_waves int not null default 3,
  add column if not exists wave_sizes int[] not null default array[6, 6, 8]::int[];

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'linkups_waves_sent_nonnegative_chk'
      and conrelid = 'public.linkups'::regclass
  ) then
    alter table public.linkups
      add constraint linkups_waves_sent_nonnegative_chk
      check (waves_sent >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'linkups_max_waves_positive_chk'
      and conrelid = 'public.linkups'::regclass
  ) then
    alter table public.linkups
      add constraint linkups_max_waves_positive_chk
      check (max_waves >= 1);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'linkups_wave_sizes_nonempty_chk'
      and conrelid = 'public.linkups'::regclass
  ) then
    alter table public.linkups
      add constraint linkups_wave_sizes_nonempty_chk
      check (coalesce(array_length(wave_sizes, 1), 0) >= 1);
  end if;
end $$;

-- Add status alias to satisfy status-style indexing without changing canonical state column.
alter table public.linkups
  add column if not exists status public.linkup_state generated always as (state) stored;

create index if not exists linkups_region_status_idx
  on public.linkups(region_id, status);

alter table public.linkup_invites
  add column if not exists wave_no int not null default 1,
  add column if not exists terminal_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'linkup_invites_wave_no_positive_chk'
      and conrelid = 'public.linkup_invites'::regclass
  ) then
    alter table public.linkup_invites
      add constraint linkup_invites_wave_no_positive_chk
      check (wave_no >= 1);
  end if;
end $$;

create index if not exists linkup_invites_linkup_wave_state_idx
  on public.linkup_invites(linkup_id, wave_no, state);

-- Ensure per-spec uniqueness for response message correlation.
create unique index if not exists linkup_invites_response_message_sid_uniq
  on public.linkup_invites(response_message_sid)
  where response_message_sid is not null;

-- 2) Seed pool used for deterministic invite waves (from match runs or explicit seed sets).
create table if not exists public.linkup_candidate_seeds (
  id uuid primary key default gen_random_uuid(),
  linkup_id uuid not null references public.linkups(id) on delete cascade,
  candidate_user_id uuid not null references public.users(id) on delete cascade,
  source_match_run_id uuid references public.match_runs(id) on delete set null,
  seed_source text not null,
  rank_score double precision,
  rank_position int,
  is_eligible boolean not null default true,
  ineligible_reason text,
  invited_wave int,
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkup_candidate_seeds_once unique (linkup_id, candidate_user_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'linkup_candidate_seeds_seed_source_chk'
      and conrelid = 'public.linkup_candidate_seeds'::regclass
  ) then
    alter table public.linkup_candidate_seeds
      add constraint linkup_candidate_seeds_seed_source_chk
      check (seed_source in ('match_run', 'eligible_seed'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'linkup_candidate_seeds_rank_position_positive_chk'
      and conrelid = 'public.linkup_candidate_seeds'::regclass
  ) then
    alter table public.linkup_candidate_seeds
      add constraint linkup_candidate_seeds_rank_position_positive_chk
      check (rank_position is null or rank_position >= 1);
  end if;
end $$;

create index if not exists linkup_candidate_seeds_linkup_rank_idx
  on public.linkup_candidate_seeds(linkup_id, rank_position, rank_score desc);

create index if not exists linkup_candidate_seeds_linkup_invited_idx
  on public.linkup_candidate_seeds(linkup_id, invited_wave, invited_at);

-- 3) Reply-event log for invite response idempotency and replay traceability.
create table if not exists public.linkup_invite_reply_events (
  id uuid primary key default gen_random_uuid(),
  linkup_id uuid not null references public.linkups(id) on delete cascade,
  invite_id uuid not null references public.linkup_invites(id) on delete cascade,
  invited_user_id uuid not null references public.users(id) on delete cascade,
  inbound_message_id uuid not null references public.sms_messages(id) on delete restrict,
  inbound_message_sid text not null,
  parsed_reply text not null,
  applied boolean not null default false,
  outcome text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint linkup_invite_reply_events_invite_sid_uniq unique (invite_id, inbound_message_sid),
  constraint linkup_invite_reply_events_inbound_message_uniq unique (inbound_message_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'linkup_invite_reply_events_parsed_reply_chk'
      and conrelid = 'public.linkup_invite_reply_events'::regclass
  ) then
    alter table public.linkup_invite_reply_events
      add constraint linkup_invite_reply_events_parsed_reply_chk
      check (parsed_reply in ('accept', 'decline', 'unclear'));
  end if;
end $$;

create unique index if not exists linkup_invite_reply_events_inbound_sid_uniq
  on public.linkup_invite_reply_events(inbound_message_sid);

create index if not exists linkup_invite_reply_events_linkup_created_idx
  on public.linkup_invite_reply_events(linkup_id, created_at desc);

create index if not exists linkup_invite_reply_events_invited_user_idx
  on public.linkup_invite_reply_events(invited_user_id, created_at desc);

-- 4) updated_at triggers.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'linkup_candidate_seeds_set_updated_at') then
    create trigger linkup_candidate_seeds_set_updated_at
    before update on public.linkup_candidate_seeds
    for each row execute function public.set_updated_at();
  end if;
end $$;

-- 5) RLS posture: service-role writes only, read only to admin users.
alter table public.linkup_candidate_seeds enable row level security;
alter table public.linkup_invite_reply_events enable row level security;

drop policy if exists svc_select on public.linkup_candidate_seeds;
drop policy if exists svc_insert on public.linkup_candidate_seeds;
drop policy if exists svc_update on public.linkup_candidate_seeds;
drop policy if exists svc_delete on public.linkup_candidate_seeds;
drop policy if exists admin_select on public.linkup_candidate_seeds;
create policy svc_select on public.linkup_candidate_seeds for select to service_role using (true);
create policy svc_insert on public.linkup_candidate_seeds for insert to service_role with check (true);
create policy svc_update on public.linkup_candidate_seeds for update to service_role using (true) with check (true);
create policy svc_delete on public.linkup_candidate_seeds for delete to service_role using (true);
create policy admin_select on public.linkup_candidate_seeds for select to authenticated using (public.is_admin_user());

drop policy if exists svc_select on public.linkup_invite_reply_events;
drop policy if exists svc_insert on public.linkup_invite_reply_events;
drop policy if exists svc_update on public.linkup_invite_reply_events;
drop policy if exists svc_delete on public.linkup_invite_reply_events;
drop policy if exists admin_select on public.linkup_invite_reply_events;
create policy svc_select on public.linkup_invite_reply_events for select to service_role using (true);
create policy svc_insert on public.linkup_invite_reply_events for insert to service_role with check (true);
create policy svc_update on public.linkup_invite_reply_events for update to service_role using (true) with check (true);
create policy svc_delete on public.linkup_invite_reply_events for delete to service_role using (true);
create policy admin_select on public.linkup_invite_reply_events for select to authenticated using (public.is_admin_user());

-- 6) Helper parsers and orchestration primitives.
create or replace function public.parse_linkup_invite_reply_token(raw_text text)
returns text
language sql
immutable
as $$
  select case
    when raw_text is null then 'unclear'
    when lower(trim(raw_text)) in ('yes', 'y', 'accept', 'accepted', 'in', 'ok', 'sure') then 'accept'
    when lower(trim(raw_text)) in ('no', 'n', 'decline', 'declined', 'nah', 'pass', 'cant', 'can''t') then 'decline'
    else 'unclear'
  end;
$$;

create or replace function public.resolve_linkup_wave_size(
  wave_sizes int[],
  wave_no int,
  fallback_size int default 6
)
returns int
language sql
immutable
as $$
  select greatest(
    1,
    coalesce(
      wave_sizes[wave_no],
      wave_sizes[array_length(wave_sizes, 1)],
      fallback_size
    )
  );
$$;

create or replace function public.linkup_maybe_expire(
  p_linkup_id uuid,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linkup public.linkups%rowtype;
  v_accepted_count int := 0;
begin
  select *
  into v_linkup
  from public.linkups
  where id = p_linkup_id
  for update;

  if not found then
    return false;
  end if;

  if v_linkup.state <> 'broadcasting' then
    return false;
  end if;

  if v_linkup.acceptance_window_ends_at is null or p_now < v_linkup.acceptance_window_ends_at then
    return false;
  end if;

  select count(*)::int
  into v_accepted_count
  from public.linkup_invites
  where linkup_id = p_linkup_id
    and state = 'accepted';

  if v_accepted_count + 1 >= v_linkup.min_size then
    return false;
  end if;

  update public.linkups
  set
    state = 'expired',
    updated_at = p_now
  where id = p_linkup_id
    and state = 'broadcasting';

  if not found then
    return false;
  end if;

  update public.linkup_invites
  set
    state = 'expired',
    closed_at = coalesce(closed_at, p_now),
    terminal_reason = coalesce(terminal_reason, 'acceptance_window_elapsed')
  where linkup_id = p_linkup_id
    and state = 'pending';

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
    'expired',
    'broadcasting',
    'expired',
    format('linkup:expired:%s', p_linkup_id::text),
    jsonb_build_object(
      'expired_at', p_now,
      'reason', 'acceptance_window_elapsed'
    )
  )
  on conflict (idempotency_key) do nothing;

  return true;
end;
$$;

create or replace function public.linkup_attempt_lock(
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
  v_accepted_count int := 0;
  v_selected_invite_ids uuid[];
  v_selected_count int := 0;
  v_lock_key text;
  v_locked_at timestamptz;
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

  if v_linkup.state = 'locked' then
    return jsonb_build_object(
      'status', 'already_locked',
      'linkup_id', p_linkup_id,
      'locked_at', v_linkup.locked_at
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

  select count(*)::int
  into v_accepted_count
  from public.linkup_invites
  where linkup_id = p_linkup_id
    and state = 'accepted';

  if v_accepted_count + 1 < v_linkup.min_size then
    return jsonb_build_object(
      'status', 'not_ready',
      'linkup_id', p_linkup_id,
      'accepted_count', v_accepted_count,
      'min_required', greatest(v_linkup.min_size - 1, 1)
    );
  end if;

  select coalesce(array_agg(src.id), array[]::uuid[])
  into v_selected_invite_ids
  from (
    select li.id
    from public.linkup_invites li
    where li.linkup_id = p_linkup_id
      and li.state = 'accepted'
    order by coalesce(li.responded_at, li.created_at), li.id
    limit greatest(v_linkup.max_size - 1, 0)
  ) as src;

  v_selected_count := coalesce(array_length(v_selected_invite_ids, 1), 0);

  update public.linkups
  set
    state = 'locked',
    locked_at = coalesce(locked_at, p_now),
    lock_version = lock_version + 1,
    updated_at = p_now
  where id = p_linkup_id
    and state = 'broadcasting'
  returning locked_at into v_locked_at;

  if not found then
    return jsonb_build_object(
      'status', 'already_locked',
      'linkup_id', p_linkup_id
    );
  end if;

  insert into public.linkup_members (
    linkup_id,
    user_id,
    role,
    status,
    joined_at
  )
  values (
    p_linkup_id,
    v_linkup.initiator_user_id,
    'initiator',
    'confirmed',
    p_now
  )
  on conflict (linkup_id, user_id) do update
    set
      role = excluded.role,
      status = excluded.status,
      joined_at = least(public.linkup_members.joined_at, excluded.joined_at),
      updated_at = p_now;

  insert into public.linkup_members (
    linkup_id,
    user_id,
    role,
    status,
    joined_at
  )
  select
    p_linkup_id,
    li.invited_user_id,
    'participant',
    'confirmed',
    p_now
  from public.linkup_invites li
  where li.id = any(v_selected_invite_ids)
  on conflict (linkup_id, user_id) do update
    set
      role = excluded.role,
      status = excluded.status,
      joined_at = least(public.linkup_members.joined_at, excluded.joined_at),
      updated_at = p_now;

  -- Keep selected accepted invites as accepted; close all remaining actionable invites.
  update public.linkup_invites
  set
    state = 'closed',
    closed_at = coalesce(closed_at, p_now),
    terminal_reason = coalesce(terminal_reason, 'linkup_locked'),
    updated_at = p_now
  where linkup_id = p_linkup_id
    and state in ('pending', 'declined', 'expired', 'accepted')
    and not (id = any(v_selected_invite_ids));

  v_lock_key := coalesce(p_idempotency_key, format('linkup:lock:%s', p_linkup_id::text));

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
    'locked',
    'broadcasting',
    'locked',
    v_lock_key,
    jsonb_build_object(
      'accepted_count', v_accepted_count,
      'selected_count', v_selected_count,
      'locked_at', v_locked_at
    )
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'status', 'locked',
    'linkup_id', p_linkup_id,
    'accepted_count', v_accepted_count,
    'selected_count', v_selected_count,
    'locked_at', v_locked_at
  );
end;
$$;

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

create or replace function public.linkup_apply_invite_reply(
  p_user_id uuid,
  p_linkup_id uuid,
  p_inbound_message_id uuid,
  p_inbound_message_sid text,
  p_message_text text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.linkup_invites%rowtype;
  v_linkup public.linkups%rowtype;
  v_parsed_reply text;
  v_reply_event_id uuid;
  v_event_outcome text;
  v_event_applied boolean := false;
  v_wave_result jsonb := '{}'::jsonb;
  v_lock_result jsonb := '{}'::jsonb;
  v_capacity int;
  v_already_accepted_count int := 0;
begin
  if p_user_id is null then
    raise exception 'linkup_apply_invite_reply requires p_user_id';
  end if;

  if p_inbound_message_id is null then
    raise exception 'linkup_apply_invite_reply requires p_inbound_message_id';
  end if;

  if p_inbound_message_sid is null or length(trim(p_inbound_message_sid)) = 0 then
    raise exception 'linkup_apply_invite_reply requires p_inbound_message_sid';
  end if;

  v_parsed_reply := public.parse_linkup_invite_reply_token(p_message_text);

  select li.*
  into v_invite
  from public.linkup_invites li
  where li.invited_user_id = p_user_id
    and li.linkup_id = p_linkup_id
  order by
    case li.state
      when 'pending' then 0
      when 'accepted' then 1
      when 'declined' then 2
      when 'closed' then 3
      when 'expired' then 4
      else 5
    end,
    li.created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'status', 'no_active_invite',
      'parsed_reply', v_parsed_reply,
      'idempotent_replay', false
    );
  end if;

  select *
  into v_linkup
  from public.linkups
  where id = v_invite.linkup_id
  for update;

  if not found then
    return jsonb_build_object(
      'status', 'linkup_missing',
      'parsed_reply', v_parsed_reply,
      'invite_id', v_invite.id,
      'idempotent_replay', false
    );
  end if;

  insert into public.linkup_invite_reply_events (
    linkup_id,
    invite_id,
    invited_user_id,
    inbound_message_id,
    inbound_message_sid,
    parsed_reply,
    applied,
    outcome,
    details
  )
  values (
    v_invite.linkup_id,
    v_invite.id,
    p_user_id,
    p_inbound_message_id,
    trim(p_inbound_message_sid),
    v_parsed_reply,
    false,
    'received',
    jsonb_build_object('received_at', p_now)
  )
  on conflict (inbound_message_sid) do nothing
  returning id into v_reply_event_id;

  if v_reply_event_id is null then
    return jsonb_build_object(
      'status', 'duplicate_replay',
      'parsed_reply', v_parsed_reply,
      'invite_id', v_invite.id,
      'linkup_id', v_invite.linkup_id,
      'idempotent_replay', true
    );
  end if;

  if v_parsed_reply = 'unclear' then
    v_event_outcome := 'unclear_reply';

    update public.linkup_invite_reply_events
    set
      applied = false,
      outcome = v_event_outcome,
      details = details || jsonb_build_object('reason', 'clarification_required')
    where id = v_reply_event_id;

    return jsonb_build_object(
      'status', 'unclear_reply',
      'parsed_reply', v_parsed_reply,
      'invite_id', v_invite.id,
      'linkup_id', v_invite.linkup_id,
      'idempotent_replay', false
    );
  end if;

  if v_linkup.state = 'locked' or v_invite.state in ('closed', 'expired') then
    v_event_outcome := case
      when v_linkup.state = 'locked' then 'late_after_lock'
      when v_invite.state = 'expired' then 'invite_expired'
      else 'invite_closed'
    end;

    update public.linkup_invites
    set
      terminal_reason = coalesce(terminal_reason, v_event_outcome),
      updated_at = p_now
    where id = v_invite.id;

    update public.linkup_invite_reply_events
    set
      applied = false,
      outcome = v_event_outcome,
      details = details || jsonb_build_object('linkup_state', v_linkup.state, 'invite_state', v_invite.state)
    where id = v_reply_event_id;

    return jsonb_build_object(
      'status', v_event_outcome,
      'parsed_reply', v_parsed_reply,
      'invite_id', v_invite.id,
      'linkup_id', v_invite.linkup_id,
      'idempotent_replay', false
    );
  end if;

  if v_linkup.state <> 'broadcasting' then
    v_event_outcome := 'linkup_not_broadcasting';

    update public.linkup_invite_reply_events
    set
      applied = false,
      outcome = v_event_outcome,
      details = details || jsonb_build_object('linkup_state', v_linkup.state)
    where id = v_reply_event_id;

    return jsonb_build_object(
      'status', v_event_outcome,
      'parsed_reply', v_parsed_reply,
      'invite_id', v_invite.id,
      'linkup_id', v_invite.linkup_id,
      'idempotent_replay', false
    );
  end if;

  if v_linkup.acceptance_window_ends_at is not null and p_now >= v_linkup.acceptance_window_ends_at then
    perform public.linkup_maybe_expire(v_linkup.id, p_now);
    v_event_outcome := 'acceptance_window_elapsed';

    update public.linkup_invite_reply_events
    set
      applied = false,
      outcome = v_event_outcome,
      details = details || jsonb_build_object('window_end', v_linkup.acceptance_window_ends_at)
    where id = v_reply_event_id;

    return jsonb_build_object(
      'status', 'expired',
      'parsed_reply', v_parsed_reply,
      'invite_id', v_invite.id,
      'linkup_id', v_invite.linkup_id,
      'idempotent_replay', false
    );
  end if;

  if v_parsed_reply = 'decline' then
    if v_invite.state = 'pending' then
      update public.linkup_invites
      set
        state = 'declined',
        responded_at = coalesce(responded_at, p_now),
        response_message_sid = coalesce(response_message_sid, trim(p_inbound_message_sid)),
        terminal_reason = null,
        updated_at = p_now
      where id = v_invite.id
        and state = 'pending';

      v_event_applied := found;
    end if;

    v_wave_result := public.linkup_send_next_wave(
      v_invite.linkup_id,
      format('linkup:wave_on_decline:%s:%s', v_invite.id::text, trim(p_inbound_message_sid)),
      p_now
    );

    v_event_outcome := case
      when v_event_applied then 'declined'
      else 'already_declined'
    end;

    update public.linkup_invite_reply_events
    set
      applied = v_event_applied,
      outcome = v_event_outcome,
      details = details || jsonb_build_object('wave_result', v_wave_result)
    where id = v_reply_event_id;

    return jsonb_build_object(
      'status', v_event_outcome,
      'parsed_reply', v_parsed_reply,
      'invite_id', v_invite.id,
      'linkup_id', v_invite.linkup_id,
      'wave_result', v_wave_result,
      'idempotent_replay', false
    );
  end if;

  -- Accept flow.
  v_capacity := greatest(v_linkup.max_size - 1, 1);

  select count(*)::int
  into v_already_accepted_count
  from public.linkup_invites li
  where li.linkup_id = v_invite.linkup_id
    and li.state = 'accepted'
    and li.id <> v_invite.id;

  if v_invite.state = 'pending' then
    if v_already_accepted_count >= v_capacity then
      update public.linkup_invites
      set
        state = 'closed',
        closed_at = coalesce(closed_at, p_now),
        terminal_reason = coalesce(terminal_reason, 'capacity_reached'),
        updated_at = p_now
      where id = v_invite.id;

      v_event_outcome := 'capacity_reached';
      v_event_applied := false;
    else
      update public.linkup_invites
      set
        state = 'accepted',
        responded_at = coalesce(responded_at, p_now),
        response_message_sid = coalesce(response_message_sid, trim(p_inbound_message_sid)),
        terminal_reason = null,
        updated_at = p_now
      where id = v_invite.id
        and state = 'pending';

      v_event_applied := found;

      v_lock_result := public.linkup_attempt_lock(
        v_invite.linkup_id,
        format('linkup:lock_on_accept:%s:%s', v_invite.id::text, trim(p_inbound_message_sid)),
        p_now
      );

      v_event_outcome := case
        when (v_lock_result ->> 'status') = 'locked' then 'accepted_and_locked'
        when v_event_applied then 'accepted'
        else 'already_accepted'
      end;
    end if;
  else
    v_lock_result := public.linkup_attempt_lock(
      v_invite.linkup_id,
      format('linkup:lock_on_existing_accept:%s:%s', v_invite.id::text, trim(p_inbound_message_sid)),
      p_now
    );

    v_event_outcome := case
      when (v_lock_result ->> 'status') = 'locked' then 'accepted_and_locked'
      else 'already_accepted'
    end;
    v_event_applied := false;
  end if;

  update public.linkup_invite_reply_events
  set
    applied = v_event_applied,
    outcome = v_event_outcome,
    details = details || jsonb_build_object('lock_result', v_lock_result)
  where id = v_reply_event_id;

  return jsonb_build_object(
    'status', v_event_outcome,
    'parsed_reply', v_parsed_reply,
    'invite_id', v_invite.id,
    'linkup_id', v_invite.linkup_id,
    'lock_result', v_lock_result,
    'idempotent_replay', false
  );
end;
$$;

create or replace function public.linkup_process_timeouts(
  p_linkup_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired_count int := 0;
  v_wave_result jsonb := '{}'::jsonb;
  v_expired_linkup boolean := false;
begin
  with expired as (
    update public.linkup_invites
    set
      state = 'expired',
      closed_at = coalesce(closed_at, p_now),
      terminal_reason = coalesce(terminal_reason, 'invite_timeout'),
      updated_at = p_now
    where linkup_id = p_linkup_id
      and state = 'pending'
      and expires_at is not null
      and expires_at <= p_now
    returning id
  )
  select count(*)::int
  into v_expired_count
  from expired;

  if v_expired_count > 0 then
    v_wave_result := public.linkup_send_next_wave(
      p_linkup_id,
      format('linkup:wave_on_timeout:%s:%s', p_linkup_id::text, extract(epoch from p_now)::bigint::text),
      p_now
    );
  end if;

  v_expired_linkup := public.linkup_maybe_expire(p_linkup_id, p_now);

  return jsonb_build_object(
    'status', 'ok',
    'linkup_id', p_linkup_id,
    'expired_invites', v_expired_count,
    'wave_result', v_wave_result,
    'linkup_expired', v_expired_linkup
  );
end;
$$;

-- Restrict orchestration execution to service role only.
revoke all on function public.linkup_maybe_expire(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.linkup_attempt_lock(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.linkup_send_next_wave(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.linkup_create_from_seed(
  uuid,
  uuid,
  jsonb,
  text,
  uuid[],
  double precision[],
  uuid,
  int,
  int[],
  timestamptz
) from public, anon, authenticated;
revoke all on function public.linkup_apply_invite_reply(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.linkup_process_timeouts(uuid, timestamptz) from public, anon, authenticated;

grant execute on function public.linkup_maybe_expire(uuid, timestamptz) to service_role;
grant execute on function public.linkup_attempt_lock(uuid, text, timestamptz) to service_role;
grant execute on function public.linkup_send_next_wave(uuid, text, timestamptz) to service_role;
grant execute on function public.linkup_create_from_seed(
  uuid,
  uuid,
  jsonb,
  text,
  uuid[],
  double precision[],
  uuid,
  int,
  int[],
  timestamptz
) to service_role;
grant execute on function public.linkup_apply_invite_reply(
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to service_role;
grant execute on function public.linkup_process_timeouts(uuid, timestamptz) to service_role;
