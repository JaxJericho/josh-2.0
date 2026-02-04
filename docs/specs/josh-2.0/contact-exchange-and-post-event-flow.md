# Contact Exchange And Post-Event Flow (JOSH 2.0)

## *Document \#8*

## Summary

This document specifies how JOSH handles the period after a LinkUp occurs: confirming attendance, capturing lightweight feedback for learning, and enabling optional contact exchange between participants with strict mutual consent and privacy protections.

The post-event flow is designed to be SMS-first and retry-safe. Every step is idempotent, bounded in time, and safe under asynchronous retries. Users can participate fully over SMS, with the dashboard serving as an optional backup surface for reviewing outcomes and completing contact exchange later.

## Goals

* Capture post-event learning signals with minimal user effort.  
* Enable contact exchange between LinkUp participants with mutual consent.  
* Preserve privacy: no phone number reveal unless both users opt in.  
* Maintain reliability under retries, concurrent workers, and delayed jobs.  
* Integrate with safety: block/report should short-circuit exchange and become hard filters.

## Non-Goals

* Anonymous relay chat after LinkUp (deferred).  
* Sharing social handles (Instagram, Discord, etc.) (deferred).  
* Detailed survey instruments or long-form questionnaires (deferred).  
* Attendance verification using GPS or third-party validation (deferred).

## Key Decisions And Trade-Offs

* SMS-first flow with dashboard fallback: SMS drives completion; dashboard prevents dead-ends for users who miss messages.  
* Minimal outcome signals: fewer questions increases response rate; richer learning is deferred to Doc 10\.  
* Mutual consent required for number reveal: reduces risk and user discomfort, but delays exchange for users who respond late.  
* Allow changing a “yes” to “no” until reveal occurs: improves user control; once revealed, the safety mechanism becomes “block” rather than “revoke.”

## Definitions

* LinkUp window: The time window around the scheduled event time during which reminders and post-event prompts are relevant.  
* Participant: A user in `linkup_participants` with `status = confirmed` at lock time.  
* Outcome: A per-user record in `linkup_outcomes` capturing attendance and a small set of post-event signals.  
* Choice: A per-user, per-target record in `contact_exchange_choices` representing yes/no to exchanging contact info.  
* Exchange: A row in `contact_exchanges` created only upon mutual yes.

## Scope Boundaries

### In Scope

* Attendance confirmation prompt and persistence.  
* “Do it again?” pulse and optional free-text feedback.  
* Contact exchange choices across confirmed participants.  
* Mutual yes detection and phone number reveal messaging.  
* Safety hooks: block/report short-circuit and hard filters.

### Deferred

* In-app anonymized chat.  
* Sharing additional personal fields beyond first name \+ phone.  
* Advanced post-event analytics UI.

## State And Timing

### LinkUp State Progression

The canonical `linkup_state` includes: `draft`, `broadcasting`, `locked`, `completed`, `expired`, `canceled`.

Post-event flows run only when the LinkUp is in a post-occurrence posture:

* A LinkUp becomes eligible for post-event prompts when:  
  * `linkups.state = locked`  
  * `linkups.event_time` is set  
  * `now() >= linkups.event_time + POST_EVENT_BUFFER`  
* The system transitions `locked → completed` in a single idempotent job when the LinkUp is considered “in the past.”

Recommended constants (tunable):

* `POST_EVENT_BUFFER`: 2 hours after `event_time` (avoid messaging mid-event).  
* `POST_EVENT_COLLECTION_WINDOW`: 7 days (after which prompts stop, but the dashboard may still allow entry).

### Participant Eligibility For Post-Event Flow

Only users who are in `linkup_participants` are eligible. Users marked `canceled` before the event may still be prompted for outcomes if they were confirmed at lock time, but contact exchange should only be offered among users who were confirmed participants at the event.

## Data Model

This doc relies on the canonical schema from Doc 03\.

### linkup\_outcomes

* Unique per `(linkup_id, user_id)`.  
* Fields used by this flow:  
  * `attendance_response`: `attended | no_show | unsure`  
  * `do_again`: boolean  
  * `feedback`: text (minimized, protected)

### contact\_exchange\_choices

