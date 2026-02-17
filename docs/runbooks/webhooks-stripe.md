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

## Signature Failure Smoke Check

Without a Stripe signature header, the route must fail with `400` (not `404`):

```bash
curl -i -X POST http://localhost:3000/api/stripe/webhook \
  -H "content-type: application/json" \
  -d "{}"
```

## Important Note About Signing Secrets

The Stripe CLI creates its own ephemeral signing secret. It is different from the dashboard endpoint signing secret used in Vercel staging/production.
