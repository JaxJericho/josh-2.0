# Observability Runbook — JOSH 2.0

This runbook defines the baseline Sentry setup and structured logging usage.
Do not include secrets or PII in logs or docs.

## Sentry Setup (Staging + Production)

1. Create Sentry projects:
   - `josh-2-0-staging`
   - `josh-2-0-prod`
2. Capture DSNs (do not paste in PRs).
3. Set Vercel env vars (names only):
   - `SENTRY_DSN`
   - `NEXT_PUBLIC_SENTRY_DSN`
   - `SENTRY_ENVIRONMENT` (`staging` or `prod`)
4. Redeploy staging and production.

## Structured Logging

Use the JSON logger in `app/lib/observability.ts`.
Required fields:
- `ts`, `level`, `event`, `env`, `request_id`

Redaction rules:
- Never log secrets or message bodies.
- Only log IDs and stable event names.

## Staging Verification (Safe)

Goal: prove Sentry captures a controlled error without changing runner config.

1. Ensure staging env vars are set.
2. Call the cron route with valid auth and the test header:
   - `x-sentry-test: 1`
3. Expected:
   - HTTP 500 with body `{"error":"Sentry test event sent"}`
   - Sentry event appears in staging project with:
     - tag `category=sms_outbound`
     - route label in logs: `api/cron/twilio-outbound-runner`

Note: the test header is honored only when `SENTRY_ENVIRONMENT=staging`.

## Production Verification

- Do not use the test header in production.
- Verify normal cron behavior after deploy.
- Confirm Sentry events appear only for real errors.

## Troubleshooting

- If no events appear:
  - Confirm DSNs are set in Vercel
  - Confirm `SENTRY_ENVIRONMENT` matches `staging` or `prod`
  - Check Vercel logs for JSON log entries
