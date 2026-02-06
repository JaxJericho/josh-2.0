-- LinkUps + invites + participants + outcomes

create table if not exists public.linkups (
  id uuid primary key default gen_random_uuid(),
  initiator_user_id uuid references public.users(id) on delete restrict,
  region_id uuid not null references public.regions(id) on delete restrict,
  state public.linkup_state not null default 'draft',
  brief jsonb not null,
  acceptance_window_ends_at timestamptz,
  event_time timestamptz,
  venue jsonb,
  min_size int not null default 2,
  max_size int not null default 6,
  lock_version int not null default 0,
  locked_at timestamptz,
  canceled_reason text,
  correlation_id uuid,
  linkup_create_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkups_create_key_uniq unique (linkup_create_key)
);

create table if not exists public.linkup_invites (
  id uuid primary key default gen_random_uuid(),
  linkup_id uuid not null references public.linkups(id) on delete restrict,
  invited_user_id uuid not null references public.users(id) on delete restrict,
  state public.invite_state not null default 'pending',
  offered_options jsonb,
  selected_option text,
  sent_at timestamptz,
  responded_at timestamptz,
  expires_at timestamptz,
  closed_at timestamptz,
  response_message_sid text,
  idempotency_key text not null,
  explainability jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkup_invites_once unique (linkup_id, invited_user_id),
  constraint linkup_invites_idem_uniq unique (idempotency_key)
);

create table if not exists public.linkup_participants (
  id uuid primary key default gen_random_uuid(),
  linkup_id uuid not null references public.linkups(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  role text not null check (role in ('initiator','participant')),
  status text not null default 'confirmed' check (status in ('confirmed','canceled','no_show','attended')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkup_participants_once unique (linkup_id, user_id)
);

create table if not exists public.linkup_outcomes (
  id uuid primary key default gen_random_uuid(),
  linkup_id uuid not null references public.linkups(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  attendance_response text check (attendance_response in ('attended','no_show','unsure')),
  do_again boolean,
  feedback text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkup_outcomes_once unique (linkup_id, user_id)
);

create table if not exists public.linkup_events (
  id uuid primary key default gen_random_uuid(),
  linkup_id uuid not null references public.linkups(id) on delete restrict,
  event_type text not null,
  from_state text,
  to_state text,
  idempotency_key text,
  correlation_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint linkup_events_idem_uniq unique (idempotency_key)
);

create index if not exists linkups_region_state_idx on public.linkups(region_id, state);
create index if not exists linkups_initiator_idx on public.linkups(initiator_user_id);
create index if not exists linkups_window_idx on public.linkups(acceptance_window_ends_at);
create index if not exists linkups_created_idx on public.linkups(created_at);

create index if not exists linkup_invites_user_state_idx on public.linkup_invites(invited_user_id, state);
create index if not exists linkup_invites_linkup_idx on public.linkup_invites(linkup_id);
create index if not exists linkup_invites_created_idx on public.linkup_invites(created_at);

create index if not exists linkup_participants_linkup_idx on public.linkup_participants(linkup_id);
create index if not exists linkup_participants_user_idx on public.linkup_participants(user_id);

create index if not exists linkup_outcomes_linkup_idx on public.linkup_outcomes(linkup_id);

create index if not exists linkup_events_linkup_idx on public.linkup_events(linkup_id, created_at desc);

-- updated_at triggers

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'linkups_set_updated_at') then
    create trigger linkups_set_updated_at
    before update on public.linkups
    for each row execute function public.set_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'linkup_invites_set_updated_at') then
    create trigger linkup_invites_set_updated_at
    before update on public.linkup_invites
    for each row execute function public.set_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'linkup_participants_set_updated_at') then
    create trigger linkup_participants_set_updated_at
    before update on public.linkup_participants
    for each row execute function public.set_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'linkup_outcomes_set_updated_at') then
    create trigger linkup_outcomes_set_updated_at
    before update on public.linkup_outcomes
    for each row execute function public.set_updated_at();
  end if;
end $$;
