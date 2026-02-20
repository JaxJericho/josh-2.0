# QStash Onboarding Scheduler Runbook

## Purpose

Operate, debug, replay, and safely disable the onboarding scheduler introduced in Phase 8B.

## Architecture Overview

- Onboarding burst delivery runs as a one-step-per-execution loop.
- A trigger schedules exactly one step (`onboarding_message_1`) and each step schedules only the next step.
- `conversation_sessions.state_token` is the source of truth for progression and stale-step rejection.
- Step idempotency key format is:
  - `onboarding:{profile_id}:{session_id}:{step_id}`
- Invariants:
  - Never enqueue multi-step onboarding bursts.
  - Never use in-process sleep for onboarding pacing.
  - Use QStash delay for step timing.

## Required Environment Variables

- `QSTASH_TOKEN`
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`

## Manual Replay (Staging)

### 1) Build replay payload

Use the original session/profile/step values:

```json
{
  "profile_id": "<profile_id>",
  "session_id": "<session_id>",
  "step_id": "onboarding_message_2",
  "expected_state_token": "onboarding:awaiting_burst",
  "idempotency_key": "onboarding:<profile_id>:<session_id>:onboarding_message_2"
}
```

### 2) POST to `/api/onboarding/step`

Staging replay route call (safe operator path):

```bash
curl -i -X POST "https://josh-2-0-staging.vercel.app/api/onboarding/step" \
  -H "content-type: application/json" \
  -H "x-harness-qstash-stub: 1" \
  -H "x-admin-secret: $STAGING_RUNNER_SECRET" \
  --data @payload.json
```

### 3) Interpret response safely

- `200 {"ok":true}` means the step executed.
- `200 {"ok":true,"skipped":true,"reason":"already_sent"}` means replay was deduplicated by idempotency.
- Replaying the same payload is safe: idempotency key and message persistence prevent duplicate outbound sends.

### 4) Reset `state_token` for re-initiation (only when operationally required)

If a session is stuck, reset state deliberately:

```sql
update conversation_sessions
set state_token = 'onboarding:awaiting_opening_response'
where id = '<session_id>';
```

Then re-trigger onboarding through the normal activation path. Do not run schema changes or migrations for replay operations.

## Safe Disable Procedure (Staging)

Preferred approach is scheduler short-circuiting in `scheduleOnboardingStep`:

- Set `ONBOARDING_SCHEDULING_DISABLED=1` in:
  - Vercel staging env (Next.js scheduler path)
  - Supabase staging function secrets (inbound onboarding engine scheduler path)
- Behavior with flag enabled:
  - Onboarding scheduling returns early and does not publish new QStash messages.
  - Existing already-published QStash messages can still execute.

Re-enable by setting `ONBOARDING_SCHEDULING_DISABLED=0` (or unsetting it) in both locations.

## Delivery Timing Verification

Use ordered `sms_messages` rows for the user and inspect timestamp gaps:

```sql
select
  created_at,
  correlation_id,
  status,
  twilio_message_sid
from sms_messages
where user_id = '<user_id>'
  and correlation_id like 'onboarding:%'
order by created_at asc;
```

Expected burst timing:

- `onboarding_message_1` to `onboarding_message_2`: about 8 seconds (allow scheduler variance, not sub-second exactness).
- `onboarding_message_2` to `onboarding_message_3`: about 8 seconds.
- `onboarding_message_4` is scheduled with zero delay after message 3 state advancement.
