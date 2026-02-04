# Domain Model And State Machines (JOSH 2.0)

## *Document \#2*

## Summary

This document defines the “canonical nouns” of JOSH 2.0 (User, Profile, LinkUp, Invite, Subscription, Entitlement, Safety Hold) and how each one moves through its lifecycle. These lifecycles are the backbone of correctness: they prevent double-invites, mismatched dashboard states, and confusing SMS behavior when retries happen.

You can think of each state machine as a set of rules that answer: “Given what we know right now, what is the one correct next step?” When Twilio resends a webhook, when Stripe delivers a webhook twice, or when two workers run at the same time, these rules keep the system stable.

This spec is implementation-ready: it includes state definitions, transition guards, idempotency keys, rollback behavior, and decision trees.

---

## Scope, Out Of Scope, Deferred

### In Scope

* Domain entities required for registration → interview → LinkUp formation → lock → contact exchange.  
* State machines for User, Profile, LinkUp, Invite, Subscription and related enforcement objects.  
* Idempotency, concurrency handling, and retry-safe transitions.

### Out Of Scope

* Real-time participant chat or masked relay chat.  
* Multi-provider SMS support.  
* Machine-learning training pipelines beyond the MVP learning loop.

### Deferred

* Participant-hosted event templates.  
* Multi-step scheduling negotiation.

---

## Canonical Entities

### Naming Conventions

* IDs are opaque: `usr_…`, `pro_…`, `lub_…`, `inv_…`, `sub_…`.  
* “User” is the human; “Profile” is the compatibility representation.  
* Phone numbers are stored as both E.164 (for sending) and hashed (for joins/audits).

### Entity List

1. User  
2. Profile  
3. Conversation Session (conversation state pointer)  
4. LinkUp  
5. Invite (invitation to a LinkUp)  
6. Subscription  
7. Entitlements (derived access rights)  
8. Safety Hold (and strikes)  
9. Region (open vs waitlisted)  
10. Magic Link Session (dashboard access)

---

## User State Machine

### States

* `unverified` — user record exists, OTP not verified  
* `verified` — OTP verified, can receive interview messages  
* `interviewing` — in interview flow  
* `active` — interview complete and region open (may still be paywalled)  
* `suspended` — blocked from participation (safety hold or enforcement)  
* `deleted` — user requested deletion (soft-delete \+ retention policy)

### Transition Diagram

```
stateDiagram-v2
  [*] --> unverified
  unverified --> verified: otp_verified
  verified --> interviewing: entry_message_sent
  interviewing --> active: interview_completed
  active --> suspended: safety_hold_applied
  suspended --> active: hold_removed
  active --> deleted: delete_requested
  suspended --> deleted: delete_requested
```

### Transition Rules (Guards)

* `unverified → verified` requires:  
  * OTP token valid  
  * user age ≥ minimum (enforced at registration)  
  * consent flags present  
* `verified → interviewing` requires:  
  * region is open OR user has just been released from waitlist  
* `interviewing → active` requires:  
  * profile completeness minimum met (defined below)  
* `active → suspended` requires:  
  * safety incident escalation OR admin action OR automated abuse rule

### Idempotency

* OTP verification is idempotent by `(user_id, otp_session_id)`.  
* “Entry message sent” is idempotent by `entry_message_job_id`.

---

## Profile State Machine

A Profile is the structured output of the interview and later behavior updates.

### States

* `empty` — profile exists, no signals  
* `partial` — some interview dimensions complete  
* `complete_mvp` — minimum viable signals captured  
* `complete_full` — extended interview complete (optional)  
* `stale` — freshness decay indicates re-check-in needed (does not block participation)

### Completeness Criteria

Minimum viable (MVP) must include:

* Friend Fingerprint: 12 factors present with confidence values  
* Activities: at least 3 activities with motive weights  
* Hard boundaries (“no thanks”) captured (can be empty)  
* Group size preference band

(These come from your MVP compatibility spec.)

### Transition Diagram

```
stateDiagram-v2
  [*] --> empty
  empty --> partial: interview_step_saved
  partial --> complete_mvp: min_signals_met
  complete_mvp --> complete_full: extended_signals_met
  complete_mvp --> stale: freshness_decay
  complete_full --> stale: freshness_decay
  stale --> complete_mvp: revalidate_or_update
```

### Update Safety Rules

* Never swing any fingerprint factor strongly from a single message.  
* Confidence rises with corroborating evidence; decays slowly with time.  
* Contradictory behavior reduces confidence first, then value drifts gradually.

### Idempotency

* Each interview step write is idempotent by `(user_id, interview_step_id, message_sid)`.  
* Derived signal updates are idempotent by `profile_update_event_id`.

---

## Conversation Session State Machine

A Conversation Session is how SMS routing stays correct. It does not store “meaning,” only where to resume.

### Fields (Conceptual)

* `mode`: `idle | interviewing | linkup_forming | awaiting_invite_reply | safety_hold`  
* `state_token`: stable pointer to current step (e.g., `interview:step_07`)  
* `expires_at`: when this context should be ignored

### Rules

