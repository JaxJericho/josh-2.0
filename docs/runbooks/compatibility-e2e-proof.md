# Compatibility Pipeline E2E Proof (Staging Only)

This runbook proves deterministic compatibility pipeline behavior in staging only:

`Profile -> Signals -> Compatibility Score -> Persisted Rows -> Idempotent Replay`

## Scope

- Environment: **staging only** (`rcqlnfywwfsixznrmzmv`)
- No schema changes
- No migration steps
- No dashboard actions

## Required Environment Variables

- `STAGING_DB_DSN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The scripts fail fast with non-zero exit if any required variable is missing.

## Deterministic Test IDs

- `user_a_id`: `44444444-4444-4444-8444-444444444444`
- `user_b_id`: `55555555-5555-4555-8555-555555555555`

## Commands

1. Run preflight:

```bash
pnpm run doctor
```

2. Seed deterministic profiles/signals in staging:

```bash
node scripts/verify/seed-compatibility-e2e.mjs
```

Expected output contains:
- `users_ready=2`
- `profiles_ready=2`
- `signals_ready=2`
- `done=true`

3. Run end-to-end compatibility proof:

```bash
node scripts/verify/run-compatibility-e2e.mjs
```

4. Run end-to-end proof again (replay):

```bash
node scripts/verify/run-compatibility-e2e.mjs
```

Expected output from each run contains:
- `signals_exist=true`
- `score_first=<number>`
- `score_second=<same number>`
- `score_version=<same version>`
- `unique_key_rows_after_first=1`
- `unique_key_rows_after_second=1`
- `idempotent_replay=true`

## SQL Verification Queries

Run these directly against staging:

```sql
select count(*) from public.profile_compatibility_scores;
```

```sql
select score_total as total_score, score_version
from public.profile_compatibility_scores
where user_a_id = '44444444-4444-4444-8444-444444444444'
  and user_b_id = '55555555-5555-4555-8555-555555555555'
order by computed_at desc
limit 5;
```

Expected:
- Re-running `run-compatibility-e2e.mjs` does not increase row count for the same `(user_a_id, user_b_id, a_hash, b_hash, score_version)` key.
- `total_score` and `score_version` remain consistent across replays when signal hashes are unchanged.
