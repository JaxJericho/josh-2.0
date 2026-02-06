-- Profiles + profile events

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  state public.profile_state not null default 'empty',
  fingerprint jsonb not null default '{}'::jsonb,
  activity_patterns jsonb not null default '[]'::jsonb,
  boundaries jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  active_intent jsonb,
  last_interview_step text,
  completed_at timestamptz,
  stale_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_user_uniq unique (user_id)
);

create table if not exists public.profile_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  event_type text not null,
  source text not null,
  step_id text,
  payload jsonb not null,
  idempotency_key text not null,
  correlation_id uuid,
  created_at timestamptz not null default now(),
  constraint profile_events_idem_uniq unique (idempotency_key)
);

create index if not exists profiles_state_idx on public.profiles(state);
create index if not exists profiles_user_idx on public.profiles(user_id);
create index if not exists profiles_last_interview_step_idx on public.profiles(last_interview_step);

create index if not exists profile_events_profile_idx on public.profile_events(profile_id, created_at desc);
create index if not exists profile_events_user_idx on public.profile_events(user_id);
create index if not exists profile_events_type_idx on public.profile_events(event_type);

-- updated_at triggers

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'profiles_set_updated_at') then
    create trigger profiles_set_updated_at
    before update on public.profiles
    for each row execute function public.set_updated_at();
  end if;
end $$;
