-- Outbound SMS helpers: decrypt + claim jobs

create or replace function public.decrypt_sms_body(ciphertext bytea, key text)
returns text
language sql
stable
as $$
  select extensions.pgp_sym_decrypt(ciphertext, key)::text;
$$;

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
  return query
  with cte as (
    select id
    from public.sms_outbound_jobs
    where status in ('pending','sending')
      and (next_attempt_at is null or next_attempt_at <= now_ts)
    order by created_at
    for update skip locked
    limit max_jobs
  )
  update public.sms_outbound_jobs as jobs
  set
    status = 'sending',
    updated_at = now_ts,
    next_attempt_at = now_ts + (lease_seconds || ' seconds')::interval
  from cte
  where jobs.id = cte.id
  returning jobs.*;
end;
$$;

alter table public.sms_outbound_jobs
  add column if not exists from_e164 text,
  add column if not exists last_status_at timestamptz;

alter table public.sms_outbound_jobs
  drop constraint if exists sms_outbound_jobs_status_check;

alter table public.sms_outbound_jobs
  add constraint sms_outbound_jobs_status_check
  check (status in ('pending','sending','sent','failed','canceled'));

create index if not exists sms_outbound_jobs_status_next_attempt_idx
  on public.sms_outbound_jobs(status, next_attempt_at);
