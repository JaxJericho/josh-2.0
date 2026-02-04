# Link Up Orchestration Contract (JOSH 2.0)

## *Document \#7*

## Summary

This document defines how JOSH creates and runs a LinkUp: a small-group plan built from a user’s intent (activity \+ time window \+ location), then filled by inviting compatible people in waves until it locks or expires. The LinkUp orchestration is where product experience meets operational correctness: you need fast invites, clear acceptance rules, no double-sends, and clean outcomes even when people cancel.

The rules here protect trust. Users must understand what they’re agreeing to, how long they have, who’s in, and what happens if someone drops. The system must also handle real-world messiness: not enough candidates, ambiguous user requests, partial failures sending invites, and retries.

This spec is implementation-ready: LinkUp brief schema, validation, candidate selection contract, invite wave strategy, quorum/lock rules, TTLs, replacement logic, cancellation flows, dashboard reveal timing, reminder scheduling, error handling, decision trees, examples, and production deployment wiring checks.

---

## Scope, Out Of Scope, Deferred

### In Scope

* LinkUp creation from SMS request.  
* LinkUp Brief schema and validation.  
* Candidate pool building and eligibility filters.  
* Invite waves and acceptance tracking.  
* Quorum and lock rules.  
* Expiration and cancellation handling.  
* Location handling (region \+ radius \+ venue suggestions).  
* Dashboard reveal timing and content.  
* Reminder scheduling (morning-of).

### Out Of Scope

* Multi-day scheduling negotiation.  
* Host-led events (future feature).  
* Real-time group chat.

### Deferred

* Venue API integrations (Yelp, Google Places) beyond simple curated suggestions.  
* Adaptive batch sizing via learning (documented in Doc 10).

---

## Key Decisions

1. Invite waves instead of inviting everyone at once  
   * Reduces spam, improves match quality, controls cost.  
2. Lock is a database transaction  
   * Prevents double-lock and inconsistent membership under concurrency.  
3. Replacement after lock is bounded  
   * One replacement wave only, short deadline.  
4. Location is privacy-preserving  
   * Use region \+ approximate radius, not exact addresses.  
5. Dashboard is the detailed view  
   * SMS is used for quick decisions and confirmations.

---

## LinkUp Brief Schema

LinkUp Brief lives in `linkups.brief`.

### JSON Schema

```json
{
  "activity_key": "coffee",
  "activity_label": "Coffee",
  "time_window": "SAT_MORNING",
  "time_window_options": ["SAT_MORNING", "SAT_AFTERNOON"],
  "region_id": "uuid",
  "radius_miles": 5,
  "constraints": {"quiet": true, "indoor": true},
  "motive_emphasis": {"connection": 0.7, "comfort": 0.6},
  "group_size": {"min": 2, "max": 6},
  "initiator_notes": "optional short note",
  "location_hint": "Santa Monica"
}
```

### Required Fields

* `activity_key`  
* `time_window` OR `time_window_options` (for A/B offer)  
* `region_id`

### Optional Fields

* `radius_miles` default 5  
* `constraints`  
* `motive_emphasis`  
* `group_size` default `{min:2,max:6}`  
* `location_hint`

### Validation Rules

* `radius_miles` min 1, max 25  
* `group_size.min` \>= 2  
* `group_size.max` \<= 10  
* `group_size.min` \< `group_size.max`  
* `time_window` must be one of configured buckets  
* `activity_key` must exist in activity catalog

---

## LinkUp Creation Contract

### Entry

Triggered by intent handler `handleLinkupRequest` (Doc 4).

### Preconditions

To create a LinkUp in `draft`:

* user state is `active`  
* profile is `complete_mvp`  
* region is `open` (or: allow draft, but do not broadcast until open)  
* user entitlements allow initiation (Doc 11\)  
* user not on safety hold (Doc 13\)

### Idempotency

Compute:

* `linkup_create_key = sha256(initiator_user_id + normalized_activity + normalized_time_window + region_id + day_bucket)`

Store in `linkups.linkup_create_key` with unique constraint.

Behavior:

* If the same request is sent twice in a short window, return the existing LinkUp.

---

## Transition: Draft → Broadcasting

### When

* Brief is validated.  
* Acceptance window is set.

### Acceptance Window

* 24 hours from `broadcasting_started_at`.  
* Stored as `acceptance_window_ends_at`.

### Broadcast Start Steps (Transaction)

1. Update `linkups.state = broadcasting`.  
2. Set `acceptance_window_ends_at = now() + 24h`.  
3. Create initial invite wave selection rows (invites in `pending`).  
4. Enqueue outbound SMS jobs for invites.  
5. Create domain events.

If invite send fails:

* LinkUp remains broadcasting.  
* Retry wave send job; do not duplicate invite rows.

---

## Candidate Selection And Eligibility Filters

This section defines how the orchestration requests candidates from matching.

### Matching Input

```ts
export type LinkupCandidateRequest = {
  linkupId: string;
  initiatorUserId: string;
  regionId: string;
  activityKey: string;
  timeWindowOptions: string[];
  constraints: Record<string, boolean>;
  groupSize: { min: number; max: number };
  radiusMiles: number;
};
```

