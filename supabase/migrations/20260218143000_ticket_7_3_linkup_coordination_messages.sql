-- Ticket 7.3: LinkUp coordination messages (lock-time intent + idempotent outbound enqueue)

do $$
declare
  missing_items text;
begin
  with required_items(name) as (
    values
      ('linkups'),
      ('linkup_members'),
      ('users'),
      ('sms_outbound_jobs'),
      ('sms_messages'),
      ('linkup_events')
  )
  select string_agg(r.name, ', ' order by r.name)
  into missing_items
  from required_items r
  left join pg_tables t
    on t.schemaname = 'public'
   and t.tablename = r.name
  where t.tablename is null;

  if missing_items is not null then
    raise exception 'ticket 7.3 aborted: missing required public tables: %', missing_items;
  end if;
end $$;

create table if not exists public.linkup_coordination_messages (
  id uuid primary key default gen_random_uuid(),
  linkup_id uuid not null references public.linkups(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  lock_version int not null,
  idempotency_key text not null,
  status text not null default 'pending',
  suppress_reason text,
  message_text text not null,
  sms_outbound_job_id uuid references public.sms_outbound_jobs(id) on delete set null,
  sms_message_id uuid references public.sms_messages(id) on delete set null,
  enqueued_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'linkup_coordination_messages_once_per_lock'
      and conrelid = 'public.linkup_coordination_messages'::regclass
  ) then
    alter table public.linkup_coordination_messages
      add constraint linkup_coordination_messages_once_per_lock
      unique (linkup_id, user_id, lock_version);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'linkup_coordination_messages_idempotency_uniq'
      and conrelid = 'public.linkup_coordination_messages'::regclass
  ) then
    alter table public.linkup_coordination_messages
      add constraint linkup_coordination_messages_idempotency_uniq
      unique (idempotency_key);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'linkup_coordination_messages_status_chk'
      and conrelid = 'public.linkup_coordination_messages'::regclass
  ) then
    alter table public.linkup_coordination_messages
      add constraint linkup_coordination_messages_status_chk
      check (status in ('pending', 'suppressed', 'enqueued', 'sent', 'failed'));
  end if;
end $$;

create index if not exists linkup_coordination_messages_linkup_status_idx
  on public.linkup_coordination_messages(linkup_id, status);

create index if not exists linkup_coordination_messages_user_idx
  on public.linkup_coordination_messages(user_id, created_at desc);

create index if not exists linkup_coordination_messages_job_idx
  on public.linkup_coordination_messages(sms_outbound_job_id);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'linkup_coordination_messages_set_updated_at') then
    create trigger linkup_coordination_messages_set_updated_at
    before update on public.linkup_coordination_messages
    for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.linkup_coordination_messages enable row level security;

drop policy if exists linkup_coordination_messages_service_select on public.linkup_coordination_messages;
drop policy if exists linkup_coordination_messages_service_insert on public.linkup_coordination_messages;
drop policy if exists linkup_coordination_messages_service_update on public.linkup_coordination_messages;
drop policy if exists linkup_coordination_messages_service_delete on public.linkup_coordination_messages;
drop policy if exists linkup_coordination_messages_admin_select on public.linkup_coordination_messages;

create policy linkup_coordination_messages_service_select
  on public.linkup_coordination_messages
  for select
  to service_role
  using (true);

create policy linkup_coordination_messages_service_insert
  on public.linkup_coordination_messages
  for insert
  to service_role
  with check (true);

create policy linkup_coordination_messages_service_update
  on public.linkup_coordination_messages
  for update
  to service_role
  using (true)
  with check (true);

create policy linkup_coordination_messages_service_delete
  on public.linkup_coordination_messages
  for delete
  to service_role
  using (true);

create policy linkup_coordination_messages_admin_select
  on public.linkup_coordination_messages
  for select
  to authenticated
  using (public.is_admin_user());

create or replace function public.build_linkup_coordination_message(
  p_activity_label text,
  p_time_label text,
  p_location_label text,
  p_member_count int
)
returns text
language sql
immutable
as $$
  select format(
    'Your %s LinkUp is locked with %s people. Time: %s. Area: %s. Next: check your dashboard for full details and arrival guidance. Reply HELP for support.',
    p_activity_label,
    greatest(1, coalesce(p_member_count, 1)),
    p_time_label,
    p_location_label
  );
$$;

