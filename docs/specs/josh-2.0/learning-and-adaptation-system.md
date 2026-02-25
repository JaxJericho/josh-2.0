# Learning And Adaptation System

## Summary

This document specifies how JOSH 3.0 learns from user behavior and outcomes to improve future matching and suggestion quality without introducing opaque model behavior or risky automation. The system tracks a defined set of signals (attendance, post-activity checkins, contact exchange outcomes, blocks, reports) and updates derived preference weights and reliability estimates using bounded, explainable rules. These updates feed into the Compatibility Scoring And Matching Algorithm spec.

Learning in MVP is conservative and transparent: it prioritizes safety, avoids personalization that could surprise users, and keeps all updates reversible via decay. It supports operational needs: debugging why a score changed, ensuring changes are idempotent, and preventing runaway effects from small sample sizes.

---

## Goals

* Improve match and suggestion quality over time using observed outcomes and explicit user feedback.  
* Update derived weights in a bounded, explainable way.  
* Handle cold start and sparse regions gracefully.  
* Provide a privacy-preserving signal store with clear retention rules.  
* Be idempotent and safe under retries and batch processing.

## Non-Goals

* Fully automated weight tuning via ML or bandits (deferred).  
* Personalized LLM "memory" beyond stored, user-approved signals.  
* Using sensitive attributes to learn or infer protected traits.  
* Learning from message content beyond explicit user feedback fields at MVP.  
* Updating Layer B (compatibility layer) fields — Layer B is reserved for future paid tiers and is not populated or read at MVP.

## Key Decisions And Trade-Offs

* Rule-based learning with decay: stable and debuggable, less powerful than ML but much safer for MVP.  
* Event-sourced signal capture: enables replay and audit, adds some storage overhead.  
* Bounded updates with minimum sample thresholds: prevents noisy data from dominating early.  
* Per-user derived state \+ global config: supports personalization while keeping global control.  
* Solo coordination follow-through loop as a first-class signal source: post-activity checkins from solo plans are learning signals, not just engagement data.

---

## Definitions

* Signal: A recorded event derived from user behavior or outcomes.  
* Derived State: Aggregated per-user values used by matching and suggestion (reliability, activity weight overrides, time window overrides).  
* Update Job: A batch process that consumes signals and updates derived state.  
* Decay: Time-based reduction of signal influence.  
* Follow-Through Loop: The solo coordination cycle — JOSH suggests an activity → user attends → JOSH follows up → outcome is captured as a learning signal.

---

## Inputs

### Signal Sources

All signal sources for 3.0:

* Post-activity checkins from solo coordination (follow-through loop) — new in 3.0  
* LinkUp attendance outcomes  
* LinkUp do-again responses  
* LinkUp free-text feedback (bounded, sanitized)  
* Contact exchange outcomes (mutual yes / declined)  
* Safety events (holds, blocks, reports)

Deprecated signal source (2.0 only, removed):

* Match preview actions (accept/reject) — the 1:1 Match Preview mode is deprecated in 3.0

### Existing Profile Signals

Learning updates derived overlays on top of the base coordination profile:

* 6 coordination dimensions with confidence values  
* Activity patterns with motive weights  
* Coordination signals (scheduling\_availability, notice\_preference, coordination\_style)  
* Time window preferences

Learning never modifies Layer B compatibility fields.

---

## Outputs

* Updated per-user derived state used by matching and suggestion:  
  * Reliability score (REL)  
  * Activity weight overrides (per activity\_key)  
  * Time window preference overrides (per bucket)  
  * Novelty tags (optional, coarse)  
* Updated global tuning metadata:  
  * weights\_version used per match run (Compatibility Scoring spec)  
  * cohort-level metrics for admin dashboards

---

## Data Model

### Table: learning\_signals

Append-only log. Never updated, only inserted.

* `id` uuid  
* `user_id` uuid — the user for whom the signal is recorded  
* `signal_type` enum (see Signal Types below)  
* `subject_id` uuid — linkup\_id, plan\_brief\_id, or exchange\_id depending on signal type  
* `counterparty_user_id` uuid nullable — for pairwise signals  
* `value_num` numeric nullable  
* `value_bool` boolean nullable  
* `value_text` text nullable — bounded, sanitized, no PII  
* `meta` jsonb — bounded; activity\_key, time\_bucket, or other context  
* `occurred_at` timestamptz  
* `ingested_at` timestamptz default now()  
* `idempotency_key` text unique

