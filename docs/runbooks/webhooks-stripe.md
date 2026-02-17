# Stripe Webhook Runbook

This runbook covers local and staging verification for:

- `POST /api/stripe/webhook`
- App Router handler at `app/api/stripe/webhook/route.ts`

## Local Testing With Stripe CLI

1. Ensure env vars are set in local runtime:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET` (must come from Stripe CLI output in this flow)
2. Start the app:

```bash
pnpm dev
```

3. In a second terminal, start Stripe CLI forwarding:

```bash
stripe listen --forward-to http://localhost:3000/api/stripe/webhook
```

4. Copy the CLI-provided webhook signing secret (`whsec_...`) and set it as `STRIPE_WEBHOOK_SECRET` for your local app.
5. Trigger a test event:

```bash
stripe trigger payment_intent.succeeded
```

Expected result: webhook route returns `200` with `ok: true`.

## Ingestion + Idempotency Verification

After `stripe trigger checkout.session.completed`, verify the event was persisted and marked processed.

1. Capture the Stripe event id from CLI output (`evt_...`).
2. Query `public.stripe_events`:

```bash
psql "$STAGING_DB_DSN" -X -A -F '|' -t -c \
  "select event_id,event_type,processed_at,processing_error from public.stripe_events where event_id='evt_xxx';"
```

Expected result:

- one row returned
- `processed_at` is non-null
- `processing_error` is null

Replay check:

1. Re-send the same event from Stripe CLI (`stripe events resend <event_id>`).
2. Confirm row count remains `1`:

```bash
psql "$STAGING_DB_DSN" -X -A -t -c \
  "select count(*) from public.stripe_events where event_id='evt_xxx';"
```

Expected result: `1` (duplicate webhook acknowledged without inserting another row).

## Signature Failure Smoke Check

Without a Stripe signature header, the route must fail with `400` (not `404`):

```bash
curl -i -X POST http://localhost:3000/api/stripe/webhook \
  -H "content-type: application/json" \
  -d "{}"
```

## Important Note About Signing Secrets

The Stripe CLI creates its own ephemeral signing secret. It is different from the dashboard endpoint signing secret used in Vercel staging/production.
