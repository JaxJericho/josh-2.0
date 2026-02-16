-- Ticket 4.3: deterministic normalized compatibility signal storage.

create table if not exists public.profile_compatibility_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  normalization_version text not null,
  interest_vector double precision[] not null,
  trait_vector double precision[] not null,
  intent_vector double precision[] not null,
  availability_vector double precision[] not null,
  metadata jsonb not null default '{}'::jsonb,
  source_profile_state public.profile_state not null,
  source_profile_completed_at timestamptz,
  source_profile_updated_at timestamptz not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_compatibility_signals_user_uniq unique (user_id),
  constraint profile_compatibility_signals_profile_uniq unique (profile_id),
  constraint profile_compatibility_signals_interest_len_chk
    check (coalesce(array_length(interest_vector, 1), 0) > 0),
  constraint profile_compatibility_signals_trait_len_chk
    check (coalesce(array_length(trait_vector, 1), 0) > 0),
  constraint profile_compatibility_signals_intent_len_chk
    check (coalesce(array_length(intent_vector, 1), 0) > 0),
  constraint profile_compatibility_signals_availability_len_chk
    check (coalesce(array_length(availability_vector, 1), 0) > 0)
);

create index if not exists profile_compatibility_signals_updated_idx
  on public.profile_compatibility_signals(updated_at desc);

create index if not exists profile_compatibility_signals_content_hash_idx
  on public.profile_compatibility_signals(content_hash);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'profile_compatibility_signals_set_updated_at') then
    create trigger profile_compatibility_signals_set_updated_at
    before update on public.profile_compatibility_signals
    for each row execute function public.set_updated_at();
  end if;
end $$;

create or replace view compat.profile_compatibility_signals as
select
  id,
  user_id,
  profile_id,
  normalization_version,
  interest_vector,
  trait_vector,
  intent_vector,
  availability_vector,
  metadata,
  source_profile_state,
  source_profile_completed_at,
  source_profile_updated_at,
  content_hash,
  created_at,
  updated_at
from public.profile_compatibility_signals;
