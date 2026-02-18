# LinkUp Orchestration E2E Proof (Ticket 7.2)

This runbook proves the LinkUp orchestration state machine in staging:

- LinkUp creation from an eligible seed set
- wave-based invites
- accept/decline handling
- duplicate reply idempotency
- accept-after-lock deterministic handling
- quorum lock occurring exactly once

## Preconditions

- `STAGING_DB_DSN` is set (or present in `.env.local`).
- Migration `supabase/migrations/20260218120000_ticket_7_2_linkup_orchestration_state_machine.sql` is applied to staging.

## 1) Apply migration (staging)

Use the same pattern already used in this repo for staging DB push:

```bash
STAGING_DB_DSN=$(sed -n 's/^STAGING_DB_DSN=//p' .env.local | head -n 1); \
STAGING_DB_DSN=${STAGING_DB_DSN%\"}; \
STAGING_DB_DSN=${STAGING_DB_DSN#\"}; \
supabase db push --db-url "$STAGING_DB_DSN"
```

## 2) Seed deterministic LinkUp scenario

```bash
pnpm run verify:linkup:seed
```

Expected output includes:

- `linkup_id=<uuid>`
- `wave_1_invites=3`
- `outbound_jobs_queued=<n>`
- invite rows for wave 1

## 3) Run orchestration simulation

```bash
pnpm run verify:linkup:e2e
```

Simulated replies:

- candidate A accepts
- candidate B declines
- duplicate accept from candidate A
- duplicate webhook replay for same MessageSid
- candidate C accepts (replacement wave)
- candidate D accepts after lock

Expected proof lines include:

- `linkup_id=<uuid>`
- `locked_at=<timestamp>`
- `lock_event_count=1`
- `replacement_wave_created=true`
- `quorum_lock_once=true`
- `duplicate_accept_no_state_change=true`
- `late_accept_no_membership_change=true`
- `idempotent_replay=true`

## 4) SQL verification queries

Replace `<LINKUP_ID>` with script output.

### 4.1 LinkUp initial/terminal state

```sql
select id, state, waves_sent, max_waves, min_size, max_size, locked_at
from public.linkups
where id = '<LINKUP_ID>'::uuid;
```

### 4.2 Invites by wave and state

```sql
select wave_no, state, count(*) as count
from public.linkup_invites
where linkup_id = '<LINKUP_ID>'::uuid
group by wave_no, state
order by wave_no, state;
```

### 4.3 Members consistency

```sql
select role, status, count(*) as count
from public.linkup_members
where linkup_id = '<LINKUP_ID>'::uuid
group by role, status
order by role, status;
```

### 4.4 Quorum lock occurs once

```sql
select count(*) as locked_events
from public.linkup_events
where linkup_id = '<LINKUP_ID>'::uuid
  and event_type = 'locked';
```

### 4.5 Replacement wave after decline/timeout

```sql
select count(*) as wave_2_invites
from public.linkup_invites
where linkup_id = '<LINKUP_ID>'::uuid
  and wave_no = 2;
```

### 4.6 Reply-event idempotency and late-reply determinism

```sql
select parsed_reply, outcome, applied, count(*) as count
from public.linkup_invite_reply_events
where linkup_id = '<LINKUP_ID>'::uuid
group by parsed_reply, outcome, applied
order by parsed_reply, outcome, applied;
```

```sql
select invited_user_id, state, terminal_reason, response_message_sid
from public.linkup_invites
where linkup_id = '<LINKUP_ID>'::uuid
order by wave_no, created_at;
```
