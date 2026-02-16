# Rebaseline Findings — Ticket 0.3

## What The Doctor Checks

- Env source hints (.env and .env.local existence)
- Safe env var fingerprints (set/unset, length, sha256 prefix)
- Runner URL shape (hard fail on query params)
- Supabase functions base URL format (if provided)
- Supabase `verify_jwt` config for Twilio-related functions
- Function folders present
- Scheduler readiness (required env vars documented and checked)
- Repo scripts present (lint/typecheck/test/build)

## How To Run

```bash
node scripts/doctor.mjs
```

Optional remote checks (disabled by default):

```bash
DOCTOR_REMOTE=1 node scripts/doctor.mjs
```

## Confirmed Complete

- Phase 0–2.2 (per build plan)

## Outstanding Next (Ticket IDs Only)

- 0.4
- 0.5
- 0.6
- 2.3
- 2.4

## Legacy Naming To Clean Up Later

These env var names are still referenced in code/docs and should be renamed in a later ticket:

- `QSTASH_RUNNER_SECRET`
- `QSTASH_AUTH_DEBUG`

## Common Failure Explanations

- Env mismatch between local/staging/production
- Runner URL has query params
- Wrong runner base URL shape
- `verify_jwt` expectations not aligned with Twilio webhook endpoints
