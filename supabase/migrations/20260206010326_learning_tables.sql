-- Learning and adaptation tables

do $$
begin
  if not exists (select 1 from pg_type where typname = 'learning_signal_type') then
    create type public.learning_signal_type as enum (
      'linkup_attendance_attended',
      'linkup_attendance_no_show',
      'linkup_attendance_unsure',
      'linkup_do_again_yes',
      'linkup_do_again_no',
      'linkup_feedback_text',
      'contact_exchange_mutual_yes',
      'contact_exchange_declined',
      'match_preview_accepted',
      'match_preview_rejected',
      'match_preview_expired',
      'user_blocked_other',
      'user_reported_other'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'learning_job_status') then
    create type public.learning_job_status as enum (
      'started',
      'completed',
      'failed'
    );
  end if;
end $$;

create table if not exists public.learning_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  signal_type public.learning_signal_type not null,
  subject_id uuid,
  counterparty_user_id uuid references public.users(id) on delete restrict,
  value_num numeric,
  value_bool boolean,
  value_text text,
  meta jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  idempotency_key text not null
);

create table if not exists public.user_derived_state (
  user_id uuid primary key references public.users(id) on delete restrict,
  rel_score numeric not null default 0.5,
  activity_weight_overrides jsonb not null default '{}'::jsonb,
  time_window_overrides jsonb not null default '{}'::jsonb,
  novelty_tags jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  version int not null default 0
);

create table if not exists public.learning_jobs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null,
  status public.learning_job_status not null default 'started',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  params jsonb not null default '{}'::jsonb,
  error_detail text
);

create unique index if not exists learning_signals_idem_uniq
  on public.learning_signals(idempotency_key);

create unique index if not exists learning_jobs_run_key_uniq
  on public.learning_jobs(run_key);

create index if not exists learning_signals_user_idx
  on public.learning_signals(user_id, occurred_at desc);

create index if not exists learning_signals_type_idx
  on public.learning_signals(signal_type, occurred_at desc);

-- updated_at triggers

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'user_derived_state_set_updated_at') then
    create trigger user_derived_state_set_updated_at
    before update on public.user_derived_state
    for each row execute function public.set_updated_at();
  end if;
end $$;
