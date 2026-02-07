# Secrets And Rotation — JOSH 2.0

This runbook defines safe handling, rotation, and verification practices for secrets.
It must never include secret values.

## Non-Negotiable Rules

- Never print or log secret values.
- When verifying secrets, only report: set/unset, length, sha256 prefix (first 8).
- Never paste secrets into PRs, docs, issues, or logs.
- If a secret is exposed, rotate it immediately and document the rotation steps.

## Where Secrets Live

- Local: shell env or `.env.local` (do not commit)
- Staging/Production: platform environment configuration

## Verification Workflow (Safe)

Use the fingerprint script to confirm which token is active without exposing values:

```bash
pnpm env:fingerprint
```

Expected output:
- `is_set` true/false
- `length`
- `sha256_8` prefix

## Rotation Checklist (Names Only)

1. Identify the affected env vars (names only).
2. Rotate secrets in the authoritative platform.
3. Update local `.env.local` if applicable.
4. Run `pnpm env:fingerprint` to confirm the new fingerprints.
5. Record the change in the PR (names only, no values).

## Recommended Fingerprint Set

- Scheduler / Runner:
  - `CRON_SECRET`
  - `LOCAL_RUNNER_SECRET`
  - `STAGING_RUNNER_SECRET`
  - `PRODUCTION_RUNNER_SECRET`
- Supabase:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `PROJECT_REF`
- Twilio:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_MESSAGING_SERVICE_SID`
  - `TWILIO_FROM_NUMBER`
  - `TWILIO_STATUS_CALLBACK_URL`
- SMS:
  - `SMS_BODY_ENCRYPTION_KEY`
- Stripe:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