* STOP/HELP/START bypass session mode.  
* Safety keyword detection overrides everything and sets `mode = safety_hold` until cleared.  
* `awaiting_invite_reply` should prefer local parsing before LLM.

---

## LinkUp State Machine

A LinkUp is a one-time small group plan, formed within a 24-hour acceptance window.

### States

* `draft` — initiator intent captured, brief incomplete  
* `broadcasting` — invites are being sent in waves  
* `locked` — quorum met and plan confirmed  
* `completed` — event time passed, outcome capture done  
* `expired` — acceptance window ended without quorum  
* `canceled` — canceled by initiator/admin or quorum failed post-lock

### Timing Rules

* Acceptance window: 24 hours from `broadcasting_started_at`.  
* Lock occurs when:  
  * initiator \+ at least 1 other accepted, before expiry  
  * OR max size reached (10 total) before expiry

These match your LinkUp spec.

### Transition Diagram

```
stateDiagram-v2
  [*] --> draft
  draft --> broadcasting: brief_validated
  broadcasting --> locked: quorum_met
  broadcasting --> expired: window_elapsed
  locked --> canceled: quorum_breaks_and_replacement_fails
  locked --> completed: event_passed_and_outcomes_captured
  locked --> canceled: initiator_cancels
  broadcasting --> canceled: initiator_cancels
```

### Transition Guards

* `draft → broadcasting` requires:  
  * initiator eligible (subscription \+ not on hold \+ region open)  
  * LinkUp brief passes validation (see below)  
* `broadcasting → locked` requires:  
  * accepted\_count ≥ min\_quorum AND within acceptance window  
* `locked → completed` requires:  
  * event\_time \< now AND outcome prompts sent

### LinkUp Brief Validation

Minimum required:

* `activity_key`  
* `time_window` (choice-based A/B or named bucket)  
* `region_id`  
* group size band (default: min 2, max 6 unless user preference overrides)

Optional:

* motive emphasis (inferred)  
* constraints (quiet/outdoor)

### Replacement Rule (Bounded)

If a participant cancels after lock and quorum breaks:

* Attempt exactly one replacement wave  
* Set a short deadline (example: 2–4 hours)  
* If replacement fails: cancel LinkUp and notify all

### Idempotency And Concurrency

* Every LinkUp has a `lock_version` integer.  
* Lock transitions must be done in a single DB transaction:  
  * verify state \== broadcasting  
  * verify quorum  
  * update LinkUp state to locked  
  * mark remaining invites as `closed` (no longer actionable)

Idempotency keys:

* `linkup_create_key` \= `(initiator_user_id, normalized_brief_hash, created_date_bucket)`  
  * prevents accidental duplicate LinkUp creation from repeated user messages.  
* `invite_send_job_id` prevents double-sends.

Rollback behavior:

* If invite wave send partially fails, LinkUp stays `broadcasting`, and a retry only sends missing invites.

---

## Invite State Machine

An Invite represents one person’s chance to join one LinkUp.

### States

* `pending` — sent, awaiting reply  
* `accepted` — user said yes  
* `declined` — user said no  
* `expired` — acceptance window elapsed  
* `closed` — LinkUp locked or canceled; reply no longer changes membership

### Transition Diagram

```
stateDiagram-v2
  [*] --> pending
  pending --> accepted: user_accepts
  pending --> declined: user_declines
  pending --> expired: window_elapsed
  pending --> closed: linkup_locked_or_canceled
  accepted --> closed: linkup_locked
  declined --> closed: linkup_locked_or_canceled
  expired --> closed: linkup_canceled_or_archived
```

### Reply Parsing Rules

* If the invite offers A/B:  
  * `A` or `B` counts as accept and stores chosen window  
  * `No` counts as decline  
* If user replies with free text:  
  * attempt local parse (regex \+ synonyms)  
  * if ambiguous: one clarifier (“Reply A, B, or No”)

### Idempotency

* Invite response is idempotent by `(invite_id, twilio_message_sid)`.  
* Once invite is `closed`, do not change accepted/declined.

---

## Subscription And Entitlements State Machines

### Subscription States (Stripe-driven)

* `none`  
* `trialing` (optional)  
* `active`  
* `past_due`  
* `canceled`  
* `unpaid`

### Entitlement States (Derived)

Entitlements are what the product uses at enforcement points.

* `eligible_to_participate` (boolean)  
* `eligible_to_initiate` (boolean)  
* `grace_until` (timestamp, optional)

### State Rules

* If subscription is `active` → both eligible.  
* If `past_due` and within grace window → eligible (with warning).  
* If `canceled` or `unpaid` → not eligible.

### Idempotency

* Stripe webhook events idempotent by `stripe_event_id`.  
* Subscription updates applied via “last processed event time” guard.

---

## Safety Hold And Enforcement Ladder

### Safety Hold States

* `none`  
* `soft_hold` — can receive messages, cannot initiate/participate  
* `hard_hold` — no outbound beyond safety/legal templates

### Triggers

* Crisis keyword detection  
* Harassment reports  
* Repeated cancellations/no-shows (abuse guardrails)  
* Admin action

### Removal Rules

