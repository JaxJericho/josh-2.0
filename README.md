# JOSH 2.0

JOSH 2.0 is an SMS-first friendship matching system designed for correctness, safety, and long-term operational stability.

JOSH is not a chat app, a dating app, or a social feed. It is a **guided, stateful system** that helps people form real-world connections through intentional group experiences, with strict enforcement of consent, eligibility, and safety at every boundary.

---

## What JOSH Is

JOSH is a **deterministic product system with conversational surfaces**.

Core characteristics:

- SMS-first. The website and dashboard are supporting surfaces, not the core experience.
- State-driven. All user actions are governed by explicit state machines and contracts.
- Safety-forward. Safety rules override growth, engagement, and convenience.
- Explainable. Matching and learning behavior must be debuggable and bounded.

Correctness is prioritized over cleverness.

---

## What JOSH Is Not

JOSH is explicitly not:

- A real-time chat platform
- A social feed or community
- An opaque ML recommendation engine
- A therapeutic, coaching, or counseling system
- A free-form AI assistant

Any implementation that drifts toward these patterns is incorrect.

---

## Source Of Truth

The single source of truth for **system behavior** lives in:

- `docs/specs/josh-2.0/`
- `docs/architecture/`

---

## Twilio Inbound Webhook (Edge Function)

The inbound SMS webhook is implemented as a Supabase Edge Function.

High-level staging setup:

- In Twilio Console, set the Messaging Service inbound webhook URL to your staging function URL.
- Format: `https://<project-ref>.supabase.co/functions/v1/twilio-inbound`
- Ensure the environment variables listed below are set for the function.

---

## Required Env Vars (Edge Functions)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TWILIO_AUTH_TOKEN`
- `SMS_BODY_ENCRYPTION_KEY` (pgcrypto passphrase; keep secret and rotate via `key_version`)
- `PROJECT_REF` (Supabase project ref, required for Twilio signature validation)

---

## Local Replay Test (Inbound SMS Idempotency)

Run the replay script twice against the same `MessageSid` to confirm idempotency:

```bash
TWILIO_AUTH_TOKEN=... \
WEBHOOK_URL=http://127.0.0.1:54321/functions/v1/twilio-inbound \
MESSAGE_SID=SM00000000000000000000000000000001 \
node scripts/verify/twilio_inbound_replay.mjs
```

---

## Opt-Out Reconciliation (Deferred)

If a newly created or verified user’s `users.phone_e164` matches an existing
`sms_opt_outs.phone_e164`, the user must start in opted-out state
(`users.sms_consent = false`). Implement this reconciliation in the user
creation or OTP verification flow when that runtime exists.

---

## PSQL Verification Snippet

```sql
-- Idempotency: should be 1 for the MessageSid you replayed
select count(*) as inbound_count
from public.sms_messages
where twilio_message_sid = 'SM00000000000000000000000000000001';

-- Last 5 inbound messages
select created_at, from_e164, to_e164, twilio_message_sid
from public.sms_messages
where direction = 'in'
order by created_at desc
limit 5;

-- Opt-out status check
select sms_consent
from public.users
where phone_e164 = '+15555550111';

select opted_out_at
from public.sms_opt_outs
where phone_e164 = '+15555550111';
```
