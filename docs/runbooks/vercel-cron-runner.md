# Vercel Cron Runner — JOSH 2.0

## How It Works

Vercel Cron invokes a protected Next.js API route on a fixed schedule.
That route validates `Authorization: Bearer ${CRON_SECRET}` and then calls the
Supabase Edge Function runner using `STAGING_RUNNER_URL` and `STAGING_RUNNER_SECRET`
via the `x-runner-secret` request header.

Scheduler chain:
- Vercel Cron → protected Next.js route → Supabase Edge Function runner

## Required Env Vars (Names Only)

- `CRON_SECRET`
- `STAGING_RUNNER_URL` (no query params)
- `STAGING_RUNNER_SECRET`

## Manual Test (curl)

Without auth (should be 401):

```bash
curl -i "${STAGING_BASE_URL}/api/cron/twilio-outbound-runner"
```

With auth (should be 200 if runner is healthy):

```bash
curl -i \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "${STAGING_BASE_URL}/api/cron/twilio-outbound-runner"
```

## Troubleshooting Checklist

- 401: Missing/invalid `Authorization` header or wrong `CRON_SECRET`.
- 400: `STAGING_RUNNER_URL` contains query params (must not include `?`).
- 500: Missing required env vars in Vercel.
- 502: Route could not reach the runner endpoint.
- Upstream non-200: Runner returned an error; check Supabase Edge Function logs.
