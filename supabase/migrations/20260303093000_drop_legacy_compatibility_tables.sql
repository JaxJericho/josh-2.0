-- Ticket 21.4: remove legacy compatibility pipeline tables.

drop view if exists compat.profile_compatibility_signals;
drop view if exists compat.profile_compatibility_scores;

drop table if exists public.profile_compatibility_signals;
drop table if exists public.profile_compatibility_scores;
