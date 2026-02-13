# Twilio Webhooks Runbook — JOSH 2.0

This runbook covers inbound SMS and status callback wiring.
All webhook requests must pass signature validation.

## Endpoints

- Inbound SMS webhook: `https://<supabase-project-ref>.supabase.co/functions/v1/twilio-inbound`
- Status callback webhook: `https://<vercel-base-url>/api/webhooks/twilio/status`

## Required Env Vars (Names Only)

- `TWILIO_AUTH_TOKEN`
- `TWILIO_STATUS_CALLBACK_URL`
- `PROJECT_REF`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Twilio Dashboard Configuration

### Messaging Service -> Inbound Settings

- [ ] Request URL points to `/functions/v1/twilio-inbound`
- [ ] Method: `HTTP POST`

### Messaging Service -> Status Callback

- [ ] Callback URL points to `/api/webhooks/twilio/status`
- [ ] Method: `HTTP POST`
- [ ] Apply to the staging Messaging Service first
- [ ] Promote to production only after staging verification

## Verification (Local)

Negative signature tests (expected failures):

1. Missing signature returns `401`:

```bash
curl -i -X POST \
  -H "content-type: application/x-www-form-urlencoded" \
  --data "MessageSid=SM_TEST_1&MessageStatus=sent" \
  http://127.0.0.1:3000/api/webhooks/twilio/status
```

2. Invalid signature returns `403`:

```bash
curl -i -X POST \
  -H "content-type: application/x-www-form-urlencoded" \
  -H "x-twilio-signature: invalid" \
  --data "MessageSid=SM_TEST_2&MessageStatus=delivered" \
  http://127.0.0.1:3000/api/webhooks/twilio/status
```

## Verification (Staging)

1. Confirm Twilio status callback URL points to staging Vercel URL.
2. Trigger an outbound SMS from staging.
3. Confirm callback rows exist in `sms_status_callbacks`.
4. Confirm `sms_messages.status` and `sms_outbound_jobs.status` advanced without regression.
5. Replay the same callback payload (or rely on Twilio retry) and confirm no duplicate history row.

## Expected DB Outcomes

- New callback history row in `sms_status_callbacks`
- `sms_messages.status` advances in-order only
- `sms_outbound_jobs.status` advances in-order only
- Duplicate callback retries do not create duplicate history rows