### Eligibility Filters (Hard)

Exclude candidates if:

* candidate is the initiator  
* candidate is not `active`  
* candidate profile not `complete_mvp`  
* candidate is on any safety hold  
* candidate is not entitled to participate  
* candidate is already:  
  * in a locked LinkUp overlapping the time window  
  * currently broadcasting as initiator (optional limit)  
  * has a pending invite for the same LinkUp  
* candidate has blocked initiator or is blocked by initiator

### Compatibility Filters (Soft)

* minimum friend compatibility score threshold (config, default 0.55)  
* minimum moment fit threshold (config, default 0.55)

### Candidate Response

```ts
export type LinkupCandidate = {
  userId: string;
  finalScore: number;
  friendScore: number;
  momentFit: number;
  explainability: {
    topReasons: string[];
    filters: { passed: string[]; failed: string[] };
  };
};
```

---

## Invite Wave Strategy

### Parameters (Config)

* `wave_1_size = 6`  
* `wave_2_size = 6`  
* `wave_3_size = 8`  
* `max_waves = 3`

These are initial defaults; Doc 10 defines how to adapt them.

### Timing

* Send wave 1 immediately.  
* If not locked after 2 hours, send wave 2\.  
* If not locked after 8 hours, send wave 3\.

Stop sending waves if:

* LinkUp locks  
* LinkUp expires  
* LinkUp is canceled

### Invite Message Template

Must include:

* Activity label  
* Time window options (A/B) if relevant  
* Deadline (“You have 24 hours”)  
* Simple response instructions

Example:

* “JOSH LinkUp: Coffee this Saturday morning (or afternoon). Want in? Reply A morning, B afternoon, or No.”

### Invite Idempotency

* Each invite row has `idempotency_key`.  
* Each outbound job has idempotency key:  
  * `invite_sms:{invite_id}:{template_version}`

---

## Quorum And Lock Rules

### Quorum

* Minimum: `group_size.min` (default 2\)  
* Maximum: `group_size.max` (default 6, hard cap 10\)

### Lock Condition

Lock when:

* initiator is always included  
* accepted participants count ≥ minimum, within acceptance window

Special cases:

* If maximum reached before window ends: lock immediately.

### Lock Transaction Requirements

Lock must be done in a single DB transaction:

1. Verify `linkups.state = broadcasting`.  
2. Verify `now() < acceptance_window_ends_at`.  
3. Compute accepted count.  
4. Update linkup:  
   * state \= locked  
   * locked\_at  
   * lock\_version++  
5. Insert participants:  
   * initiator (role initiator)  
   * accepted invitees (role participant)  
6. Close remaining invites:  
   * set `state = closed` for all pending invites  
7. Create domain events.

If transaction fails due to concurrency:

* treat as already locked.

---

## Dashboard Reveal Timing And Content

### Timing

* The detailed plan and participant list is visible in dashboard only after lock.

### What Is Shown

* Activity  
* Time window chosen  
* General area / venue suggestion  
* Participant first names and profile pictures (if captured)  
* Safety reminders (meet in public)

### What Is Not Shown

* Phone numbers (never)  
* Exact addresses (unless user later opts in, deferred)

---

## Location Handling

### Location Inputs

* Region membership defines primary region.  
* Optional `location_hint` can refine venue suggestions.  
* Radius is approximate (miles).

### Venue Suggestion (MVP)

* Maintain a curated list per region:  
  * coffee shops, parks, etc.  
* Or generate generic suggestions:  
  * “Meet at a coffee shop near {location\_hint}”

### Geocoding

Deferred:

* full geocode and distance computation.

MVP behavior:

* Use region match only; optionally support city-level selection.

---

## Expiration And TTL

### Expire Condition

If `now() >= acceptance_window_ends_at` and quorum not met:

* set linkup state to `expired`  
* close all pending invites  
* notify initiator

### Expiration Notifications

Initiator message:

* honest and encouraging  
* offer retry

Example:

* “I couldn’t get enough people for this LinkUp in time. Want to try a different activity or time?”

---

## Cancellation Flows

### Initiator Cancels Before Lock

* Update linkup state to `canceled`  
* Close invites  
* Notify invitees who already accepted: “This LinkUp was canceled.”

### Initiator Cancels After Lock

* Update state to `canceled`  
* Notify all participants  
* Record cancellation reason

### Participant Cancels After Lock

* Update participant status to `canceled`  
* If quorum still met: continue  
* If quorum breaks: attempt replacement wave (bounded)

---

## Replacement Logic (Post-Lock)

### Trigger

* After lock, if active confirmed participant count drops below minimum.

### Rule

* Attempt exactly one replacement wave.  
* Replacement deadline: 2–4 hours.  
* Only invite candidates who:  
  * are eligible  
  * can make the chosen time window

If replacement succeeds:

* add participant  
* notify group

If replacement fails:

* cancel LinkUp  
* notify all

---

## Reminder Scheduling

### Reminder Types

