-- Contact exchange canonical pair ordering

update public.contact_exchanges
set
  user_a_id = least(user_a_id, user_b_id),
  user_b_id = greatest(user_a_id, user_b_id)
where user_a_id > user_b_id;

alter table public.contact_exchanges
  drop constraint if exists contact_exchanges_canonical_pair_chk;

alter table public.contact_exchanges
  add constraint contact_exchanges_canonical_pair_chk
  check (user_a_id < user_b_id);

-- Stripe events ingestion

create table if not exists public.stripe_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  event_type text not null,
  event_created_at timestamptz not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  constraint stripe_events_event_id_uniq unique (event_id)
);

create index if not exists stripe_events_type_idx on public.stripe_events(event_type);
create index if not exists stripe_events_event_created_idx on public.stripe_events(event_created_at);
create index if not exists stripe_events_received_idx on public.stripe_events(received_at);

-- Entitlements snapshot

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  can_receive_intro boolean not null default false,
  can_initiate_linkup boolean not null default false,
  can_participate_linkup boolean not null default false,
  intro_credits_remaining int not null default 0,
  linkup_credits_remaining int not null default 0,
  source public.entitlement_source not null default 'stripe',
  computed_at timestamptz not null default now(),
  expires_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entitlements_user_uniq unique (user_id)
);

create index if not exists entitlements_user_idx on public.entitlements(user_id);
create index if not exists entitlements_computed_idx on public.entitlements(computed_at);

-- Entitlement ledger

create table if not exists public.entitlement_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  entry_type text not null,
  reason text,
  source text,
  quantity int,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint entitlement_ledger_idem_uniq unique (idempotency_key)
);

create index if not exists entitlement_ledger_user_idx on public.entitlement_ledger(user_id, occurred_at desc);

-- Entitlement overrides (admin)

create table if not exists public.entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  override_type text not null,
  values jsonb not null default '{}'::jsonb,
  effective_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by_admin_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists entitlement_overrides_user_idx on public.entitlement_overrides(user_id, effective_at desc);

-- updated_at triggers

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'entitlements_set_updated_at') then
    create trigger entitlements_set_updated_at
    before update on public.entitlements
    for each row execute function public.set_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'entitlement_overrides_set_updated_at') then
    create trigger entitlement_overrides_set_updated_at
    before update on public.entitlement_overrides
    for each row execute function public.set_updated_at();
  end if;
end $$;
