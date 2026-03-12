-- Ticket 1.4: Add invitation tracking columns to users.
-- These fields are consumed by the invitation frequency guard in a later phase.

begin;

alter table public.users
  add column if not exists last_invited_at timestamptz;

alter table public.users
  add column if not exists invitation_week_start timestamptz;

alter table public.users
  add column if not exists invitation_count_this_week int not null default 0;

alter table public.users
  add column if not exists invitation_backoff_count int not null default 0;

create index if not exists users_last_invited_idx
  on public.users(last_invited_at)
  where last_invited_at is not null;

commit;
