# Matching Runs + Candidate Scoring E2E Proof (Staging Only)

This runbook proves Ticket 7.1 behavior in staging only:

`Eligible Users -> Deterministic Match Run -> Persisted Candidates -> Idempotent Replay`

## Scope

- Environment: **staging only**
- No dashboard click-ops
- Node job execution only
- Deterministic run-key replay for idempotency proof

## Required Environment Variables

- `STAGING_DB_DSN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The scripts fail fast with non-zero exit if required env vars are missing.

## What The Job Enforces

- Account/profile eligibility: `users.state='active'`, not deleted, profile complete.
- Eligibility + safety gates: `profile_entitlements` + region assignment + waitlist + active holds (via canonical entitlement evaluation logic).
- Source-user intro entitlement gate: `entitlements.can_receive_intro=true` and `intro_credits_remaining > 0`.
- Block safety gate: excludes blocked pairs in both directions.
- Canonical scoring implementation: uses `packages/core/src/compatibility/scorer.ts` (v1 weights/breakdown).

## Idempotency Guarantee

- Deterministic `run_key` identifies the run.
- `match_runs.run_key` is unique.
- Candidate upserts use `onConflict: match_run_id,source_user_id,candidate_user_id`.
- DB constraints enforce uniqueness for both pair key and deterministic fingerprint within a run.
- Re-running with identical inputs and the same `run_key` does not increase candidate row count.

## Commands

1. Run preflight:

```bash
pnpm run doctor
```

2. Seed deterministic staging records:

```bash
pnpm run verify:matching:seed
```

If `STAGING_DB_DSN` is unavailable but `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are available, use:

```bash
pnpm run verify:matching:seed:rest
```

3. Execute matching proof (first run + same-input replay + SQL assertions):

```bash
pnpm run verify:matching:e2e
```

4. Run only the matching job directly (without the wrapper proof script):

```bash
pnpm run matching:run -- --source-user-id 77777777-7777-4777-8777-777777777801 --candidate-limit 3 --source-limit 1 --run-key ticket_7_1_manual_run_v1
```

## SQL Verification Queries (Manual)

Use the run key printed by `verify:matching:e2e`.

```sql
select id, run_key, status, started_at, finished_at
from public.match_runs
where run_key = '<RUN_KEY>';
```

```sql
select source_user_id, candidate_user_id, total_score, fingerprint
from public.match_candidates
where match_run_id = '<RUN_ID>'
order by total_score desc, candidate_user_id asc;
```

```sql
select source_user_id, candidate_user_id, count(*)
from public.match_candidates
where match_run_id = '<RUN_ID>'
group by source_user_id, candidate_user_id
having count(*) > 1;
```

```sql
select conname
from pg_constraint
where conrelid = 'public.match_candidates'::regclass
  and conname in (
    'match_candidates_run_source_candidate_uniq',
    'match_candidates_run_fingerprint_uniq'
  )
order by conname;
```