* Unique per `(linkup_id, chooser_user_id, target_user_id)`.  
* `choice`: boolean

### contact\_exchanges

* Created only when both parties choose yes.  
* Unique per `(linkup_id, user_a_id, user_b_id)`.  
* Canonical ordering enforced by application (`user_a_id < user_b_id` lexicographically).

### Safety Dependencies

This flow assumes the safety system provides:

* `blocks` table (or equivalent) that can be queried as a hard filter.  
* `safety_holds` table (or equivalent) that can prevent outgoing reveals and contact exchange prompts.

If those tables differ in your implementation, adapt the guard checks but preserve the behavior.

## Post-Event Conversation Contract

### Conversation Type

Post-event interactions are a bounded subflow keyed by `(user_id, linkup_id)`.

* It must not interfere with onboarding interview or other active flows.  
* The router should prefer explicit STOP/HELP precedence, then safety checks, then post-event flows, then other product flows.

### Step Catalog

Use stable step IDs for post-event prompts (similar to the interview step catalog):

* `POST_EVENT_ATTENDANCE`  
* `POST_EVENT_DO_AGAIN`  
* `POST_EVENT_FEEDBACK` (optional)  
* `POST_EVENT_CONTACT_EXCHANGE_INTRO`  
* `POST_EVENT_CONTACT_EXCHANGE_CHOICES`

The state of these steps should be persisted in a per-user session record (existing `conversation_sessions` pattern), including `linkup_id` and `current_step_id`.

### Allowed Reply Formats

For SMS simplicity, accept:

* Attendance: `1`, `2`, `3` or words like `attended`, `no`, `unsure`.  
* Do again: `Y/N` and common variants.  
* Contact choices:  
  * Option A (recommended MVP): numbered list selection (for small groups), e.g., `1,3`.  
  * Option B: per-person prompts (slower but simpler parsing), e.g., “Share with Alex? (Y/N)” repeated.

MVP recommendation: Choose Option A when group size ≤ 6 (matches max\_size). It is faster and still parseable.

### Maximum Clarifier Rule

If a reply cannot be parsed, the system asks exactly one clarifying question and then offers a deterministic fallback (dashboard link or “reply SKIP”).

## Flow: Post-Event Outcome Capture

### Trigger

A scheduled job runs periodically (cron/QStash) to find LinkUps eligible for post-event outreach.

Eligibility query (conceptual):

* `state = locked`  
* `event_time is not null`  
* `event_time < now() - POST_EVENT_BUFFER`

The job:

1. Attempts to transition `locked → completed` (idempotent).  
2. Enqueues post-event prompts for each eligible participant.

### Messaging Sequence

Recommended SMS copy structure (final copy can be iterated later):

1. Attendance  
   * “Quick check: Did you make it to \[Activity\]? Reply 1\) Attended 2\) Couldn’t make it 3\) Not sure.”  
2. Do again  
   * “Would you do something like that again? Reply Y/N.”  
3. Optional feedback  
   * “Anything you want JOSH to remember for next time? (Optional. Reply SKIP to skip.)”  
4. Contact exchange intro  
   * “Want to swap numbers with anyone from that LinkUp? You can choose any/all/none. Mutual yes only.”  
5. Contact choices  
   * “Reply with numbers you’d like to exchange with (e.g., 1,3). Reply NONE for no one.”

### Persistence Rules

* Create or upsert `linkup_outcomes(linkup_id, user_id)` as the user responds.  
* All writes must be idempotent:  
  * Repeated attendance replies overwrite `attendance_response`.  
  * Repeated do-again replies overwrite `do_again`.  
  * Feedback overwrites `feedback` unless you choose append semantics (append is not recommended for minimization).

### Completion Rules

A user is “done” with post-event outcomes when:

* Attendance captured OR they explicitly skip.  
* Do-again captured OR they explicitly skip.  
* Contact choices captured OR they explicitly skip.

The LinkUp is considered “post-event complete” when either:

* All participants have completed outcomes, or  
* `now() >= completed_at + POST_EVENT_COLLECTION_WINDOW`.

(Implementation detail: this is operationally useful for stopping reminders; it does not have to be a new DB column.)

