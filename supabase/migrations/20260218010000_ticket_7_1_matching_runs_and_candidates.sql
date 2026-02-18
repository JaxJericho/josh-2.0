-- Ticket 7.1: Matching runs + candidate scoring foundation.
-- Additive evolution of existing match_runs/match_candidates for deterministic,
-- explainable, idempotent run execution.

-- 0) Fail fast if required base tables are missing.
do $$
declare
  missing_tables text;
begin
  with required_tables(table_name) as (
    values
      ('users'),
      ('match_runs'),
      ('match_candidates')
  )
  select string_agg(r.table_name, ', ' order by r.table_name)
  into missing_tables
  from required_tables r
  left join pg_tables t
    on t.schemaname = 'public'
   and t.tablename = r.table_name
  where t.tablename is null;

  if missing_tables is not null then
    raise exception 'ticket 7.1 aborted: missing required public tables: %', missing_tables;
  end if;
end $$;

-- 1) match_runs: add canonical run metadata fields.
alter table public.match_runs
  add column if not exists inputs jsonb not null default '{}'::jsonb,
  add column if not exists config jsonb not null default '{}'::jsonb,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists error text;

update public.match_runs
set
  inputs = coalesce(inputs, '{}'::jsonb),
  config = coalesce(config, params, '{}'::jsonb),
  started_at = coalesce(started_at, created_at),
  finished_at = coalesce(finished_at, completed_at),
  error = coalesce(error, error_detail)
where
  inputs is null
  or config is null
  or started_at is null
  or (finished_at is null and completed_at is not null)
  or (error is null and error_detail is not null);

alter table public.match_runs
  alter column inputs set not null,
  alter column config set not null,
  alter column started_at set not null;

create index if not exists match_runs_status_started_idx
  on public.match_runs(status, started_at desc);

-- 2) match_candidates: add canonical naming + deterministic fingerprint.
alter table public.match_candidates
  add column if not exists source_user_id uuid references public.users(id) on delete restrict,
  add column if not exists total_score numeric,
  add column if not exists breakdown jsonb not null default '{}'::jsonb,
  add column if not exists reasons jsonb not null default '[]'::jsonb,
  add column if not exists fingerprint text;

update public.match_candidates
set
  source_user_id = coalesce(source_user_id, subject_user_id),
  total_score = coalesce(total_score, final_score),
  breakdown = coalesce(breakdown, component_scores, '{}'::jsonb),
  reasons = coalesce(
    reasons,
    explainability -> 'top_reasons',
    case
      when explainability is null or explainability = '{}'::jsonb then '[]'::jsonb
      else jsonb_build_array(explainability)
    end,
    '[]'::jsonb
  ),
  fingerprint = coalesce(
    fingerprint,
    md5(
      concat_ws(
        '|',
        match_run_id::text,
        coalesce(source_user_id::text, subject_user_id::text),
        candidate_user_id::text,
        coalesce(mode::text, ''),
        coalesce(total_score::text, final_score::text, ''),
        coalesce((coalesce(breakdown, component_scores, '{}'::jsonb))::text, ''),
        coalesce((coalesce(reasons, '[]'::jsonb))::text, '')
      )
    )
  )
where
  source_user_id is null
  or total_score is null
  or breakdown is null
  or reasons is null
  or fingerprint is null;

alter table public.match_candidates
  alter column source_user_id set not null,
  alter column total_score set not null,
  alter column breakdown set not null,
  alter column reasons set not null,
  alter column fingerprint set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'match_candidates_source_candidate_not_same_chk'
      and conrelid = 'public.match_candidates'::regclass
  ) then
    alter table public.match_candidates
      add constraint match_candidates_source_candidate_not_same_chk
      check (source_user_id <> candidate_user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'match_candidates_run_source_candidate_uniq'
      and conrelid = 'public.match_candidates'::regclass
  ) then
    alter table public.match_candidates
      add constraint match_candidates_run_source_candidate_uniq
      unique (match_run_id, source_user_id, candidate_user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'match_candidates_run_fingerprint_uniq'
      and conrelid = 'public.match_candidates'::regclass
  ) then
    alter table public.match_candidates
      add constraint match_candidates_run_fingerprint_uniq
      unique (match_run_id, fingerprint);
  end if;
end $$;

create index if not exists match_candidates_source_user_idx
  on public.match_candidates(source_user_id);

create index if not exists match_candidates_candidate_user_idx
  on public.match_candidates(candidate_user_id);

create index if not exists match_candidates_match_run_id_idx
  on public.match_candidates(match_run_id);

create index if not exists match_candidates_source_score_idx
  on public.match_candidates(source_user_id, total_score desc, candidate_user_id);

-- 3) RLS: authenticated users can read only their own source candidates.
-- Service role policies already exist; keep writes service-role only.
alter table public.match_candidates enable row level security;


drop policy if exists match_candidates_select_own on public.match_candidates;
create policy match_candidates_select_own
  on public.match_candidates
  for select
  to authenticated
  using (source_user_id = auth.uid());
