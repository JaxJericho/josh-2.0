# Twilio Webhooks Runbook — JOSH 2.0

This runbook covers inbound SMS and status callback wiring.
All webhook requests must pass signature validation.

## Endpoints

- Staging inbound webhook:
  - `https://rcqlnfywwfsixznrmzmv.supabase.co/functions/v1/twilio-inbound`
- Staging status callback webhook:
  - `https://rcqlnfywwfsixznrmzmv.supabase.co/functions/v1/twilio-status-callback`

## Required Env Vars (Names Only)

- `TWILIO_AUTH_TOKEN`
- `TWILIO_STATUS_CALLBACK_URL` (recommended explicit override in outbound runner)
- `PROJECT_REF`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Twilio Dashboard Configuration

### Messaging Service -> Inbound Settings

- [ ] Request URL points to `/functions/v1/twilio-inbound`
- [ ] Method: `HTTP POST`

### Messaging Service -> Status Callback

- [ ] Callback URL points to `/functions/v1/twilio-status-callback`
- [ ] Method: `HTTP POST`
- [ ] Apply to the staging Messaging Service first
- [ ] Promote to production only after staging verification

## Verification (Staging)

Negative signature tests (expected failures, fail-closed):

1. Inbound missing signature returns `401`:

```bash
curl -i -X POST \
  -H "content-type: application/x-www-form-urlencoded" \
  --data "From=%2B15555550111&To=%2B15555550222&Body=hello&MessageSid=SM_TEST_1&NumMedia=0" \
  https://rcqlnfywwfsixznrmzmv.supabase.co/functions/v1/twilio-inbound
```

2. Status callback missing signature returns `401`:

```bash
curl -i -X POST \
  -H "content-type: application/x-www-form-urlencoded" \
  --data "MessageSid=SM_TEST_2&MessageStatus=sent" \
  https://rcqlnfywwfsixznrmzmv.supabase.co/functions/v1/twilio-status-callback
```

Signed replay tests (expected success):

1. Inbound signed replay (`200` expected):

```bash
TWILIO_AUTH_TOKEN="<twilio-auth-token>" \
node scripts/verify/twilio_inbound_replay.mjs \
  --mode inbound \
  --url "https://rcqlnfywwfsixznrmzmv.supabase.co/functions/v1/twilio-inbound" \
  --signature-url "https://rcqlnfywwfsixznrmzmv.supabase.co/functions/v1/twilio-inbound" \
  --expect-status 200
```

2. Status callback signed replay (`200` expected):

```bash
TWILIO_AUTH_TOKEN="<twilio-auth-token>" \
node scripts/verify/twilio_inbound_replay.mjs \
  --mode status \
  --url "https://rcqlnfywwfsixznrmzmv.supabase.co/functions/v1/twilio-status-callback" \
  --signature-url "https://rcqlnfywwfsixznrmzmv.supabase.co/functions/v1/twilio-status-callback" \
  --expect-status 200
```

If signed requests return `500` with `missing_env` in response JSON, set the missing Supabase Function secret first and redeploy.

Example for missing token on staging:

```bash
supabase secrets set \
  TWILIO_AUTH_TOKEN="<twilio-auth-token>" \
  PROJECT_REF="rcqlnfywwfsixznrmzmv" \
  --project-ref rcqlnfywwfsixznrmzmv

supabase functions deploy twilio-inbound --project-ref rcqlnfywwfsixznrmzmv
supabase functions deploy twilio-status-callback --project-ref rcqlnfywwfsixznrmzmv
```

## Verification (Local)

To test local functions explicitly, pass a local URL:

```bash
TWILIO_AUTH_TOKEN="<twilio-auth-token>" \
node scripts/verify/twilio_inbound_replay.mjs \
  --mode inbound \
  --url "http://127.0.0.1:54321/functions/v1/twilio-inbound" \
  --signature-url "http://127.0.0.1:54321/functions/v1/twilio-inbound" \
  --expect-status 200
```

## Expected DB Outcomes

- New callback history row in `sms_status_callbacks`
- `sms_messages.status` advances in-order only
- `sms_outbound_jobs.status` advances in-order only
- Duplicate callback retries do not create duplicate history rows

## Safety Note

- Webhooks must reject unsigned requests.
- Webhooks must accept correctly Twilio-signed requests.
- Do not disable signature verification as a workaround.

## Common Failure Modes

- `401 Unauthorized` with no signature header:
  - Expected fail-closed behavior.
- `403 Forbidden` with signature header:
  - Signature verification failed (wrong signing URL and/or wrong auth token).
- `500` with `missing_env` in JSON:
  - Function secret misconfiguration (for example missing `TWILIO_AUTH_TOKEN`).