* `morning_of` (default)  
* optional: `1_hour_before` (deferred)

### Scheduling Rule

* When LinkUp locks:  
  * schedule reminder at 9am local time on event day  
  * if lock occurs after that time, schedule 1 hour after lock

Reminder message must include:

* activity  
* time  
* general location / venue suggestion

---

## Error Handling

### Partial Failures Sending Invites

* Invites are created first.  
* Outbound jobs are created per invite.  
* If sending fails:  
  * job status `failed`  
  * retry sends via job runner

Never create a second invite row for the same user+linkup.

### Insufficient Candidate Pool

If matching returns fewer than wave size:

* send what you can  
* if still not enough by expiry:  
  * expire

Optional mitigation:

* relaxation rules (Doc 9\) may widen constraints.

---

## Decision Trees

### Decision Tree: Start Broadcasting

* If initiator not eligible → deny \+ paywall or resume interview  
* Else validate brief  
* If brief missing activity → ask clarifier  
* Else create/resolve draft by create\_key  
* Transition to broadcasting  
* Send wave 1

### Decision Tree: Send Next Wave

* If linkup state \!= broadcasting → stop  
* If now \>= window end → expire  
* If quorum met → lock  
* Else if waves\_sent \< max\_waves → send next  
* Else wait until expiry

### Decision Tree: Handle Invite Acceptance

* If invite state is closed/expired → respond closed  
* Else set invite accepted  
* If quorum met → lock transaction  
* Else acknowledge and wait

---

## Examples

### Example: Happy Path

* Initiator requests coffee Saturday morning.  
* LinkUp created and broadcasts.  
* Two accept within 30 minutes.  
* Lock and reveal dashboard.  
* Morning-of reminder.

### Example: Not Enough Candidates

* Initiator requests niche activity.  
* Wave 1 yields no accept.  
* Wave 2 yields one accept.  
* Expire at 24h and notify.

### Example: Cancel After Lock

* One participant cancels.  
* Quorum breaks.  
* Replacement wave invites 3\.  
* None accept within 3 hours.  
* LinkUp canceled and all notified.

---

## Dependencies

* Document 2: LinkUp and Invite state machines.  
* Document 3: linkups/invites/participants/reminders schema.  
* Document 4: intent routing and invite reply parsing.  
* Document 9: matching candidate selection and scoring.  
* Document 11: entitlement enforcement.  
* Document 12: region model and location policies.

---

## Risks And Mitigation

1. Invite spam perception  
   * Mitigation: wave strategy \+ max invite frequency limits.  
2. Lock confusion  
   * Mitigation: explicit lock confirmation SMS and dashboard details.  
3. Location ambiguity  
   * Mitigation: curated region suggestions \+ clear “general area” language.  
4. Replacement feels chaotic  
   * Mitigation: only one bounded replacement attempt.

---

## Testing Approach

### Unit Tests

* brief validation  
* wave scheduling logic  
* lock transaction logic  
* replacement trigger logic

### Integration Tests

* concurrency: simultaneous accept triggers lock once  
* duplicate invite send prevented by idempotency

### E2E Scenarios

* end-to-end LinkUp formation and lock  
* expire without quorum  
* cancel flows  
* replacement wave flow

---

## Production Readiness

### 1\) Infrastructure Setup

#### Twilio

* Ensure messaging service configured for invites and reminders.  
* Use status callbacks if updating delivery status.

#### Supabase

* Confirm unique constraints for:  
  * `linkup_create_key`  
  * `(linkup_id, invited_user_id)`  
  * outbound job idempotency keys

#### Scheduling

* Use a job scheduler (QStash/cron) for:  
  * wave timers  
  * expiration  
  * reminders

### 2\) Environment Parity

* Staging uses same wave timings but lower candidate pool.  
* Staging can allow override to shorten windows for testing.

### 3\) Deployment Procedure

1. Deploy schema migrations.  
2. Deploy orchestration routes and job runners.  
3. Point staging Twilio webhooks.  
4. Run rehearsal:  
* create LinkUp  
* accept invite  
* lock  
* reminder

### 4\) Wiring Verification

Smoke tests:

* Initiate LinkUp by SMS.  
* Verify linkup row created.  
* Verify invite rows created.  
* Verify outbound jobs created.  
* Accept invite and verify lock transaction.  
* Verify reminder scheduled.

### 5\) Operational Readiness

* Metrics:  
  * lock rate  
  * time to lock  
  * invites sent per LinkUp  
  * cancellation and replacement rates  
* Logs:  
  * wave sends  
  * lock attempts  
  * expiration runs

---

## Implementation Checklist

1. Implement LinkUp brief builder and validator.  
2. Implement LinkUp create idempotency key.  
3. Implement broadcasting transition transaction.  
4. Implement candidate selection adapter (calls matching service).  
5. Implement invite wave sender and outbound jobs.  
6. Implement invite response handler.  
7. Implement lock transaction.  
8. Implement expiry job.  
9. Implement cancellation and replacement flows.  
10. Implement reminder scheduler.  
11. Add metrics and logs.  
12. Write unit/integration/E2E tests.

