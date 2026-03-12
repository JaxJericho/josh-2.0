-- Ticket 1.5: Add group_size_preference coordination signal to profiles.
-- This is distinct from profiles.preferences.group_size_pref.

begin;

alter table public.profiles
  add column if not exists group_size_preference jsonb;

commit;
