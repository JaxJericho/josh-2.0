-- Match runs and candidates

do $$
begin
  if not exists (select 1 from pg_type where typname = 'match_mode') then
    create type public.match_mode as enum (
      'one_to_one',
      'linkup'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'match_run_status') then
    create type public.match_run_status as enum (
      'started',
      'completed',
      'failed'
    );
  end if;
end $$;

create table if not exists public.match_runs (
  id uuid primary key default gen_random_uuid(),
  mode public.match_mode not null,
  region_id uuid references public.regions(id) on delete restrict,
  subject_user_id uuid references public.users(id) on delete restrict,
  run_key text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  status public.match_run_status not null default 'started',
  error_code text,
  error_detail text,
  params jsonb not null default '{}'::jsonb
);

create table if not exists public.match_candidates (
  id uuid primary key default gen_random_uuid(),
  match_run_id uuid not null references public.match_runs(id) on delete restrict,
  subject_user_id uuid not null references public.users(id) on delete restrict,
  candidate_user_id uuid not null references public.users(id) on delete restrict,
  mode public.match_mode not null,
  passed_hard_filters boolean not null default false,
  final_score numeric,
  component_scores jsonb not null default '{}'::jsonb,
  explainability jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists match_runs_run_key_uniq
  on public.match_runs(run_key);

create unique index if not exists match_candidates_run_subject_candidate_uniq
  on public.match_candidates(match_run_id, subject_user_id, candidate_user_id);

create index if not exists match_candidates_subject_mode_score_idx
  on public.match_candidates(subject_user_id, mode, final_score desc);

create index if not exists match_candidates_run_idx
  on public.match_candidates(match_run_id);