## Flow: Contact Exchange

### Preconditions

A user can submit contact exchange choices only if:

* They were a participant in the LinkUp.  
* The LinkUp is in `completed` state (or eligible post-event state).  
* The user is not on a safety hold.

### Contact Candidate Set

The candidate set is the other participants who:

* Are in `linkup_participants` for this linkup.  
* Have `status = confirmed` at the time of event lock.  
* Are not blocked by the chooser, and have not blocked the chooser.

If safety/blocks exclude everyone, the user should receive a short message and the flow ends.

### Recording Choices

When the user submits choices:

* For each candidate target, upsert `contact_exchange_choices`.  
* Choices not mentioned in a numbered-list reply default to `false` for that submission.  
  * This prevents ambiguity and makes the operation idempotent.

#### Changing A Choice

* A user may change a prior `true` choice to `false` until a mutual exchange row exists.  
* Once `contact_exchanges` exists for a pair, the exchange is considered revealed. The user cannot revoke the other person’s knowledge of their number.  
* The correct post-reveal safety action is “block” and “report.”

### Mutual Yes Detection

Whenever a `contact_exchange_choice` is written, the system checks mutuality:

* Condition: chooser says `true` about target AND target has already said `true` about chooser.  
* If mutual and there is no existing `contact_exchanges` row for that pair, create it.

#### Canonical Ordering

When creating `contact_exchanges`:

* Compute `(user_a_id, user_b_id) = sortLex(chooser_user_id, target_user_id)`.  
* Insert with that ordering.  
* Rely on the unique constraint to guarantee only one row exists.

### Reveal Messaging

Upon creation of `contact_exchanges`, send a reveal message to both users.

Reveal payload (MVP):

* First name  
* Phone number

Example:

* “You both said yes. Here’s Alex’s number: \+1 XXX-XXX-XXXX. If you want to stop contact, reply BLOCK ALEX.”

#### Privacy And Safety Rules

Before sending reveal messages:

* Re-check blocks both directions.  
* Re-check safety holds.  
* If either check fails, do not send the reveal.  
  * Keep the `contact_exchanges` row, but mark the reveal as not sent via an outbound-job status (or add a `reveal_sent_at` column in a future migration if needed).  
  * Emit a safety event for review.

MVP assumes the SMS system can send messages directly to user phone numbers. If you later introduce an anonymized relay, this is the seam to swap.

## Decision Trees

### Decision Tree: Post-Event Eligibility

1. Is linkup.state \= locked?  
   * No → Do nothing.  
   * Yes → Continue.  
2. Is linkup.event\_time set?  
   * No → Flag for admin review; do not send post-event.  
   * Yes → Continue.  
3. Is now \>= event\_time \+ POST\_EVENT\_BUFFER?  
   * No → Do nothing.  
   * Yes → Transition to completed and enqueue prompts.

### Decision Tree: Parsing Attendance Reply

1. Parse reply as {attended, no\_show, unsure}.  
   * Success → Upsert `linkup_outcomes.attendance_response`.  
   * Fail → Send one clarifier.  
2. After clarifier:  
   * Parsed → Upsert.  
   * Still unparsed → Set `attendance_response = unsure` and continue flow.

### Decision Tree: Contact Exchange Choice Submission

1. Build candidate list (participants minus self, minus blocks).  
2. Parse reply:  
   * “NONE” → Upsert all targets \= false.  
   * “ALL” → Upsert all targets \= true.  
   * “1,3” → Upsert selected targets \= true, others \= false.  
   * Unparsed → One clarifier, then default to none.  
3. For each target with choice \= true:  
   * Check if target has chooser \= true.  
   * If mutual and no existing exchange → Insert `contact_exchanges` and send reveals (guarded).

## Idempotency And Retry Safety

### General Rules

* Every outbound message must be created through an idempotent job with a stable `idempotency_key`.  
* Every DB write uses unique constraints \+ upsert semantics.

### Post-Event Prompt Send

Recommended idempotency keys:

