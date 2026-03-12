-- Ticket 1.2: Create invitations table
-- Primary state machine entity for JOSH-initiated invitations (pivot model).
-- Covers both solo activity invitations and group LinkUp invitations.
-- Solo invitations have linkup_id = NULL.
-- Group invitations have linkup_id referencing a system-created linkups row.

begin;

create type public.invitation_state as enum (
  'pending',
  'accepted',
  'passed',
  'expired'
);

create type public.invitation_type as enum (
  'solo',
  'group'
);

create table public.invitations (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.users(id) on delete cascade,
  invitation_type       public.invitation_type not null,
  linkup_id             uuid references public.linkups(id) on delete set null,
  activity_key          text not null,
  time_window           text not null,
  state                 public.invitation_state not null default 'pending',
  expires_at            timestamptz not null,
  responded_at          timestamptz,
  response_message_sid  text,
  idempotency_key       text not null,
  correlation_id        uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint invitations_idem_uniq unique (idempotency_key)
);

create index invitations_user_state_idx on public.invitations(user_id, state);

create index invitations_expires_idx on public.invitations(expires_at)
  where state = 'pending';

create index invitations_linkup_idx on public.invitations(linkup_id)
  where linkup_id is not null;

create trigger invitations_updated_at
  before update on public.invitations
  for each row execute function public.set_updated_at();

alter table public.invitations enable row level security;

create policy invitations_select_own
  on public.invitations for select
  using (user_id = auth.uid());

commit;
