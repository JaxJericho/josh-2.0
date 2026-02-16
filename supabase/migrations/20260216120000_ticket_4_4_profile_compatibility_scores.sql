-- Ticket 4.4: deterministic pairwise compatibility score persistence.

create table if not exists public.profile_compatibility_scores (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references public.users(id) on delete cascade,
  user_b_id uuid not null references public.users(id) on delete cascade,
  a_hash text not null,
  b_hash text not null,
  score_version text not null,
  score_total numeric(6,4) not null,
  breakdown_json jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_compatibility_scores_canonical_pair_chk
    check (user_a_id < user_b_id),
  constraint profile_compatibility_scores_score_total_chk
    check (score_total >= 0 and score_total <= 100),
  constraint profile_compatibility_scores_unique_key
    unique (user_a_id, user_b_id, a_hash, b_hash, score_version)
);

create index if not exists profile_compatibility_scores_user_a_computed_idx
  on public.profile_compatibility_scores(user_a_id, computed_at desc);

create index if not exists profile_compatibility_scores_user_b_computed_idx
  on public.profile_compatibility_scores(user_b_id, computed_at desc);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'profile_compatibility_scores_set_updated_at'
  ) then
    create trigger profile_compatibility_scores_set_updated_at
    before update on public.profile_compatibility_scores
    for each row execute function public.set_updated_at();
  end if;
end $$;

create or replace view compat.profile_compatibility_scores as
select
  id,
  user_a_id,
  user_b_id,
  a_hash,
  b_hash,
  score_version,
  score_total,
  breakdown_json,
  computed_at,
  updated_at
from public.profile_compatibility_scores;

alter table public.profile_compatibility_scores enable row level security;

drop policy if exists svc_select on public.profile_compatibility_scores;
drop policy if exists svc_insert on public.profile_compatibility_scores;
drop policy if exists svc_update on public.profile_compatibility_scores;
drop policy if exists svc_delete on public.profile_compatibility_scores;
drop policy if exists admin_select on public.profile_compatibility_scores;

create policy svc_select
  on public.profile_compatibility_scores
  for select
  to service_role
  using (true);

create policy svc_insert
  on public.profile_compatibility_scores
  for insert
  to service_role
  with check (true);

create policy svc_update
  on public.profile_compatibility_scores
  for update
  to service_role
  using (true)
  with check (true);

create policy svc_delete
  on public.profile_compatibility_scores
  for delete
  to service_role
  using (true);

create policy admin_select
  on public.profile_compatibility_scores
  for select
  to authenticated
  using (public.is_admin_user());