Indexes:

* `(user_id, occurred_at desc)`  
* `(signal_type, occurred_at desc)`

### Signal Types (Canonical Enum)

LinkUp outcomes:

* `linkup_attendance_attended`  
* `linkup_attendance_no_show`  
* `linkup_attendance_unsure`  
* `linkup_do_again_yes`  
* `linkup_do_again_no`  
* `linkup_feedback_text`

Solo coordination outcomes (new in 3.0):

* `solo_activity_attended` — user confirmed they went to a solo-suggested activity  
* `solo_activity_skipped` — user confirmed they did not go  
* `solo_do_again_yes` — user would do this type of activity again  
* `solo_do_again_no` — user would not repeat this type of activity  
* `solo_bridge_accepted` — user accepted a Plan Circle or LinkUp offer following a solo checkin

Contact exchange outcomes:

* `contact_exchange_mutual_yes`  
* `contact_exchange_declined`

Safety events:

* `user_blocked_other`  
* `user_reported_other`

Deprecated (removed from 3.0):

* `match_preview_accepted` — removed with 1:1 preview mode  
* `match_preview_rejected` — removed with 1:1 preview mode  
* `match_preview_expired` — removed with 1:1 preview mode

### Table: user\_derived\_state

Per-user snapshot consumed by matching and solo suggestion.

* `user_id` uuid primary key  
* `rel_score` numeric (0–1)  
* `activity_weight_overrides` jsonb — keyed by activity\_key  
* `time_window_overrides` jsonb — keyed by canonical time bucket  
* `novelty_tags` jsonb nullable  
* `updated_at` timestamptz  
* `version` int — optimistic concurrency

### Table: learning\_jobs

Tracks batch update runs.

* `id` uuid  
* `run_key` text unique  
* `status` enum: `started | completed | failed`  
* `started_at` timestamptz  
* `completed_at` timestamptz nullable  
* `params` jsonb  
* `error_detail` text nullable

---

## Privacy And Retention

### PII And Sensitive Content

* Do not store message transcripts as learning signals.  
* Only store user-entered feedback if it is explicit and bounded (e.g., post-activity checkin response).  
* Run all text feedback through a sanitizer before storage. Strip phone numbers, email addresses, and street addresses.  
* Do not store counterparty names or identifying details in signal meta.

### Retention

* `learning_signals`: retain 18 months (tunable) unless safety policy requires longer.  
* `user_derived_state`: current snapshot retained indefinitely while user is active.

### Access Controls

* RLS: users cannot read raw signals. Admin tooling requires explicit permission.  
* User-facing surfaces show only high-level preference summaries. Never expose raw signal counts or score mechanics.

---

## Learning Mechanics

Learning is implemented as deterministic functions that map signals to derived state updates. No ML. No probabilistic models. Every update is auditable and reversible.

### Reliability Score (REL)

REL is a bounded estimate of follow-through and positive social outcomes. It is consumed by the Compatibility Scoring spec as a scoring component.

#### Base Definition

* Cold start: `REL = 0.5`  
* Updated based on attendance, do-again, and exchange outcomes  
* Decays over time so older outcomes matter less

#### Event Weights

```
attended (linkup or solo):       +0.05
no_show:                         -0.10
unsure:                          -0.02
do_again_yes:                    +0.03
do_again_no:                     -0.03
mutual_exchange_yes:             +0.02
solo_bridge_accepted:            +0.01
```

Clamp REL to \[0.05, 0.95\].

#### Decay

Use exponential decay by signal age:

`effective_weight = base_weight * exp(-age_days / half_life_days)`

`half_life_days = 90` (tunable).

#### Minimum Sample Threshold

If a user has fewer than `N = 3` qualifying post-event outcomes, REL remains near neutral with limited movement:

```
raw_rel = computed value from signals
if sample_count < 3:
  alpha = sample_count / 3
  REL = 0.5 * (1 - alpha) + raw_rel * alpha
else:
  REL = raw_rel
```

### Activity Weight Overrides

Users declare activities and motive weights during the profile interview. Learning adjusts these gently over time based on observed behavior.

#### Signals

* `do_again_yes` after a LinkUp or solo activity with a given `activity_key` → increase that activity's weight delta  
* `do_again_no` for a given `activity_key` → decrease that activity's weight delta  
* `solo_bridge_accepted` following a suggestion for a given `activity_key` → treat as weak positive signal

#### Update Rule

