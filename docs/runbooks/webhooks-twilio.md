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

## Outbound Pipeline Verification (Staging, CLI Only)

Use this flow to prove:
- outbound job insertion works
- runner executes exactly once
- `sms_messages` gets an encrypted outbound row with correlation + Twilio SID
- Twilio status callback updates `status` and `last_status_at`

Required shell env vars (names only):
- `STAGING_DB_URL`
- `TEST_TO_E164`
- `SMS_BODY_ENCRYPTION_KEY`
- `QSTASH_RUNNER_SECRET`

1. Insert one outbound job (exact SQL):

```bash
read -r JOB_ID CORRELATION_ID IDEMPOTENCY_KEY <<<"$(psql "$STAGING_DB_URL" -X -A -t \
  -v ON_ERROR_STOP=1 \
  -v to_e164="$TEST_TO_E164" \
  -v enc_key="$SMS_BODY_ENCRYPTION_KEY" <<'SQL'
with prepared as (
  select
    gen_random_uuid() as correlation_id,
    format('ticket_2_3:%s', to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')) as idempotency_key,
    public.encrypt_sms_body('Ticket 2.3 outbound runner verification', :'enc_key') as body_ciphertext
)
insert into public.sms_outbound_jobs (
  user_id,
  to_e164,
  from_e164,
  body_ciphertext,
  body_iv,
  body_tag,
  key_version,
  purpose,
  status,
  correlation_id,
  idempotency_key,
  run_at
)
select
  null,
  :'to_e164',
  null,
  prepared.body_ciphertext,
  null,
  null,
  1,
  'ticket_2_3_verification',
  'pending',
  prepared.correlation_id,
  prepared.idempotency_key,
  now()
from prepared
returning id, correlation_id, idempotency_key;
SQL
)"

echo "JOB_ID=$JOB_ID"
echo "CORRELATION_ID=$CORRELATION_ID"
echo "IDEMPOTENCY_KEY=$IDEMPOTENCY_KEY"
```

2. Trigger runner manually:

```bash
curl -sS -X POST \
  -H "x-runner-secret: ${QSTASH_RUNNER_SECRET}" \
  "https://rcqlnfywwfsixznrmzmv.supabase.co/functions/v1/twilio-outbound-runner?limit=1"
```

3. Verify outbound message row + encryption fields:

```bash
psql "$STAGING_DB_URL" -X -v ON_ERROR_STOP=1 -v corr_id="$CORRELATION_ID" <<'SQL'
select
  id,
  direction,
  twilio_message_sid,
  correlation_id,
  status,
  last_status_at,
  (body_ciphertext is not null) as has_body_ciphertext,
  (body_iv is not null) as has_body_iv,
  (body_tag is not null) as has_body_tag,
  key_version,
  created_at
from public.sms_messages
where correlation_id = :'corr_id'::uuid
  and direction = 'out'
order by created_at desc
limit 1;
SQL
```

4. Re-run runner to prove no duplicate sends:

```bash
curl -sS -X POST \
  -H "x-runner-secret: ${QSTASH_RUNNER_SECRET}" \
  "https://rcqlnfywwfsixznrmzmv.supabase.co/functions/v1/twilio-outbound-runner?limit=1"

psql "$STAGING_DB_URL" -X -A -t -v ON_ERROR_STOP=1 -v corr_id="$CORRELATION_ID" <<'SQL'
select count(*)
from public.sms_messages
where correlation_id = :'corr_id'::uuid
  and direction = 'out';
SQL
```

5. Poll until callback updates delivery status:

```bash
for i in {1..30}; do
  psql "$STAGING_DB_URL" -X -v ON_ERROR_STOP=1 -v corr_id="$CORRELATION_ID" <<'SQL'
select
  m.twilio_message_sid,
  m.status as message_status,
  m.last_status_at as message_last_status_at,
  j.status as job_status,
  j.last_status_at as job_last_status_at
from public.sms_messages m
left join public.sms_outbound_jobs j on j.twilio_message_sid = m.twilio_message_sid
where m.correlation_id = :'corr_id'::uuid
  and m.direction = 'out'
order by m.created_at desc
limit 1;
SQL
  sleep 10
done
```

## Outbound Status Reconciliation (Staging, CLI Only)

Use this flow to prove the reconciliation job can self-heal a stale outbound row by
refreshing the status from Twilio's Messages API.

Required shell env vars (names only):
- `STAGING_DB_URL`
- `CRON_SECRET`

1. Choose a real Twilio SID from a prior staging send:

```bash
psql "$STAGING_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
select
  twilio_message_sid,
  status,
  last_status_at,
  created_at
from public.sms_messages
where direction = 'out'
  and twilio_message_sid is not null
order by created_at desc
limit 10;
SQL
```

Pick one `twilio_message_sid` from the output and export it:

```bash
export TWILIO_MESSAGE_SID="SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

2. Force it to look stale (do not invent SIDs):

```bash
psql "$STAGING_DB_URL" -X -v ON_ERROR_STOP=1 -v sid="$TWILIO_MESSAGE_SID" <<'SQL'
update public.sms_messages
set
  status = coalesce(status, 'sent'),
  last_status_at = now() - interval '1 day'
where twilio_message_sid = :'sid';

select twilio_message_sid, status, last_status_at
from public.sms_messages
where twilio_message_sid = :'sid'
  and direction = 'out'
order by created_at desc
limit 1;
SQL
```

3. Invoke reconcile route (should update at least 1 row):

```bash
curl -i -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "https://josh-2-0-staging.vercel.app/api/cron/reconcile-outbound?limit=25&stale_minutes=15"
```

4. Verify DB updated (status and last_status_at advanced):

```bash
psql "$STAGING_DB_URL" -X -v ON_ERROR_STOP=1 -v sid="$TWILIO_MESSAGE_SID" <<'SQL'
select twilio_message_sid, status, last_status_at
from public.sms_messages
where twilio_message_sid = :'sid'
  and direction = 'out'
order by created_at desc
limit 1;
SQL
```

5. Idempotency proof (re-run immediately; `updated=0` expected):

```bash
curl -i -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "https://josh-2-0-staging.vercel.app/api/cron/reconcile-outbound?limit=25&stale_minutes=15"
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
