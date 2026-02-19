# Staging Onboarding E2E Runbook

This runbook is the manual fallback for `scripts/admin/staging_reset_waitlist_activate_and_verify.mjs`.

Project and test fixture used here:

- Supabase project ref: `rcqlnfywwfsixznrmzmv`
- User ID: `221956bd-c214-4e61-bb95-223d2136b60a`
- Phone: `+19073159859`
- Waitlist region ID: `aedb39cc-f6e1-4b8d-82e8-8c5ff33d47a5`
- Waitlist region slug: `waitlist`
- Eligible statuses (from `supabase/functions/_shared/waitlist/admin-waitlist-batch-notify.ts`): `waiting`, `onboarded`

## Prerequisites

Export these environment variables:

```bash
export SUPABASE_URL="https://rcqlnfywwfsixznrmzmv.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="..."
export QSTASH_RUNNER_SECRET="..."
```

Use a Postgres connection for staging as `STAGING_DB_URL` when running SQL manually.

## 1) Reset User State

```sql
begin;

delete from public.profile_events
where user_id = '221956bd-c214-4e61-bb95-223d2136b60a';

delete from public.sms_messages
where user_id = '221956bd-c214-4e61-bb95-223d2136b60a';

do $$
begin
  if to_regclass('public.sms_outbound_jobs') is not null then
    delete from public.sms_outbound_jobs
    where user_id = '221956bd-c214-4e61-bb95-223d2136b60a';
  end if;
end
$$;

delete from public.conversation_sessions
where user_id = '221956bd-c214-4e61-bb95-223d2136b60a';

delete from public.profiles
where user_id = '221956bd-c214-4e61-bb95-223d2136b60a';

commit;
```

Verify reset counts are zero before activation:

```sql
select
  (select count(*) from public.conversation_sessions where user_id = '221956bd-c214-4e61-bb95-223d2136b60a') as conversation_sessions_count,
  (select count(*) from public.sms_messages where user_id = '221956bd-c214-4e61-bb95-223d2136b60a') as sms_messages_count,
  (select count(*) from public.profiles where user_id = '221956bd-c214-4e61-bb95-223d2136b60a') as profiles_count,
  (select count(*) from public.profile_events where user_id = '221956bd-c214-4e61-bb95-223d2136b60a') as profile_events_count,
  (select count(*) from public.sms_outbound_jobs where user_id = '221956bd-c214-4e61-bb95-223d2136b60a') as sms_outbound_jobs_count;
```

## 2) Ensure `waitlist_entries` Eligibility

Use an eligible status from the shared constant list. This runbook uses `waiting`.

```sql
with ensured_profile as (
  insert into public.profiles (user_id)
  values ('221956bd-c214-4e61-bb95-223d2136b60a')
  on conflict (user_id) do update set updated_at = now()
  returning id
),
resolved_profile as (
  select id from ensured_profile
  union all
  select p.id from public.profiles p where p.user_id = '221956bd-c214-4e61-bb95-223d2136b60a'
  limit 1
)
insert into public.waitlist_entries (
  user_id,
  profile_id,
  region_id,
  status,
  source,
  joined_at,
  created_at,
  last_notified_at,
  notified_at,
  activated_at
)
select
  '221956bd-c214-4e61-bb95-223d2136b60a',
  rp.id,
  'aedb39cc-f6e1-4b8d-82e8-8c5ff33d47a5',
  'waiting',
  'sms',
  '1970-01-01T00:00:00.000Z'::timestamptz,
  '1970-01-01T00:00:00.000Z'::timestamptz,
  null,
  null,
  null
from resolved_profile rp
on conflict (user_id, region_id) do update
set
  profile_id = excluded.profile_id,
  status = 'waiting',
  last_notified_at = null,
  notified_at = null,
  activated_at = null,
  joined_at = '1970-01-01T00:00:00.000Z'::timestamptz,
  created_at = '1970-01-01T00:00:00.000Z'::timestamptz,
  updated_at = now();
```

Verify selectable state:

```sql
select
  id,
  user_id,
  profile_id,
  region_id,
  status,
  created_at,
  last_notified_at,
  notified_at,
  activated_at
from public.waitlist_entries
where user_id = '221956bd-c214-4e61-bb95-223d2136b60a'
  and region_id = 'aedb39cc-f6e1-4b8d-82e8-8c5ff33d47a5';
```

## 3) Call Canonical Activation Function

Body keys must match `parseWaitlistBatchNotifyRequest()` exactly.

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/admin-waitlist-batch-notify" \
  -H "Content-Type: application/json" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "x-admin-secret: $QSTASH_RUNNER_SECRET" \
  --data '{"region_slug":"waitlist","limit":1,"dry_run":false,"open_region":false,"notification_template_version":"v1"}'
```

Expected response fields to inspect:

- `selected_count`
- `claimed_count`
- `sent_count`
- `errors`

## 4) Verify Activation + Onboarding

Verify waitlist status/timestamps:

```sql
select
  status,
  activated_at,
  notified_at,
  last_notified_at
from public.waitlist_entries
where user_id = '221956bd-c214-4e61-bb95-223d2136b60a'
  and region_id = 'aedb39cc-f6e1-4b8d-82e8-8c5ff33d47a5';
```

Verify conversation session and onboarding state token:

```sql
select
  id,
  mode,
  state_token,
  created_at
from public.conversation_sessions
where user_id = '221956bd-c214-4e61-bb95-223d2136b60a';
```

Expected first onboarding token (from `packages/core/src/onboarding/onboarding-engine.ts`):

- `onboarding:awaiting_opening_response`

Verify outbound onboarding rows persisted after activation:

```sql
with activation as (
  select activated_at
  from public.waitlist_entries
  where user_id = '221956bd-c214-4e61-bb95-223d2136b60a'
    and region_id = 'aedb39cc-f6e1-4b8d-82e8-8c5ff33d47a5'
)
select count(*) as outbound_sms_since_activation
from public.sms_messages m
cross join activation a
where m.user_id = '221956bd-c214-4e61-bb95-223d2136b60a'
  and m.direction = 'out'
  and m.created_at >= a.activated_at;
```

## Troubleshooting

### `selected_count = 0`

- Confirm the row is selectable:
  - `status in ('waiting','onboarded')`
  - `last_notified_at is null`
  - `region_id = 'aedb39cc-f6e1-4b8d-82e8-8c5ff33d47a5'`
- Check competing eligible rows selected earlier by ordering:

```sql
select id, user_id, status, created_at, last_notified_at
from public.waitlist_entries
where region_id = 'aedb39cc-f6e1-4b8d-82e8-8c5ff33d47a5'
  and status in ('waiting','onboarded')
  and last_notified_at is null
order by created_at asc, id asc
limit 10;
```

### No conversation session created

- Confirm a profile exists for the user:

```sql
select id, user_id
from public.profiles
where user_id = '221956bd-c214-4e61-bb95-223d2136b60a';
```

- Confirm no active safety hold blocks onboarding:

```sql
select id, status, hold_type, expires_at
from public.safety_holds
where user_id = '221956bd-c214-4e61-bb95-223d2136b60a'
  and status = 'active';
```

- Re-check function response `errors`.

### No `sms_messages` inserted

- Check function response `errors` for send/enqueue failures.
- Verify required edge-function env vars in staging are present:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`
  - `SMS_BODY_ENCRYPTION_KEY`
- Verify outbound jobs/messages around activation time:

```sql
select id, direction, status, created_at, twilio_message_sid
from public.sms_messages
where user_id = '221956bd-c214-4e61-bb95-223d2136b60a'
order by created_at desc
limit 20;
```
