-- Identity + regions + waitlist

create table if not exists public.regions (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  display_name text not null,
  state public.region_state not null default 'waitlisted',
  geometry jsonb not null,
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint regions_slug_uniq unique (slug)
);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  phone_hash text not null,
  first_name text not null,
  last_name text not null,
  birthday date not null,
  email citext,
  state public.user_state not null default 'unverified',
  sms_consent boolean not null,
  age_consent boolean not null,
  terms_consent boolean not null,
  privacy_consent boolean not null,
  region_id uuid,
  suspended_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_phone_hash_uniq unique (phone_hash),
  constraint users_phone_e164_uniq unique (phone_e164),
  constraint users_region_fk foreign key (region_id) references public.regions(id) on delete restrict
);

create table if not exists public.otp_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  otp_hash text not null,
  expires_at timestamptz not null,
  verified_at timestamptz,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint otp_one_active_per_user unique (user_id, verified_at)
);

create table if not exists public.region_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  region_id uuid not null references public.regions(id) on delete restrict,
  status text not null check (status in ('active','waitlisted')),
  joined_at timestamptz not null default now(),
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint region_membership_one_active unique (user_id, status)
);

create table if not exists public.waitlist_entries (
  user_id uuid primary key references public.users(id) on delete restrict,
  region_id uuid not null references public.regions(id) on delete restrict,
  status public.waitlist_status not null default 'waiting',
  joined_at timestamptz not null default now(),
  onboarded_at timestamptz,
  notified_at timestamptz,
  activated_at timestamptz,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint waitlist_entries_user_region_uniq unique (user_id, region_id)
);

create index if not exists users_state_idx on public.users(state);
create index if not exists users_region_idx on public.users(region_id);
create index if not exists users_created_at_idx on public.users(created_at);

create index if not exists otp_sessions_user_idx on public.otp_sessions(user_id);
create index if not exists otp_sessions_expires_idx on public.otp_sessions(expires_at);

create index if not exists regions_state_idx on public.regions(state);

create index if not exists region_memberships_region_idx on public.region_memberships(region_id);
create index if not exists region_memberships_user_idx on public.region_memberships(user_id);
create index if not exists region_memberships_status_idx on public.region_memberships(status);

create index if not exists waitlist_entries_region_idx on public.waitlist_entries(region_id);
create index if not exists waitlist_entries_status_idx on public.waitlist_entries(status);
create index if not exists waitlist_entries_created_at_idx on public.waitlist_entries(created_at);

-- updated_at triggers

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'users_set_updated_at') then
    create trigger users_set_updated_at
    before update on public.users
    for each row execute function public.set_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'otp_sessions_set_updated_at') then
    create trigger otp_sessions_set_updated_at
    before update on public.otp_sessions
    for each row execute function public.set_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'regions_set_updated_at') then
    create trigger regions_set_updated_at
    before update on public.regions
    for each row execute function public.set_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'region_memberships_set_updated_at') then
    create trigger region_memberships_set_updated_at
    before update on public.region_memberships
    for each row execute function public.set_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'waitlist_entries_set_updated_at') then
    create trigger waitlist_entries_set_updated_at
    before update on public.waitlist_entries
    for each row execute function public.set_updated_at();
  end if;
end $$;
