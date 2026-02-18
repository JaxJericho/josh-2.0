# LinkUp Coordination Messages E2E Proof (Ticket 7.3)

This runbook proves lock-time LinkUp coordination messaging in staging:

- lock transition creates durable per-member coordination intents
- idempotent enqueue into `sms_outbound_jobs`
- replay safety (no duplicate jobs/messages on re-run)
- coordination status evidence (`pending`/`enqueued`/`sent`/`failed`/`suppressed`)

## Preconditions

- `STAGING_DB_DSN` (or `STAGING_DB_URL`) is available in shell or `.env.local`.
- `SMS_BODY_ENCRYPTION_KEY` is available in shell or `.env.local`.
- Migration `supabase/migrations/20260218143000_ticket_7_3_linkup_coordination_messages.sql` is applied to staging.

## 1) Apply migration (staging)

```bash
STAGING_DB_DSN=$(sed -n 's/^STAGING_DB_DSN=//p' .env.local | head -n 1); \
STAGING_DB_DSN=${STAGING_DB_DSN%\"}; \
STAGING_DB_DSN=${STAGING_DB_DSN#\"}; \
supabase db push --db-url "$STAGING_DB_DSN"
```

## 2) Seed or reuse a locked LinkUp

```bash
pnpm run verify:coordination:seed
```

Expected output includes:

- `linkup_id=<uuid>`
- `member_count=<n>`
- `lock_version=<n>`
- `locked_at=<timestamp>`

## 3) Run coordination enqueue + replay proof

```bash
pnpm run verify:coordination:e2e -- --linkup-id <LINKUP_ID>
```

Expected output includes:

- `linkup_id=<uuid>`
- `member_count=<n>`
- `coordination_created_count=<n>`
- `coordination_existing_count=<n>`
- `jobs_inserted_replay=0`
- `idempotent_replay=true`

Note:

- If Twilio delivery is not exercised in staging, `status_enqueued` is sufficient proof for this ticket.
- Do not claim `sent` unless outbound runner + Twilio callback actually executed.

## 4) SQL verification queries

Replace `<LINKUP_ID>` with the script output.

### 4.1 Locked LinkUp exists

```sql
select id, state, locked_at, lock_version
from public.linkups
where id = '<LINKUP_ID>'::uuid;
```

### 4.2 One coordination intent per locked member

```sql
select
  (select count(*) from public.linkup_members where linkup_id = '<LINKUP_ID>'::uuid and status = 'confirmed') as confirmed_members,
  (select count(*) from public.linkup_coordination_messages where linkup_id = '<LINKUP_ID>'::uuid) as coordination_rows;
```

### 4.3 Replay does not duplicate jobs

```sql
select
  count(*) as coordination_jobs
from public.sms_outbound_jobs jobs
where jobs.purpose = 'linkup_coordination'
  and exists (
    select 1
    from public.linkup_coordination_messages cm
    where cm.linkup_id = '<LINKUP_ID>'::uuid
      and cm.sms_outbound_job_id = jobs.id
  );
```

Run query 4.3 before and after replay; the count must stay unchanged.

### 4.4 Coordination statuses and errors

```sql
select status, coalesce(suppress_reason, '') as suppress_reason, count(*) as count
from public.linkup_coordination_messages
where linkup_id = '<LINKUP_ID>'::uuid
group by status, suppress_reason
order by status, suppress_reason;
```

```sql
select
  cm.user_id,
  cm.status,
  cm.idempotency_key,
  cm.sms_outbound_job_id,
  jobs.status as job_status,
  jobs.last_error
from public.linkup_coordination_messages cm
left join public.sms_outbound_jobs jobs
  on jobs.id = cm.sms_outbound_job_id
where cm.linkup_id = '<LINKUP_ID>'::uuid
order by cm.created_at, cm.user_id;
```

### 4.5 Uniqueness constraints exist

```sql
select conname
from pg_constraint
where conrelid = 'public.linkup_coordination_messages'::regclass
  and conname in (
    'linkup_coordination_messages_once_per_lock',
    'linkup_coordination_messages_idempotency_uniq'
  )
order by conname;
```
