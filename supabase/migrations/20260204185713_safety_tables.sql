-- Safety system tables

create table if not exists public.safety_incidents (
  id uuid primary key default gen_random_uuid(),
  severity text not null,
  category text not null,
  reporter_user_id uuid references public.users(id) on delete restrict,
  subject_user_id uuid references public.users(id) on delete restrict,
  linkup_id uuid references public.linkups(id) on delete restrict,
  message_id uuid references public.sms_messages(id) on delete restrict,
  description text,
  status public.safety_incident_status not null default 'open',
  assigned_admin_id uuid,
  resolution jsonb,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.safety_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  hold_type text not null,
  reason text,
  status public.safety_hold_status not null default 'active',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by_admin_id uuid,
  updated_at timestamptz not null default now(),
  idempotency_key text
);

create table if not exists public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_user_id uuid not null references public.users(id) on delete restrict,
  blocked_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint user_blocks_once unique (blocker_user_id, blocked_user_id)
);

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid references public.users(id) on delete restrict,
  subject_user_id uuid references public.users(id) on delete restrict,
  reason_category text not null,
  details text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_strikes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  strike_type text not null,
  points int not null,
  reason text,
  window_start timestamptz not null,
  window_end timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists safety_incidents_idem_uniq
  on public.safety_incidents(idempotency_key)
  where idempotency_key is not null;

create unique index if not exists safety_holds_idem_uniq
  on public.safety_holds(idempotency_key)
  where idempotency_key is not null;

create unique index if not exists user_reports_idem_uniq
  on public.user_reports(idempotency_key)
  where idempotency_key is not null;

create unique index if not exists safety_holds_one_active_per_user_idx
  on public.safety_holds(user_id)
  where status = 'active';

create index if not exists safety_incidents_subject_idx
  on public.safety_incidents(subject_user_id, created_at desc);

create index if not exists safety_incidents_reporter_idx
  on public.safety_incidents(reporter_user_id, created_at desc);

create index if not exists safety_incidents_status_idx
  on public.safety_incidents(status);

create index if not exists safety_holds_user_idx
  on public.safety_holds(user_id);

create index if not exists safety_holds_status_idx
  on public.safety_holds(status);

create index if not exists safety_holds_expires_idx
  on public.safety_holds(expires_at);

create index if not exists user_blocks_blocker_idx
  on public.user_blocks(blocker_user_id);

create index if not exists user_blocks_blocked_idx
  on public.user_blocks(blocked_user_id);

create index if not exists user_reports_subject_idx
  on public.user_reports(subject_user_id, created_at desc);

create index if not exists user_reports_reporter_idx
  on public.user_reports(reporter_user_id, created_at desc);

create index if not exists user_strikes_user_idx
  on public.user_strikes(user_id, created_at desc);

-- updated_at triggers

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'safety_incidents_set_updated_at') then
    create trigger safety_incidents_set_updated_at
    before update on public.safety_incidents
    for each row execute function public.set_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'safety_holds_set_updated_at') then
    create trigger safety_holds_set_updated_at
    before update on public.safety_holds
    for each row execute function public.set_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'user_reports_set_updated_at') then
    create trigger user_reports_set_updated_at
    before update on public.user_reports
    for each row execute function public.set_updated_at();
  end if;
end $$;
