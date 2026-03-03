-- Ticket 21.5: destructive enum recreation for deprecated values.
--
-- Pre-flight queries (run before applying in staging; must all be zero):
--   select count(*) as deprecated_learning_signal_rows
--   from public.learning_signals
--   where signal_type::text in (
--     'match_preview_accepted',
--     'match_preview_rejected',
--     'match_preview_expired'
--   );
--
--   select count(*) as one_to_one_match_runs
--   from public.match_runs
--   where mode::text = 'one_to_one';
--
--   select count(*) as one_to_one_match_candidates
--   from public.match_candidates
--   where mode::text = 'one_to_one';
--
-- Rollback summary:
--   - If this migration fails before COMMIT, Postgres rolls back automatically.
--   - If this migration has already committed, follow:
--       docs/runbooks/enum-recreation-rollback.md

begin;

drop view if exists compat.match_candidates;
drop view if exists compat.match_runs;

create type public.learning_signal_type_v2 as enum (
  'linkup_attendance_attended',
  'linkup_attendance_no_show',
  'linkup_attendance_unsure',
  'linkup_do_again_yes',
  'linkup_do_again_no',
  'linkup_feedback_text',
  'contact_exchange_mutual_yes',
  'contact_exchange_declined',
  'user_blocked_other',
  'user_reported_other',
  'linkup_do_again_unsure',
  'solo_activity_attended',
  'solo_activity_skipped',
  'solo_do_again_yes',
  'solo_do_again_no',
  'solo_bridge_accepted'
);

alter table public.learning_signals
  alter column signal_type type public.learning_signal_type_v2
  using signal_type::text::public.learning_signal_type_v2;

create type public.match_mode_v2 as enum (
  'linkup'
);

alter table public.match_runs
  alter column mode type public.match_mode_v2
  using mode::text::public.match_mode_v2;

alter table public.match_candidates
  alter column mode type public.match_mode_v2
  using mode::text::public.match_mode_v2;

drop type public.learning_signal_type;
alter type public.learning_signal_type_v2 rename to learning_signal_type;

drop type public.match_mode;
alter type public.match_mode_v2 rename to match_mode;

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

commit;
