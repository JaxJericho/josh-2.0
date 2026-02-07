# Environment Contract — JOSH 2.0

This is the authoritative environment wiring contract for current repo reality.
It focuses on endpoints, wiring, and where configuration lives.

For the full environment variable catalog and rules, see:
- docs/architecture/environment-variables.md

## Environments

- Local: development and manual verification
- Staging: pre-production verification
- Production: real users and payments

## Supabase

- Staging project ref: `wbeneoawrqvmoufubwzn`
- Edge Functions base URL pattern:
  - `https://<project-ref>.supabase.co/functions/v1`
- Function endpoints (paths only):
  - `/functions/v1/twilio-inbound`
  - `/functions/v1/twilio-outbound-runner`
  - `/functions/v1/twilio-status-callback`
- `verify_jwt` settings (as configured in `supabase/config.toml`):
  - `[functions.twilio-inbound]` → `verify_jwt = false`
  - `[functions.twilio-status-callback]` → `verify_jwt = false`
  - `[functions.twilio-outbound-runner]` → `verify_jwt = false`

## Vercel

- Staging base URL: `<staging-base-url>`
- Production base URL: `<production-base-url>`
- Planned cron route path (Ticket 0.6):
  - `/api/cron/twilio-outbound-runner`

## Twilio

- Inbound webhook destination path:
  - `/functions/v1/twilio-inbound`
- Status callback destination path:
  - `/functions/v1/twilio-status-callback`
- Required Twilio env vars (names only):
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_MESSAGING_SERVICE_SID`
  - `TWILIO_FROM_NUMBER`
  - `TWILIO_STATUS_CALLBACK_URL`

## Stripe

- Webhook destination path (placeholder until implemented):
  - `<stripe-webhook-path>`
- Required Stripe env vars (names only):
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`

## Scheduler / Runner

- Canonical scheduler chain:
  - Vercel Cron → protected Next.js route → Supabase Edge Function runner
- Runner URL MUST NOT include query params (`?` is a hard fail).
- Protected cron route auth:
  - Header: `Authorization`
  - Env var: `CRON_SECRET`
- Runner invocation auth:
  - JSON body field: `runner_secret`
  - Env var: `*_RUNNER_SECRET`

## Env Var Inventory (Names Only)

Grouped by subsystem and scope. See `docs/architecture/environment-variables.md` for the full list and rules.

### Supabase

- Local:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `PROJECT_REF`
- Staging:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `PROJECT_REF`
- Production:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `PROJECT_REF`

### Messaging (Twilio + SMS)

- Local:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_MESSAGING_SERVICE_SID`
  - `TWILIO_FROM_NUMBER`
  - `TWILIO_STATUS_CALLBACK_URL`
  - `SMS_BODY_ENCRYPTION_KEY`
- Staging:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_MESSAGING_SERVICE_SID`
  - `TWILIO_FROM_NUMBER`
  - `TWILIO_STATUS_CALLBACK_URL`
  - `SMS_BODY_ENCRYPTION_KEY`
- Production:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_MESSAGING_SERVICE_SID`
  - `TWILIO_FROM_NUMBER`
  - `TWILIO_STATUS_CALLBACK_URL`
  - `SMS_BODY_ENCRYPTION_KEY`

### Scheduler / Runner

- Local:
  - `LOCAL_RUNNER_URL`
  - `LOCAL_RUNNER_SECRET`
- Staging:
  - `STAGING_RUNNER_URL`
  - `STAGING_RUNNER_SECRET`
  - `CRON_SECRET`
- Production:
  - `PRODUCTION_RUNNER_URL`
  - `PRODUCTION_RUNNER_SECRET`
  - `CRON_SECRET`

### Payments (Stripe)

- Staging:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
- Production:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`

### Vercel

- Staging:
  - `VERCEL_PROJECT_ID`
  - `VERCEL_ORG_ID`
- Production:
  - `VERCEL_PROJECT_ID`
  - `VERCEL_ORG_ID`