* Admin-only removal for hard holds.  
* Soft holds can expire automatically after review window.

---

## Decision Trees

### Decision Tree: Can User Initiate A LinkUp?

* If user state is `suspended` → deny  
* Else if region not open → deny (waitlist message)  
* Else if profile not `complete_mvp` → deny (resume interview)  
* Else if entitlement `eligible_to_initiate` false → deny (paywall)  
* Else → allow

### Decision Tree: What Happens When LinkUp Window Ends?

* If accepted\_count ≥ min\_quorum → lock  
* Else → expire and notify initiator honestly

### Decision Tree: Invite Reply After LinkUp Locked

* If invite state is `closed` → reply: “Already locked, you’re not in this one.”  
* Else process reply.

---

## Examples

### Example: LinkUp Lifecycle (Happy Path)

1. User texts: “Coffee Saturday morning?”  
2. LinkUp created in `draft`  
3. Brief validated → `broadcasting`  
4. Invite wave 1 (5 candidates)  
5. Two accept → quorum met → `locked`  
6. Reminder morning-of  
7. After event: attendance confirmation prompt  
8. Contact exchange via dashboard  
9. LinkUp marked `completed`

### Example: Race Condition (Two Workers Try To Lock)

* Worker A and Worker B both see accepted\_count \== 2\.  
* Both attempt lock.  
* DB transaction checks `state == broadcasting AND lock_version == X`.  
* Only one succeeds; the other gets 0 rows updated and exits.

---

## Key Decisions

1. Separate Subscription from Entitlements  
   * Trade-off: more tables and syncing logic.  
   * Benefit: product logic stays stable even if Stripe statuses change.  
2. Conversation Session is a pointer, not a transcript  
   * Trade-off: less raw context stored.  
   * Benefit: privacy-first and simpler routing logic.  
3. LinkUp lock is transaction-protected  
   * Trade-off: requires careful DB design.  
   * Benefit: prevents double-lock/double-invite outcomes.  
4. Bounded replacement wave  
   * Trade-off: some LinkUps cancel rather than endlessly recruiting.  
   * Benefit: trust and clarity; no negotiation spirals.

---

## Dependencies

* Document 1: service boundaries and external contracts.  
* Document 3: DB schema must implement these states and version guards.  
* Document 4: intent detection thresholds and clarifier contract.  
* Document 11: entitlement enforcement definitions.  
* Document 13: safety triggers and admin workflows.

---

## Risks And Mitigation

1. State drift between SMS and dashboard  
   * Mitigation: DB is the source of truth; outbound messages reference current DB state.  
2. Invite reply confusion (A/B vs free text)  
   * Mitigation: local parsing first, then one clarifier, then proceed.  
3. Payment webhook delays cause incorrect gating  
   * Mitigation: optimistic unlock after checkout session completion (with verification), plus webhook reconciliation.

---

## Testing Approach

### Unit Tests

* State transition guard functions for each entity.  
* Invite parsing rules.  
* Entitlement derivation logic.

### Integration Tests

* Lock transaction concurrency test (two lock attempts).  
* Stripe webhook idempotency (duplicate event).  
* Twilio webhook duplication (same MessageSid).

### E2E Scenarios

* Full interview → LinkUp formation → lock → cancel after lock → replacement wave.  
* Past due subscription within grace → allowed, with warning.  
* Safety keyword hit during interview → hold \+ safe reply.

---

## Production Readiness

### 1\) Infrastructure Setup

This document’s production readiness is primarily about safe concurrency and idempotency persistence.

* Ensure Postgres has:  
  * transactional locking support (default)  
  * appropriate indexes on idempotency keys  
  * RLS policies that do not block service-role transitions

### 2\) Environment Parity

* Staging must run the same state transitions and timing windows.  
* Use separate Twilio numbers so lock/invite behaviors are tested realistically.

### 3\) Deployment Procedure

* Deploy DB migrations first (state enums/constraints).  
* Deploy web app next.  
* Run a staging rehearsal that exercises:  
  * webhook duplication  
  * lock concurrency  
  * subscription webhook replay

### 4\) Wiring Verification

* Trigger a synthetic “duplicate inbound” test:  
  * replay the same Twilio payload twice  
  * verify only one state transition occurs  
* Trigger a synthetic “duplicate Stripe event” test:  
  * replay the same Stripe event  
  * verify entitlements unchanged after first application

### 5\) Operational Readiness

* Every state transition must write a domain event/audit row:  
  * entity  
  * from\_state  
  * to\_state  
  * reason  
  * correlation\_id  
  * idempotency\_key  
* On-call debugging path:  
  * locate user by phone hash  
  * inspect latest transitions  
  * inspect LinkUp and Invite states

---

## Implementation Checklist

1. Define enums/constants for each entity state.  
2. Implement guard \+ transition functions (pure functions) per entity.  
3. Implement DB transaction helpers for:  
   * LinkUp lock  
   * invite response application  
   * entitlement update  
4. Add idempotency key storage and unique constraints.  
5. Add audit trail records for all transitions.  
6. Write unit \+ integration tests for duplication and concurrency.  
7. Wire Conversation Router to these transitions (Document 4).

