-- Contact exchange tables

create table if not exists public.contact_exchange_choices (
  id uuid primary key default gen_random_uuid(),
  linkup_id uuid not null references public.linkups(id) on delete restrict,
  chooser_user_id uuid not null references public.users(id) on delete restrict,
  target_user_id uuid not null references public.users(id) on delete restrict,
  choice boolean not null,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_choice_once unique (linkup_id, chooser_user_id, target_user_id)
);

create table if not exists public.contact_exchanges (
  id uuid primary key default gen_random_uuid(),
  linkup_id uuid not null references public.linkups(id) on delete restrict,
  user_a_id uuid not null references public.users(id) on delete restrict,
  user_b_id uuid not null references public.users(id) on delete restrict,
  revealed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_exchange_pair_once unique (linkup_id, user_a_id, user_b_id)
);

create table if not exists public.contact_exchange_events (
  id uuid primary key default gen_random_uuid(),
  linkup_id uuid not null references public.linkups(id) on delete restrict,
  event_type text not null,
  idempotency_key text,
  correlation_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint contact_exchange_events_idem_uniq unique (idempotency_key)
);

create index if not exists contact_choices_chooser_idx
  on public.contact_exchange_choices(chooser_user_id);

create index if not exists contact_choices_linkup_idx
  on public.contact_exchange_choices(linkup_id);

create index if not exists contact_choices_created_idx
  on public.contact_exchange_choices(created_at);

create index if not exists contact_exchanges_linkup_idx
  on public.contact_exchanges(linkup_id);

create index if not exists contact_exchanges_user_a_idx
  on public.contact_exchanges(user_a_id);

create index if not exists contact_exchanges_user_b_idx
  on public.contact_exchanges(user_b_id);

create index if not exists contact_exchanges_created_idx
  on public.contact_exchanges(created_at);

create index if not exists contact_exchange_events_linkup_idx
  on public.contact_exchange_events(linkup_id, created_at desc);

-- updated_at triggers

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'contact_exchange_choices_set_updated_at') then
    create trigger contact_exchange_choices_set_updated_at
    before update on public.contact_exchange_choices
    for each row execute function public.set_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'contact_exchanges_set_updated_at') then
    create trigger contact_exchanges_set_updated_at
    before update on public.contact_exchanges
    for each row execute function public.set_updated_at();
  end if;
end $$;
