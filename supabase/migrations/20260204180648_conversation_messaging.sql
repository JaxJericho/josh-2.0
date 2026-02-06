-- Conversation + messaging persistence (SMS)

create table if not exists public.conversation_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  mode public.conversation_mode not null default 'idle',
  state_token text not null default 'idle',
  expires_at timestamptz,
  last_inbound_message_sid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_one_per_user unique (user_id)
);

create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  direction text not null check (direction in ('in','out')),
  from_e164 text not null,
  to_e164 text not null,
  twilio_message_sid text,
  body_ciphertext bytea,
  body_iv bytea,
  body_tag bytea,
  key_version int not null default 1,
  media_count int not null default 0,
  status text,
  last_status_at timestamptz,
  correlation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sms_messages_twilio_sid_uniq
  on public.sms_messages(twilio_message_sid)
  where twilio_message_sid is not null;

create table if not exists public.sms_outbound_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  to_e164 text not null,
  body_ciphertext bytea,
  body_iv bytea,
  body_tag bytea,
  key_version int not null default 1,
  purpose text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  twilio_message_sid text,
  attempts int not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  correlation_id uuid,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_outbound_idem_uniq unique (idempotency_key)
);

create index if not exists conversation_sessions_mode_idx
  on public.conversation_sessions(mode);

create index if not exists sms_messages_user_idx
  on public.sms_messages(user_id);

create index if not exists sms_messages_created_idx
  on public.sms_messages(created_at);

create index if not exists sms_messages_status_idx
  on public.sms_messages(status);

create index if not exists sms_messages_last_status_idx
  on public.sms_messages(last_status_at);

create index if not exists sms_outbound_jobs_status_idx
  on public.sms_outbound_jobs(status);

create index if not exists sms_outbound_jobs_next_attempt_idx
  on public.sms_outbound_jobs(next_attempt_at);

create index if not exists sms_outbound_jobs_user_idx
  on public.sms_outbound_jobs(user_id);

create index if not exists sms_outbound_jobs_created_idx
  on public.sms_outbound_jobs(created_at);

-- updated_at triggers

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'conversation_sessions_set_updated_at') then
    create trigger conversation_sessions_set_updated_at
    before update on public.conversation_sessions
    for each row execute function public.set_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'sms_messages_set_updated_at') then
    create trigger sms_messages_set_updated_at
    before update on public.sms_messages
    for each row execute function public.set_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'sms_outbound_jobs_set_updated_at') then
    create trigger sms_outbound_jobs_set_updated_at
    before update on public.sms_outbound_jobs
    for each row execute function public.set_updated_at();
  end if;
end $$;
