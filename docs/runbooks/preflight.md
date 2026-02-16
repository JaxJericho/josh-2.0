# Preflight Checklist - JOSH 2.0

Run this checklist before any deploy, webhook rewiring, or environment promotion.

## Required Commands

Run in this order:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm doctor
pnpm run doctor
```

All commands must be green before promotion.

Notes:
- `pnpm doctor` runs pnpm's built-in diagnostics.
- `pnpm run doctor` runs this repo's preflight script (`scripts/doctor.mjs`).
- `scripts/doctor.mjs` runs a Supabase connectivity probe when `SUPABASE_URL` and `SUPABASE_ANON_KEY`
  are set. Set `DOCTOR_REMOTE=1` to make connectivity failures fail the run (recommended for staging promotions).

## Staging Promotion Checklist (Staging Must Be Green Before Prod)

- [ ] `APP_ENV=staging` preflight run passes (`pnpm run doctor`).
- [ ] Build/test/lint/typecheck pass on the staging branch/commit.
- [ ] Staging base URL is healthy: `https://josh-2-0-staging.vercel.app`.
- [ ] Twilio inbound and status callback tests pass in staging.
- [ ] Stripe webhook test events process successfully in staging.
- [ ] No unresolved `FAIL` checks from doctor output.
- [ ] Promotion approval explicitly confirms staging is green.

Only after all staging items are complete:

- [ ] Promote to production.

## Webhook Wiring Checklist

### Twilio

- [ ] Staging inbound webhook points to staging destination(s).
- [ ] Staging status callback base uses `https://josh-2-0-staging.vercel.app`.
- [ ] Production webhook base uses `https://www.callmejosh.ai`.
- [ ] Production Vercel fallback URL is documented and available: `https://josh-2-0-production.vercel.app`.
- [ ] Signatures are validated (no bypass mode in production).

### Stripe

- [ ] Staging Stripe webhook endpoint uses staging base: `https://josh-2-0-staging.vercel.app`.
- [ ] Production Stripe webhook endpoint uses production customer base: `https://www.callmejosh.ai`.
- [ ] Production Vercel fallback URL is retained for incident response: `https://josh-2-0-production.vercel.app`.
- [ ] Stripe signing secret for each environment matches the configured endpoint.

## If Doctor Fails

1. Read the failing line and category from `pnpm run doctor` output.
2. For missing vars:
   - Set the variable in the correct environment target (local `.env.local`, Vercel env, or Supabase function secrets).
   - Re-run `pnpm run doctor`.
3. For URL format failures:
   - Fix malformed URLs (`https://...`) and remove query params from runner URLs.
4. For Supabase connectivity failures:
   - Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` belong to the same project.
   - Verify network reachability from the runtime where preflight is executed.
5. Re-run the full command sequence after fixes:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm run doctor
```
