# QStash Runner Scheduling

This runbook provisions the QStash schedule for the outbound runner without
query parameters and avoids shell-escaping errors.

## Required Env Vars

- `QSTASH_TOKEN`
- `QSTASH_RUNNER_SECRET`

## Optional Env Vars

- `QSTASH_BASE_URL` (default: `https://qstash-us-east-1.upstash.io`)
- `RUNNER_URL` (default: staging runner URL without query params)
- `QSTASH_DELETE_BROKEN` (`1` deletes any `?limit=5` schedule)

## Run

```bash
QSTASH_TOKEN=... \
QSTASH_RUNNER_SECRET=... \
node scripts/qstash-schedule-runner.mjs
```

The script:

- Lists schedules
- Deletes broken `...?limit=5` schedules when `QSTASH_DELETE_BROKEN=1`
- Checks for an existing schedule matching the destination, cron, and method
  - If found, prints the existing schedule and exits (safe to re-run)
- Creates a new schedule targeting:
  `https://<project-ref>.supabase.co/functions/v1/twilio-outbound-runner`
- Uses cron `*/1 * * * *` with JSON body `{"runner_secret":"..."}`
- Verifies the created schedule appears in the schedule list

Notes:

- The destination must not include query params or signature verification fails.
- The body is built with `JSON.stringify` to avoid shell escaping issues.
- The script is idempotent: re-running it when a matching schedule already exists
  (same destination, cron `*/1 * * * *`, method `POST`) will skip creation.