create or replace function public.linkup_prepare_coordination_messages(
  p_linkup_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linkup public.linkups%rowtype;
  v_region_name text;
  v_member_count int := 0;
  v_activity_label text;
  v_time_label text;
  v_location_label text;
  v_message_text text;
  v_lock_version int;
  v_created_count int := 0;
  v_total_count int := 0;
  v_suppressed_count int := 0;
  v_pending_count int := 0;
begin
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

  if v_linkup.state <> 'locked' or v_linkup.locked_at is null then
    return jsonb_build_object(
      'status', 'not_locked',
      'linkup_id', p_linkup_id,
      'state', v_linkup.state
    );
  end if;

  v_lock_version := greatest(v_linkup.lock_version, 1);

  select count(*)::int
  into v_member_count
  from public.linkup_members m
  where m.linkup_id = p_linkup_id
    and m.status = 'confirmed';

  if v_member_count <= 0 then
    return jsonb_build_object(
      'status', 'no_members',
      'linkup_id', p_linkup_id,
      'lock_version', v_lock_version
    );
  end if;

  select coalesce(r.display_name, r.name)
  into v_region_name
  from public.regions r
  where r.id = v_linkup.region_id;

  v_activity_label := coalesce(
    nullif(trim(v_linkup.brief ->> 'activity_label'), ''),
    nullif(trim(v_linkup.brief ->> 'activity_key'), ''),
    'Activity'
  );

  v_time_label := coalesce(
    case
      when v_linkup.scheduled_at is not null then to_char(v_linkup.scheduled_at at time zone 'UTC', 'Dy Mon DD HH24:MI') || ' UTC'
      when v_linkup.event_time is not null then to_char(v_linkup.event_time at time zone 'UTC', 'Dy Mon DD HH24:MI') || ' UTC'
      else null
    end,
    nullif(replace(trim(v_linkup.brief ->> 'time_window'), '_', ' '), ''),
    'TBD'
  );

  v_location_label := coalesce(
    nullif(trim(v_linkup.venue ->> 'name'), ''),
    nullif(trim(v_linkup.brief ->> 'location_hint'), ''),
    nullif(trim(v_region_name), ''),
    'your area'
  );

  v_message_text := public.build_linkup_coordination_message(
    v_activity_label,
    v_time_label,
    v_location_label,
    v_member_count
  );

  with member_snapshot as (
    select
      m.user_id,
      u.phone_e164,
      coalesce(pe.can_participate, false) as can_participate,
      exists (
        select 1
        from public.safety_holds sh
        where sh.user_id = m.user_id
          and sh.status = 'active'
          and (sh.expires_at is null or sh.expires_at > p_now)
      ) as has_active_hold,
      exists (
        select 1
        from public.sms_opt_outs so
        where so.phone_e164 = u.phone_e164
      ) as is_opted_out,
      exists (
        select 1
        from public.linkup_members other
        join public.user_blocks ub
          on (
            (ub.blocker_user_id = m.user_id and ub.blocked_user_id = other.user_id)
            or
            (ub.blocker_user_id = other.user_id and ub.blocked_user_id = m.user_id)
          )
        where other.linkup_id = p_linkup_id
          and other.status = 'confirmed'
          and other.user_id <> m.user_id
      ) as has_member_block
    from public.linkup_members m
    join public.users u
      on u.id = m.user_id
    left join public.profiles p
      on p.user_id = m.user_id
    left join public.profile_entitlements pe
      on pe.profile_id = p.id
    where m.linkup_id = p_linkup_id
      and m.status = 'confirmed'
  ),
  upserted as (
    insert into public.linkup_coordination_messages (
      linkup_id,
      user_id,
      lock_version,
      idempotency_key,
      status,
      suppress_reason,
      message_text,
      created_at,
      updated_at
    )
    select
      p_linkup_id,
      ms.user_id,
      v_lock_version,
      format('linkup_coordination:%s:%s:lock_v%s', p_linkup_id::text, ms.user_id::text, v_lock_version::text),
      case
        when ms.is_opted_out then 'suppressed'
        when ms.has_active_hold then 'suppressed'
        when ms.has_member_block then 'suppressed'
        when coalesce(ms.phone_e164, '') = '' then 'suppressed'
        when ms.can_participate is false then 'suppressed'
        else 'pending'
      end,
      case
        when ms.is_opted_out then 'opted_out'
        when ms.has_active_hold then 'active_safety_hold'
        when ms.has_member_block then 'blocked_member'
        when coalesce(ms.phone_e164, '') = '' then 'missing_phone'
        when ms.can_participate is false then 'ineligible_participation'
        else null
      end,
      v_message_text,
      p_now,
      p_now
    from member_snapshot ms
    on conflict (linkup_id, user_id, lock_version) do update
      set
        idempotency_key = excluded.idempotency_key,
        message_text = excluded.message_text,
        status = case
          when public.linkup_coordination_messages.status in ('enqueued', 'sent', 'failed') then public.linkup_coordination_messages.status
          when excluded.status = 'suppressed' then 'suppressed'
          else 'pending'
        end,
        suppress_reason = case
          when public.linkup_coordination_messages.status in ('enqueued', 'sent', 'failed') then public.linkup_coordination_messages.suppress_reason
          when excluded.status = 'suppressed' then excluded.suppress_reason
          else null
        end,
        updated_at = p_now
    returning (xmax = 0) as inserted, status
  )
  select
    count(*) filter (where inserted)::int,
    count(*)::int,
    count(*) filter (where status = 'suppressed')::int,
    count(*) filter (where status = 'pending')::int
  into
    v_created_count,
    v_total_count,
    v_suppressed_count,
    v_pending_count
  from upserted;

  return jsonb_build_object(
    'status', 'prepared',
    'linkup_id', p_linkup_id,
    'lock_version', v_lock_version,
    'member_count', v_member_count,
    'created_count', v_created_count,
    'existing_count', greatest(v_total_count - v_created_count, 0),
    'pending_count', v_pending_count,
    'suppressed_count', v_suppressed_count
  );
end;
$$;

create or replace function public.linkup_enqueue_coordination_messages(
  p_linkup_id uuid,
  p_sms_encryption_key text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prepare jsonb;
  v_jobs_inserted int := 0;
  v_total_count int := 0;
  v_pending_count int := 0;
  v_enqueued_count int := 0;
  v_sent_count int := 0;
  v_failed_count int := 0;
  v_suppressed_count int := 0;
begin
  if p_sms_encryption_key is null or length(trim(p_sms_encryption_key)) = 0 then
    raise exception 'linkup_enqueue_coordination_messages requires non-empty p_sms_encryption_key';
  end if;

  v_prepare := public.linkup_prepare_coordination_messages(p_linkup_id, p_now);

  if coalesce(v_prepare ->> 'status', '') <> 'prepared' then
    return v_prepare || jsonb_build_object(
      'jobs_inserted_count', 0
    );
  end if;

  with pending_candidates as (
    select
      cm.id,
      cm.user_id,
      cm.idempotency_key,
      cm.message_text,
      u.phone_e164,
      l.correlation_id
    from public.linkup_coordination_messages cm
    join public.users u
      on u.id = cm.user_id
    join public.linkups l
      on l.id = cm.linkup_id
    where cm.linkup_id = p_linkup_id
      and cm.status = 'pending'
      and cm.sms_outbound_job_id is null
  ),
  inserted_jobs as (
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
      pc.user_id,
      pc.phone_e164,
      public.encrypt_sms_body(pc.message_text, p_sms_encryption_key),
      null,
      null,
      1,
      'linkup_coordination',
      'pending',
      p_now,
      format('coordination_sms:%s', pc.idempotency_key),
      pc.correlation_id
    from pending_candidates pc
    where coalesce(pc.phone_e164, '') <> ''
    on conflict (idempotency_key) do nothing
    returning id, idempotency_key
  )
  update public.linkup_coordination_messages cm
  set
    sms_outbound_job_id = ij.id,
    status = 'enqueued',
    enqueued_at = coalesce(cm.enqueued_at, p_now),
    last_error = null,
    updated_at = p_now
  from inserted_jobs ij
  where cm.linkup_id = p_linkup_id
    and format('coordination_sms:%s', cm.idempotency_key) = ij.idempotency_key;

  get diagnostics v_jobs_inserted = row_count;

  update public.linkup_coordination_messages cm
  set
    sms_outbound_job_id = coalesce(cm.sms_outbound_job_id, jobs.id),
    status = case
      when cm.status = 'suppressed' then 'suppressed'
      when jobs.status = 'sent' then 'sent'
      when jobs.status = 'failed' then 'failed'
      else 'enqueued'
    end,
    enqueued_at = case
      when cm.status = 'suppressed' then cm.enqueued_at
      else coalesce(cm.enqueued_at, jobs.created_at, p_now)
    end,
    sent_at = case
      when jobs.status = 'sent' then coalesce(cm.sent_at, jobs.last_status_at, p_now)
      else cm.sent_at
    end,
    failed_at = case
      when jobs.status = 'failed' then coalesce(cm.failed_at, jobs.last_status_at, p_now)
      else cm.failed_at
    end,
    last_error = case
      when jobs.status = 'failed' then jobs.last_error
      else cm.last_error
    end,
    updated_at = p_now
  from public.sms_outbound_jobs jobs
  where cm.linkup_id = p_linkup_id
    and cm.status <> 'suppressed'
    and format('coordination_sms:%s', cm.idempotency_key) = jobs.idempotency_key;

  update public.linkup_coordination_messages cm
  set
    sms_message_id = sm.id,
    updated_at = p_now
  from public.sms_outbound_jobs jobs
  join public.sms_messages sm
    on sm.twilio_message_sid = jobs.twilio_message_sid
   and sm.direction = 'out'
  where cm.linkup_id = p_linkup_id
    and cm.status in ('enqueued', 'sent', 'failed')
    and format('coordination_sms:%s', cm.idempotency_key) = jobs.idempotency_key
    and (cm.sms_message_id is null or cm.sms_message_id <> sm.id);

  select
    count(*)::int,
    count(*) filter (where status = 'pending')::int,
    count(*) filter (where status = 'enqueued')::int,
    count(*) filter (where status = 'sent')::int,
    count(*) filter (where status = 'failed')::int,
    count(*) filter (where status = 'suppressed')::int
  into
    v_total_count,
    v_pending_count,
    v_enqueued_count,
    v_sent_count,
    v_failed_count,
    v_suppressed_count
  from public.linkup_coordination_messages
  where linkup_id = p_linkup_id;

  return jsonb_build_object(
    'status', 'enqueued',
    'linkup_id', p_linkup_id,
    'prepared_created_count', coalesce((v_prepare ->> 'created_count')::int, 0),
    'prepared_existing_count', coalesce((v_prepare ->> 'existing_count')::int, 0),
    'jobs_inserted_count', v_jobs_inserted,
    'coordination_total_count', v_total_count,
    'coordination_pending_count', v_pending_count,
    'coordination_enqueued_count', v_enqueued_count,
    'coordination_sent_count', v_sent_count,
    'coordination_failed_count', v_failed_count,
    'coordination_suppressed_count', v_suppressed_count
  );
end;
$$;

create or replace function public.linkup_handle_locked_event_prepare_coordination()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.event_type = 'locked' then
    perform public.linkup_prepare_coordination_messages(
      new.linkup_id,
      coalesce(new.created_at, now())
    );
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'linkup_events_prepare_coordination_on_lock'
      and tgrelid = 'public.linkup_events'::regclass
  ) then
    create trigger linkup_events_prepare_coordination_on_lock
    after insert on public.linkup_events
    for each row execute function public.linkup_handle_locked_event_prepare_coordination();
  end if;
end $$;

create or replace function public.linkup_apply_invite_reply_with_coordination(
  p_user_id uuid,
  p_linkup_id uuid,
  p_inbound_message_id uuid,
  p_inbound_message_sid text,
  p_message_text text,
  p_sms_encryption_key text default null,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reply jsonb;
  v_locked boolean := false;
  v_prepare jsonb := jsonb_build_object('status', 'skipped_not_locked');
  v_enqueue jsonb := jsonb_build_object('status', 'skipped_not_locked');
begin
  v_reply := public.linkup_apply_invite_reply(
    p_user_id,
    p_linkup_id,
    p_inbound_message_id,
    p_inbound_message_sid,
    p_message_text,
    p_now
  );

  select exists (
    select 1
    from public.linkups
    where id = p_linkup_id
      and state = 'locked'
      and locked_at is not null
  )
  into v_locked;

  if v_locked then
    v_prepare := public.linkup_prepare_coordination_messages(p_linkup_id, p_now);

    if p_sms_encryption_key is not null and length(trim(p_sms_encryption_key)) > 0 then
      v_enqueue := public.linkup_enqueue_coordination_messages(
        p_linkup_id,
        p_sms_encryption_key,
        p_now
      );
    else
      v_enqueue := jsonb_build_object('status', 'skipped_missing_encryption_key');
    end if;
  end if;

  return v_reply || jsonb_build_object(
    'coordination_prepare', v_prepare,
    'coordination_enqueue', v_enqueue
  );
end;
$$;

revoke all on function public.build_linkup_coordination_message(text, text, text, int) from public, anon, authenticated;
revoke all on function public.linkup_prepare_coordination_messages(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.linkup_enqueue_coordination_messages(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.linkup_handle_locked_event_prepare_coordination() from public, anon, authenticated;
revoke all on function public.linkup_apply_invite_reply_with_coordination(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.build_linkup_coordination_message(text, text, text, int) to service_role;
grant execute on function public.linkup_prepare_coordination_messages(uuid, timestamptz) to service_role;
grant execute on function public.linkup_enqueue_coordination_messages(uuid, text, timestamptz) to service_role;
grant execute on function public.linkup_handle_locked_event_prepare_coordination() to service_role;
grant execute on function public.linkup_apply_invite_reply_with_coordination(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  timestamptz
) to service_role;
