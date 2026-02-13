# Environment Variables — JOSH 2.0

This document defines the required environment variables for JOSH 2.0
and the rules governing their usage.

No database or infrastructure work may begin before this is defined.

---

## Variable Categories

### Public (Build-Time)

- Exposed to the client
- Safe to embed in builds
- Never contain secrets

Example:

- NEXT*PUBLIC*\*

---

### Server Runtime

- Available only on the server
- Required for application logic
- May include credentials

---

### Secrets

- Never committed
- Never logged
- Supplied only via environment configuration

---

## Environment Variable Rules

- No environment variable is shared across environments
- Local variables must never point to staging or production
- Production secrets must never exist on developer machines
- `.env.example` documents required variables only

---

## Required Variables (By Category)

### Database

- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY

---

### SMS / Messaging

- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_MESSAGING_SERVICE_SID
- TWILIO_FROM_NUMBER
- TWILIO_STATUS_CALLBACK_URL
- QSTASH_CURRENT_SIGNING_KEY
- QSTASH_NEXT_SIGNING_KEY
- QSTASH_RUNNER_SECRET
- QSTASH_AUTH_DEBUG
- SMS_BODY_ENCRYPTION_KEY
- PROJECT_REF

Notes:

- `SMS_BODY_ENCRYPTION_KEY` is the passphrase used by pgcrypto (`pgp_sym_encrypt`) for SMS body encryption.
- `PROJECT_REF` is required for Twilio signature validation when `x-forwarded-host` is missing.
- `TWILIO_FROM_NUMBER` is required if `TWILIO_MESSAGING_SERVICE_SID` is not set.
- `TWILIO_STATUS_CALLBACK_URL` must point to the active status callback endpoint (recommended: `https://<vercel-base-url>/api/webhooks/twilio/status`).
- `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` are used to verify QStash signatures (supporting key rotation).
- `QSTASH_RUNNER_SECRET` is required for body-token auth when signature headers are missing.
- `QSTASH_AUTH_DEBUG` is an optional temporary flag; set to `1` to include auth diagnostics in 401 responses from the outbound runner.

Deprecated:

- `QSTASH_RUNNER_SECRET` is no longer used as an `x-runner-secret` header; schedules must not send that header.

---

### Payments

- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET

---

### Deployment

- VERCEL_PROJECT_ID
- VERCEL_ORG_ID

---

## Observability (Sentry)

### Server Runtime

- SENTRY_DSN
- SENTRY_ENVIRONMENT

### Public (Build-Time)

- NEXT_PUBLIC_SENTRY_DSN

---

## Local Development Rules

- Local uses sandbox credentials only
- Local `.env` files are ignored by Git
- `.env.example` must never contain real values

---

## Non-Negotiable Rule

If an environment variable’s scope or safety is unclear,
it must not be introduced.
