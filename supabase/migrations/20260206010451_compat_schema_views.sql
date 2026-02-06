-- Compatibility schema + views

create schema if not exists compat;

create or replace view compat.match_runs as
  select
    id,
    mode,
    region_id,
    subject_user_id,
    run_key,
    created_at,
    completed_at,
    status,
    error_code,
    error_detail,
    params
  from public.match_runs;

create or replace view compat.match_candidates as
  select
    id,
    match_run_id,
    subject_user_id,
    candidate_user_id,
    mode,
    passed_hard_filters,
    final_score,
    component_scores,
    explainability,
    created_at
  from public.match_candidates;