Maintain `activity_weight_overrides` as deltas applied on top of the base profile:

```
positive outcome:  delta[activity_key] += +0.05
negative outcome:  delta[activity_key] += -0.03
```

Clamp each delta to \[-0.3, \+0.3\].

Apply during matching:

`final_weight = clamp(base_weight + delta, 0, 1)`

#### Minimum Evidence

Do not modify a delta until at least 2 signals exist for that `activity_key`.

### Time Window Overrides

Time preferences declared during the interview can drift. Learning re-weights within declared availability only. It never removes a time bucket entirely.

#### Signals

* `attended` and `do_again_yes` for a specific time bucket → increase preference weight for that bucket  
* `no_show` for a specific time bucket (2+ occurrences) → decrease slightly

#### Update Rule

Track counts by coarse canonical buckets (weekday\_morning, weekday\_afternoon, weekday\_evening, weekend\_morning, weekend\_afternoon, weekend\_evening).

* If a bucket has ≥ 3 attended outcomes, increase its preference weight.  
* If a bucket has ≥ 2 no-shows, decrease slightly.  
* Never reduce a bucket to zero — learning only re-weights within declared availability.

### Novelty Tags (Optional, Bounded)

For explainability and diversity control, track coarse archetype tags used by the NOV component in matching:

* Preferred group size range  
* Preferred activity families  
* Preferred social energy level

Rules:

* Tags must not encode sensitive or protected traits.  
* Store as counters with decay. Do not expose to users directly.

---

## Solo Coordination Follow-Through Loop

The post-activity checkin flow introduced in 3.0 generates signals that did not exist in 2.0. These signals must be ingested with appropriate context.

When a solo checkin is processed by `handlePostActivityCheckin`:

1. Record `solo_activity_attended` or `solo_activity_skipped` with the `activity_key` from the plan brief.  
2. If the user's response is positive and they engage with the bridge offer: record `solo_bridge_accepted`.  
3. Write the signal with idempotency key: `ls:solo_checkin:{plan_brief_id}:{user_id}`.

These signals feed REL and activity weight overrides identically to LinkUp outcomes. The matching engine does not distinguish between solo and LinkUp sources — REL is REL.

The solo follow-through loop is the primary learning signal source for users in regions where LinkUps are not yet available. It is not a fallback mechanism — it is a first-class input.

---

## Update Pipeline

### Ingestion

Whenever an outcome occurs, write a `learning_signals` row with a stable idempotency key.

Examples:

* LinkUp attendance: `ls:attended:{linkup_id}:{user_id}`  
* LinkUp do-again: `ls:do_again:{linkup_id}:{user_id}`  
* Solo checkin: `ls:solo_checkin:{plan_brief_id}:{user_id}`  
* Contact exchange: `ls:exchange_yes:{exchange_id}:{user_id}`  
* Block: `ls:block:{blocker_user_id}:{blocked_user_id}`

### Batch Update Job

A scheduled job runs periodically to update derived state from accumulated signals.

* Frequency: daily at MVP, every 6 hours if solo coordination volume warrants it.  
* For each run:  
  * Query signals since last successful run (incremental window).  
  * Group by `user_id`.  
  * Apply deterministic update functions for REL, activity overrides, and time window overrides.  
  * Write `user_derived_state` with optimistic concurrency check on `version`.

### Idempotency

* `learning_jobs.run_key` ensures each batch run is processed once.  
* Signal `idempotency_key` ensures each signal is ingested once.  
* Derived state updates are pure functions of (previous snapshot \+ new signals) and are safe to recompute.

### Replay

If corruption is detected, `user_derived_state` must be rebuildable by replaying all signals for a user from scratch.

Implement an admin-only rebuild job that accepts a `user_id` or `user_id` range and recomputes derived state from the full `learning_signals` history.

---

## Integration With Matching And Suggestion

### Matching

The Compatibility Scoring spec reads derived state overlays:

* REL component uses `user_derived_state.rel_score`  
* ACT uses base activity weights \+ `activity_weight_overrides`  
* TIME uses declared windows \+ `time_window_overrides`

If `user_derived_state` is missing for a user: use neutral defaults (REL \= 0.5, no overrides).

### Solo Suggestion

The solo coordination suggestion engine reads:

* `activity_weight_overrides` to surface activities the user has responded to positively  
* `time_window_overrides` to prefer time buckets with strong positive attendance history  
* REL is not used for solo suggestion — it applies only to stranger matching

---

## Edge Cases

