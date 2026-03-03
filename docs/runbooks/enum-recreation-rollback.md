# Enum Recreation Rollback — Ticket 21.5

This runbook rolls back the destructive enum migration that removed deprecated values from:

- `public.learning_signal_type`
- `public.match_mode`

Use this only if `20260303101500_recreate_enums_remove_deprecated.sql` was already applied and must be reversed.

## Safety Rules

- Run in staging first.
- Confirm backups exist before running rollback in production.
- Do not run partial steps outside one transaction.

## Pre-Flight Checks (Must Be Captured In PR Notes)

```sql
select count(*) as deprecated_learning_signal_rows
from public.learning_signals
where signal_type::text in (
  'match_preview_accepted',
  'match_preview_rejected',
  'match_preview_expired'
);

select count(*) as one_to_one_match_runs
from public.match_runs
where mode::text = 'one_to_one';

select count(*) as one_to_one_match_candidates
from public.match_candidates
where mode::text = 'one_to_one';

select count(*) as learning_signals_row_count
from public.learning_signals;

select count(*) as match_runs_row_count
from public.match_runs;

select count(*) as match_candidates_row_count
from public.match_candidates;
```

## Rollback SQL

```sql
begin;

drop view if exists compat.match_candidates;
drop view if exists compat.match_runs;

create type public.learning_signal_type_v3 as enum (
  'linkup_attendance_attended',
  'linkup_attendance_no_show',
  'linkup_attendance_unsure',
  'linkup_do_again_yes',
  'linkup_do_again_no',
  'linkup_feedback_text',
  'contact_exchange_mutual_yes',
  'contact_exchange_declined',
  'match_preview_accepted',
  'match_preview_rejected',
  'match_preview_expired',
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
  alter column signal_type type public.learning_signal_type_v3
  using signal_type::text::public.learning_signal_type_v3;

create type public.match_mode_v3 as enum (
  'one_to_one',
  'linkup'
);

alter table public.match_runs
  alter column mode type public.match_mode_v3
  using mode::text::public.match_mode_v3;

alter table public.match_candidates
  alter column mode type public.match_mode_v3
  using mode::text::public.match_mode_v3;

drop type public.learning_signal_type;
alter type public.learning_signal_type_v3 rename to learning_signal_type;

drop type public.match_mode;
alter type public.match_mode_v3 rename to match_mode;

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
```

## Post-Flight Checks

```sql
select count(*) as learning_signals_row_count
from public.learning_signals;

select count(*) as match_runs_row_count
from public.match_runs;

select count(*) as match_candidates_row_count
from public.match_candidates;
```

## Insert-Failure Checks

After rollback, these inserts should succeed:

```sql
insert into public.match_runs (
  mode,
  run_key,
  status,
  params
)
values (
  'one_to_one',
  'rollback-check-one-to-one',
  'started',
  '{}'::jsonb
);

insert into public.learning_signals (
  user_id,
  signal_type,
  occurred_at,
  idempotency_key
)
values (
  '00000000-0000-0000-0000-000000000000',
  'match_preview_accepted',
  now(),
  'rollback-check-match-preview'
);
```
