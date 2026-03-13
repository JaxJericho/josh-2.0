-- Ticket 6.3: Pair compatibility score cache for cluster detection.
-- Stores scored user pairs with a 24-hour TTL.
-- user_a_id < user_b_id enforced to ensure canonical ordering.

begin;

create table public.compatibility_score_cache (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references public.users(id) on delete cascade,
  user_b_id uuid not null references public.users(id) on delete cascade,
  profile_hash_a text not null,
  profile_hash_b text not null,
  score numeric(4,3) not null,
  computed_at timestamptz not null default now(),
  constraint score_cache_pair_uniq unique (user_a_id, user_b_id),
  check (user_a_id < user_b_id)
);

create index score_cache_computed_idx
  on public.compatibility_score_cache (computed_at);

commit;