* Attendance prompt: `post_event_attendance:{linkup_id}:{user_id}`  
* Do again prompt: `post_event_do_again:{linkup_id}:{user_id}`  
* Feedback prompt: `post_event_feedback:{linkup_id}:{user_id}`  
* Contact intro: `post_event_contact_intro:{linkup_id}:{user_id}`  
* Contact choices: `post_event_contact_choices:{linkup_id}:{user_id}`

### Mutual Exchange Creation

* `contact_exchanges` is protected by unique constraint.  
* Create within a transaction:  
  * Read both choices with `FOR UPDATE` or rely on insert race handling.  
  * Attempt insert.  
  * On conflict do nothing.

### Reveal Message Send

* Use idempotency keys:  
  * `contact_reveal:{linkup_id}:{user_a_id}:{user_b_id}:{to_user_id}`

If your outbound jobs table already supports `idempotency_key`, rely on it to avoid duplicates.

## Error Handling

* If outbound message send fails:  
  * Record failure in outbound job status.  
  * Retry with exponential backoff.  
  * After max retries, emit an alert and leave the flow recoverable via dashboard.  
* If parsing fails repeatedly:  
  * Use the max clarifier rule.  
  * Default outcomes to `unsure` and contact choices to `none`.  
* If linkup participant records are inconsistent:  
  * Do not attempt contact exchange.  
  * Emit an admin-visible incident and log correlation\_id.

## Testing Plan

### Unit Tests

* Parse attendance replies (numbers, words, typos).  
* Parse do-again replies.  
* Parse contact selection replies (NONE/ALL/1,3).  
* Canonical ordering for exchange pair.  
* “Choice change” behavior before vs after exchange exists.

### Integration Tests

* DB upsert behavior for `linkup_outcomes` unique constraint.  
* DB upsert behavior for `contact_exchange_choices` unique constraint.  
* Concurrent mutual yes insertion results in exactly one `contact_exchanges` row.

### End-To-End Tests

Simulate a LinkUp of 4 users:

1. Transition to completed.  
2. Prompt each participant.  
3. User A says yes to B and C, user B says yes to A, user C says no.  
4. Verify exchange is created only for A–B.  
5. Verify reveal SMS is sent exactly once per user.  
6. Add a block before reveal; verify reveal is suppressed.

## Production Readiness

### Infrastructure And Scheduling

* Add a scheduled job (cron/QStash) for `PostEventProcessor`.  
* Ensure it is safe under concurrent execution:  
  * Use row-level locking or optimistic locking (linkups.lock\_version) when transitioning states.

### Observability

Emit structured logs and metrics (Doc 05 conventions) for:

* `post_event_prompt_enqueued`  
* `post_event_prompt_sent`  
* `post_event_reply_parsed`  
* `post_event_reply_unparsed`  
* `contact_choice_written`  
* `contact_exchange_created`  
* `contact_reveal_sent`  
* `contact_reveal_suppressed_safety`

All must carry:

* `correlation_id`  
* `linkup_id`  
* `user_id`  
* `message_sid` (for inbound/outbound when available)

### Deployment Procedure And Wiring Verification

After deploy to staging:

1. Create a LinkUp with test numbers.  
2. Set `event_time` to a few minutes in the past.  
3. Run the post-event processor job manually.  
4. Verify:  
   * LinkUp transitions to completed exactly once.  
   * Each participant receives attendance prompt once.  
   * Replies persist to `linkup_outcomes`.  
   * Mutual yes creates `contact_exchanges` exactly once.  
   * Reveal messages send exactly once.

### Operational Safeguards

* Rate limit post-event prompts per user per day.  
* Stop prompting if a user replies STOP.  
* If a user is on safety hold, suppress contact exchange prompts and reveals.

## Implementation Checklist

* Implement post-event step catalog and session persistence.  
* Implement post-event processor job (eligible LinkUps, transition to completed).  
* Implement outbound job idempotency keys for each prompt type.  
* Implement parsers for attendance/do-again/contact selection.  
* Implement `contact_exchange_choices` upsert and mutual detection.  
* Implement reveal messaging with safety checks and idempotency.  
* Implement dashboard fallback surfaces:  
  * View past LinkUps  
  * Submit attendance/outcome  
  * Choose contact exchange  
* Add metrics and logs per Doc 05\.  
* Add E2E test harness for a multi-user LinkUp scenario.