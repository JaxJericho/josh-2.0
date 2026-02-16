# Vercel Cron Runner — JOSH 2.0

## How It Works

Vercel Cron invokes protected Next.js API routes on a fixed schedule.
Each route validates `Authorization: Bearer ${CRON_SECRET}` and then performs a
deterministic job:

- `run-outbound`: calls the Supabase Edge Function runner using `STAGING_RUNNER_URL`
  and `STAGING_RUNNER_SECRET` via the `x-runner-secret` request header.
- `reconcile-outbound`: scans for stale outbound rows in Postgres using service-role
  and refreshes status directly from Twilio's Messages API.

Scheduler chain:
- Vercel Cron → protected Next.js route → Supabase Edge Function runner

Cron path (configured in `vercel.json`):
- `/api/cron/run-outbound`
- `/api/cron/reconcile-outbound`

## Required Env Vars (Names Only)

- `CRON_SECRET` (both cron routes)
- `STAGING_RUNNER_URL` (no query params; run-outbound only)
- `STAGING_RUNNER_SECRET` (run-outbound only)
- `SUPABASE_URL` (reconcile-outbound only)
- `SUPABASE_SERVICE_ROLE_KEY` (reconcile-outbound only)
- `TWILIO_ACCOUNT_SID` (reconcile-outbound only)
- `TWILIO_AUTH_TOKEN` (reconcile-outbound only)

Notes:
- `run-outbound` does not require `SUPABASE_URL` or `SUPABASE_ANON_KEY` because it calls
  the Edge Function runner via HTTP using `STAGING_RUNNER_URL`.
- `STAGING_RUNNER_SECRET` must match the runner's `QSTASH_RUNNER_SECRET` in Supabase.
- `reconcile-outbound` reads/writes Postgres via `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  and fetches message state from Twilio via `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`.

## Manual Test (curl)

Without auth (should be 401):

```bash
curl -i -X POST "${STAGING_BASE_URL}/api/cron/run-outbound"
```

With auth (should be 200 if runner is healthy):

```bash
curl -i \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -X POST \
  "${STAGING_BASE_URL}/api/cron/run-outbound"
```

Scheduled invocations:
- Vercel Cron uses `GET` with `User-Agent: vercel-cron/1.0` (and may include `x-vercel-cron: 1`).
- The route accepts `GET` only for these cron-style requests; manual tests should use `POST`.

Expected response shape:

```json
{ "ok": true, "runner_status": 200, "processed": 1, "sent": 1, "failed": 0 }
```

## Reconcile Outbound (Backfill) — Manual Test (curl)

This job scans for stale outbound rows and refreshes status directly from Twilio.

```bash
curl -i \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -X POST \
  "${STAGING_BASE_URL}/api/cron/reconcile-outbound?limit=25&stale_minutes=15"
```

Expected response shape:

```json
{ "ok": true, "checked": 1, "updated": 1, "skipped": 0, "failed": 0 }
```

## Troubleshooting Checklist

- 401: Missing/invalid `Authorization` header or wrong `CRON_SECRET`.
- 400: `STAGING_RUNNER_URL` contains query params (must not include `?`) (run-outbound only).
- 500: Missing required env vars in Vercel.
- 502: Route could not reach the runner endpoint (run-outbound only).
- Upstream non-200: Runner returned an error; check Supabase Edge Function logs (run-outbound only).
