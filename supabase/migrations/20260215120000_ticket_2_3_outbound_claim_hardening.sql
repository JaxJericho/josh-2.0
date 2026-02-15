-- Ticket 2.3: tighten outbound claim semantics and pending selection index

create or replace function public.claim_sms_outbound_jobs(
  max_jobs int,
  lease_seconds int default 60,
  now_ts timestamptz default now()
)
returns setof public.sms_outbound_jobs
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if max_jobs is null or max_jobs < 1 then
    return;
  end if;

  -- Requeue lease-expired claims so selection still operates on pending jobs only.
  update public.sms_outbound_jobs
  set
    status = 'pending',
    next_attempt_at = null,
    updated_at = now_ts
  where status = 'sending'
    and next_attempt_at is not null
    and next_attempt_at <= now_ts;

  return query
  with due_jobs as (
    select id
    from public.sms_outbound_jobs
    where status = 'pending'
      and coalesce(run_at, created_at) <= now_ts
      and (next_attempt_at is null or next_attempt_at <= now_ts)
    order by coalesce(run_at, created_at), created_at, id
    for update skip locked
    limit max_jobs
  )
  update public.sms_outbound_jobs as jobs
  set
    status = 'sending',
    updated_at = now_ts,
    next_attempt_at = now_ts + make_interval(secs => lease_seconds)
  from due_jobs
  where jobs.id = due_jobs.id
  returning jobs.*;
end;
$$;

create index if not exists sms_outbound_jobs_pending_claim_idx
  on public.sms_outbound_jobs(status, run_at, next_attempt_at, created_at)
  where status = 'pending';
