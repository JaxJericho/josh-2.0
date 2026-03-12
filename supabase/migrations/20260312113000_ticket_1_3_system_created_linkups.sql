-- Ticket 1.3: Add system_created marker for JOSH-created LinkUps.
-- initiator_user_id nullability is already satisfied by the existing schema history.

begin;

alter table public.linkups
  add column if not exists system_created boolean not null default false;

create index if not exists linkups_system_created_idx
  on public.linkups(system_created, state)
  where system_created = true;

commit;
