-- Ticket 8.6: interview wrap + dropout recovery

alter table public.conversation_sessions
  add column if not exists dropout_nudge_sent_at timestamptz;

create index if not exists conversation_sessions_dropout_scan_idx
  on public.conversation_sessions(mode, dropout_nudge_sent_at, updated_at);

create or replace function public.enqueue_interview_dropout_nudges(
  p_nudge_template text,
  p_sms_encryption_key text,
  p_now timestamptz default now(),
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 100), 500));
  v_candidates int := 0;
  v_marked int := 0;
  v_enqueued int := 0;
begin
  if p_nudge_template is null or length(trim(p_nudge_template)) = 0 then
    raise exception 'enqueue_interview_dropout_nudges requires non-empty p_nudge_template';
  end if;

  if position('{firstName}' in p_nudge_template) = 0 then
    raise exception 'enqueue_interview_dropout_nudges requires {firstName} placeholder';
  end if;

  if p_sms_encryption_key is null or length(trim(p_sms_encryption_key)) = 0 then
    raise exception 'enqueue_interview_dropout_nudges requires non-empty p_sms_encryption_key';
  end if;

  with eligible as (
    select
      cs.id as conversation_session_id,
      cs.user_id,
      u.phone_e164,
      btrim(u.first_name) as first_name
    from public.conversation_sessions cs
    join public.users u
      on u.id = cs.user_id
    join public.profiles p
      on p.user_id = cs.user_id
    left join public.sms_opt_outs so
      on so.phone_e164 = u.phone_e164
    where cs.mode = 'interviewing'::public.conversation_mode
      and cs.state_token like 'interview:%'
      and cs.dropout_nudge_sent_at is null
      and cs.updated_at <= (p_now - interval '24 hours')
      and p.is_complete_mvp = false
      and coalesce(p.state, 'partial') <> 'complete_full'
      and coalesce(u.sms_consent, true) = true
      and so.phone_e164 is null
      and length(coalesce(btrim(u.phone_e164), '')) > 0
      and length(coalesce(btrim(u.first_name), '')) > 0
    order by cs.updated_at asc
    limit v_limit
    for update of cs skip locked
  ),
  marked as (
    update public.conversation_sessions cs
    set dropout_nudge_sent_at = p_now
    from eligible e
    where cs.id = e.conversation_session_id
      and cs.dropout_nudge_sent_at is null
    returning
      cs.id as conversation_session_id,
      e.user_id,
      e.phone_e164,
      e.first_name,
      cs.dropout_nudge_sent_at
  ),
  inserted as (
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
      m.user_id,
      m.phone_e164,
      public.encrypt_sms_body(
        replace(p_nudge_template, '{firstName}', m.first_name),
        p_sms_encryption_key
      ),
      null,
      null,
      1,
      'interview_dropout_nudge',
      'pending'::public.job_state,
      p_now,
      format(
        'interview_dropout_nudge:%s:%s',
        m.conversation_session_id,
        to_char(
          m.dropout_nudge_sent_at at time zone 'UTC',
          'YYYYMMDDHH24MISSUS'
        )
      ),
      m.conversation_session_id
    from marked m
    on conflict (idempotency_key) do nothing
    returning id
  )
  select
    (select count(*)::int from eligible),
    (select count(*)::int from marked),
    (select count(*)::int from inserted)
  into v_candidates, v_marked, v_enqueued;

  return jsonb_build_object(
    'status', 'ok',
    'candidate_count', v_candidates,
    'marked_count', v_marked,
    'enqueued_count', v_enqueued
  );
end;
$$;
