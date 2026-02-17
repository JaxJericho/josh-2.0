create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions
  add column if not exists user_id text,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists status text,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'subscriptions_stripe_subscription_id_uniq'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_stripe_subscription_id_uniq unique (stripe_subscription_id);
  end if;
end $$;

alter table public.subscriptions
  alter column status set default 'unknown';

update public.subscriptions
set status = 'unknown'
where status is null;

alter table public.subscriptions
  alter column status set not null;

create index if not exists subscriptions_user_id_idx
  on public.subscriptions(user_id);

create index if not exists subscriptions_stripe_customer_id_idx
  on public.subscriptions(stripe_customer_id);

create index if not exists subscriptions_status_idx
  on public.subscriptions(status);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'subscriptions_set_updated_at') then
    create trigger subscriptions_set_updated_at
    before update on public.subscriptions
    for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.subscriptions enable row level security;

drop policy if exists subscriptions_service_select on public.subscriptions;
drop policy if exists subscriptions_service_insert on public.subscriptions;
drop policy if exists subscriptions_service_update on public.subscriptions;
drop policy if exists subscriptions_service_delete on public.subscriptions;

create policy subscriptions_service_select
  on public.subscriptions for select to service_role using (true);

create policy subscriptions_service_insert
  on public.subscriptions for insert to service_role with check (true);

create policy subscriptions_service_update
  on public.subscriptions for update to service_role using (true) with check (true);

create policy subscriptions_service_delete
  on public.subscriptions for delete to service_role using (true);
