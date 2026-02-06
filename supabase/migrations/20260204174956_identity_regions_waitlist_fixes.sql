-- Fix identity/region/waitlist constraints

-- waitlist_entries: composite primary key (user_id, region_id)
alter table public.waitlist_entries
  drop constraint if exists waitlist_entries_pkey;

alter table public.waitlist_entries
  drop constraint if exists waitlist_entries_user_region_uniq;

alter table public.waitlist_entries
  add primary key (user_id, region_id);

-- otp_sessions: enforce one unverified session per user
alter table public.otp_sessions
  drop constraint if exists otp_one_active_per_user;

create unique index if not exists otp_sessions_one_unverified_per_user_idx
  on public.otp_sessions(user_id)
  where verified_at is null;

-- region_memberships: canonical uniqueness and one active membership per user
alter table public.region_memberships
  drop constraint if exists region_membership_one_active;

create unique index if not exists region_memberships_user_region_uniq_idx
  on public.region_memberships(user_id, region_id);

create unique index if not exists region_memberships_one_active_per_user_idx
  on public.region_memberships(user_id)
  where status = 'active';