* Sparse users / cold start: use neutral REL. Avoid overfitting activity and time adjustments until minimum evidence thresholds are met.  
* Bad actor manipulation: do not allow learning from safety hold events as positive signals. If a user is under active safety review, freeze all derived state updates until review is resolved.  
* No-show penalties: must decay. Do not permanently punish past no-shows. Decay is enforced by the exponential decay formula on all signals.  
* Conflicting signals: "attended" \+ "do\_again\_no" counts as mixed. Apply both small updates. Neither cancels the other.  
* Data gaps: if a plan outcome is missing (user never responded to checkin), do not infer. Record nothing. Do not apply a penalty for non-response.  
* complete\_invited users with no LinkUp history: REL \= 0.5 (neutral). Solo checkin signals may build REL incrementally before the user ever attends a LinkUp.

---

## Testing Plan

### Unit Tests

* REL update computation with decay applied correctly across signal ages.  
* Sample threshold blending formula at N=1, N=2, N=3.  
* Activity delta clamping at \[-0.3, \+0.3\] boundary.  
* Time window bucket logic — no bucket reduced to zero.  
* Sanitizer strips phone number and email patterns from `value_text`.  
* Solo signal idempotency key format produces no collisions with LinkUp keys.

### Integration Tests

* Signal ingestion idempotency under retries — duplicate insert on same idempotency key produces no duplicate row.  
* Batch job processes only signals since last successful run.  
* Derived state writes handle concurrent updates via `version` check.  
* Replay rebuild from signals produces the same snapshot as incremental updates.  
* Matching reads updated REL correctly from `user_derived_state`.

### End-To-End Tests

Simulate a user with mixed solo and LinkUp history:

1. Cold start — REL \= 0.5.  
2. Complete 2 solo checkins (attended, do\_again\_yes) and 1 LinkUp (attended, do\_again\_yes).  
3. Run learning job.  
4. Verify REL increases within expected bounds.  
5. Verify activity\_weight\_overrides adjust only for activity\_keys present in signals.  
6. Verify time\_window\_overrides adjust only for buckets with sufficient attendance history.  
7. Verify matching uses updated REL in scoring component.  
8. Verify solo suggestion engine prefers positively-signaled activity\_keys.

---

## Production Readiness

### Observability

Emit metrics and logs per Observability And Monitoring Stack conventions:

* `learning_signal_ingested` — include signal\_type in dimensions  
* `learning_signal_duplicate` — idempotency key collision detected  
* `learning_job_started` / `learning_job_completed` / `learning_job_failed`  
* `derived_state_updated` — per user  
* `derived_state_rebuild_started` / `derived_state_rebuild_completed`  
* `solo_signal_ingested` — separate counter to track follow-through loop health

Include in all events: `correlation_id`, `learning_job_id`. Include `user_id` in logs only, not in metric dimensions.

### Cost Controls

* Batch updates only — no per-event recomputation.  
* Cap signals processed per job run.  
* Use incremental windows with checkpoints.  
* Archive `learning_signals` older than retention window to cold storage before deletion.

### Wiring Verification

In staging:

1. Complete a solo plan suggestion and submit a post-activity checkin.  
2. Confirm `solo_activity_attended` and related signals are ingested with correct idempotency keys.  
3. Run learning job manually.  
4. Verify `user_derived_state` updates reflect the signal.  
5. Complete a LinkUp and submit attendance \+ do-again.  
6. Run learning job.  
7. Verify REL increases correctly.  
8. Run a match run and confirm REL is reflected in component scores.

---

## Implementation Checklist

* Confirm `learning_signals`, `user_derived_state`, and `learning_jobs` tables exist with correct schema.  
* Add new solo coordination signal types to the `signal_type` enum.  
* Remove deprecated preview signal types from enum if not yet removed.  
* Implement signal ingestion hooks from:  
  * `handlePostActivityCheckin` (solo coordination)  
  * LinkUp post-event flows  
  * Contact exchange flows  
  * Safety event handlers (blocks, reports)  
* Implement feedback sanitizer for `value_text` field.  
* Implement batch learning job with incremental windows, checkpoints, and idempotency.  
* Implement admin-only derived state replay rebuild tool.  
* Integrate derived state reads into matching (REL, activity overrides, time overrides).  
* Integrate activity and time override reads into solo suggestion engine.  
* Add observability events including solo signal counter.  
* Add end-to-end test harness covering mixed solo and LinkUp signal history.