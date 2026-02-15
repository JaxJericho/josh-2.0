# Vercel Cron Runner — JOSH 2.0

## How It Works

Vercel Cron invokes a protected Next.js API route on a fixed schedule.
That route validates `Authorization: Bearer ${CRON_SECRET}` and then calls the
Supabase Edge Function runner using `STAGING_RUNNER_URL` and `STAGING_RUNNER_SECRET`
via the `x-runner-secret` request header.

Scheduler chain:
- Vercel Cron → protected Next.js route → Supabase Edge Function runner

Cron path (configured in `vercel.json`):
- `/api/cron/run-outbound`

## Required Env Vars (Names Only)

- `CRON_SECRET`
- `STAGING_RUNNER_URL` (no query params)
- `STAGING_RUNNER_SECRET`

Notes:
- This route does not require `SUPABASE_URL` or `SUPABASE_ANON_KEY` because it calls
  the Edge Function runner via HTTP using `STAGING_RUNNER_URL`.
- `STAGING_RUNNER_SECRET` must match the runner's `QSTASH_RUNNER_SECRET` in Supabase.

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

## Troubleshooting Checklist

- 401: Missing/invalid `Authorization` header or wrong `CRON_SECRET`.
- 400: `STAGING_RUNNER_URL` contains query params (must not include `?`).
- 500: Missing required env vars in Vercel.
- 502: Route could not reach the runner endpoint.
- Upstream non-200: Runner returned an error; check Supabase Edge Function logs.
