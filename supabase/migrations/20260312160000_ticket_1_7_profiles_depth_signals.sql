-- Ticket 1.7: add depth signal columns to profiles.

begin;

alter table public.profiles
  add column interest_signatures jsonb;

alter table public.profiles
  add column relational_context jsonb;

commit;
