# Learning And Adaptation System (JOSH 2.0)

## *Document \#10*

## Summary

This document specifies how JOSH 2.0 learns from user behavior and outcomes to improve future matching quality without introducing opaque model behavior or risky automation. The system tracks a defined set of signals (attendance, opt-ins, rejects, feedback) and updates derived preference weights and reliability estimates using bounded, explainable rules. These updates feed back into the matching model defined in Doc 09\.

Learning in MVP is conservative and transparent: it prioritizes safety, avoids personalization that could surprise users, and keeps updates reversible via decay. It also supports operational needs: debugging why a score changed, ensuring changes are idempotent, and preventing runaway effects from small sample sizes.

## Goals

* Improve match quality over time using observed outcomes and explicit user feedback.  
* Update derived weights in a bounded, explainable way.  
* Handle cold start and sparse regions gracefully.  
* Provide a privacy-preserving signal store and clear retention rules.  
* Be idempotent and safe under retries and batch processing.

## Non-Goals

* Fully automated weight tuning via ML or bandits (deferred).  
* Personalized LLM “memory” beyond stored, user-approved signals.  
* Using sensitive attributes to learn or infer protected traits.  
* Learning from message content beyond explicit user feedback fields (MVP).

## Key Decisions And Trade-Offs

* Rule-based learning with decay: stable and debuggable, less powerful than ML but much safer.  
* Event-sourced signal capture: enables replay and audit, adds some storage overhead.  
* Bounded updates with minimum sample thresholds: prevents noisy data from dominating.  
* Per-user derived weights \+ global config: supports personalization while keeping global control.

## Definitions

* Signal: A recorded event derived from user behavior or outcomes.  
* Derived State: Aggregated per-user values used in matching (reliability, activity weights).  
* Update Job: A batch process that consumes signals and updates derived state.  
* Decay: Time-based reduction of signal influence.

## Inputs

### Signal Sources

* Post-event outcomes (Doc 08\)  
* Match preview actions (accept/reject) (existing preview pipeline)  
* Contact exchange outcomes (mutual yes/no) (Doc 08\)  
* Safety events (holds, blocks, reports) (Doc 13\)  
* Subscription activity (optional for cohort analysis; not used for scoring)

### Existing Profile Signals

* Friend Fingerprint  
* Activities and motive weights  
* Time window preferences

Learning updates derived overlays on top of the base profile.

## Outputs

* Updated per-user derived state values used by matching:  
  * Reliability score (REL)  
  * Activity preference weights adjustments  
  * Time window preference adjustments (lightweight)  
  * Rejection/attraction patterns (coarse tags)  
* Updated global tuning metadata:  
  * weights versions used (Doc 09\)  
  * cohort-level metrics for admin dashboards

## Data Model

This doc assumes Doc 03 includes a domain event stream or similar. If not, create the following minimal tables.

### Table: `learning_signals`

A canonical append-only log.

* `id` uuid  
* `user_id` uuid (the user for whom the signal is recorded)  
* `signal_type` enum  
* `subject_id` uuid (linkup\_id or match\_id or exchange\_id)  
* `counterparty_user_id` uuid nullable (for pairwise signals)  
* `value_num` numeric nullable  
* `value_bool` boolean nullable  
* `value_text` text nullable (bounded, sanitized)  
* `meta` jsonb (bounded)  
* `occurred_at` timestamptz  
* `ingested_at` timestamptz default now()  
* `idempotency_key` text unique

Indexes:

* `(user_id, occurred_at desc)`  
* `(signal_type, occurred_at desc)`

### Signal Types

Recommended MVP enum values:

* `linkup_attendance_attended`  
* `linkup_attendance_no_show`  
* `linkup_attendance_unsure`  
* `linkup_do_again_yes`  
* `linkup_do_again_no`  
* `linkup_feedback_text` (store only if user provided, bounded)  
* `contact_exchange_mutual_yes`  
* `contact_exchange_declined`  
* `match_preview_accepted`  
* `match_preview_rejected`  
* `match_preview_expired`  
* `user_blocked_other`  
* `user_reported_other`

### Table: `user_derived_state`

A per-user snapshot used by matching.

* `user_id` uuid primary key  
* `rel_score` numeric (0–1)  
* `activity_weight_overrides` jsonb  
* `time_window_overrides` jsonb  
* `novelty_tags` jsonb (optional)  
* `updated_at` timestamptz  
* `version` int (optimistic concurrency)

### Table: `learning_jobs`

Tracks batch updates.

* `id` uuid  
* `run_key` text unique  
* `status` enum  
* `started_at`  
* `completed_at`  
* `params` jsonb  
* `error_detail` text

## Privacy And Retention

### PII And Sensitive Content

* Do not store message transcripts as learning signals.  
* Only store user-entered feedback from Doc 08 if explicit and bounded.  
* Strip phone numbers, emails, addresses from feedback using a sanitizer.

### Retention

* `learning_signals`: retain 18 months (tunable) unless safety policy requires longer.  
* `user_derived_state`: current snapshot retained indefinitely while user active.

### Access Controls

* RLS: users cannot read raw signals; only admin tooling can read with strict permissions.  
* User-facing surfaces should show only high-level preference summaries.

## Learning Mechanics

Learning is implemented as deterministic functions that map signals to derived state updates.

### Reliability Score (REL)

REL is a bounded estimate of “follow-through and positive outcomes.”

#### Base Definition

* Start at `0.5` for cold start.  
* Update based on attendance and do-again.  
* Apply decay so older outcomes matter less.

#### Event Weights

Define per-signal contributions:

* attended: \+0.05  
* no\_show: \-0.10  
* unsure: \-0.02  
* do\_again\_yes: \+0.03  
* do\_again\_no: \-0.03  
* mutual\_exchange\_yes: \+0.02

Clamp REL to \[0.05, 0.95\].

#### Decay

Use exponential decay by age of signal:

`effective_weight = base_weight * exp(-age_days / half_life_days)`

Recommended `half_life_days = 90`.

#### Minimum Sample Threshold

If user has fewer than `N = 3` qualifying post-event outcomes, REL should remain near neutral (0.5) with limited movement.

Implementation:

* Compute raw updated REL.  
* If sample\_count \< 3, blend:

`REL = 0.5 * (1 - alpha) + raw * alpha` where `alpha = sample_count/3`.

### Activity Weight Overrides

Users declare activities \+ motive weights in onboarding. Learning can adjust these gently.

#### Signals

* If user says “do again” after a LinkUp with a given activity tag, increase that activity’s weight slightly.  
* If user rejects a preview or declines exchange consistently for a given activity tag, decrease slightly.

#### Update Rule

Maintain `activity_weight_overrides` as deltas applied on top of the base profile.

For activity tag `t`:

* positive outcome: `delta_t += +0.05`  
* negative outcome: `delta_t += -0.03`

Clamp each delta to \[-0.3, \+0.3\].

Normalize final activity weights during matching by:

`final_weight_t = clamp(base_weight_t + delta_t, 0, 1)`

#### Minimum Evidence

Do not modify deltas until at least 2 signals related to that tag exist.

### Time Window Overrides

Time preferences can drift; learning should only adjust when evidence is strong.

#### Signals

* attended events and “do again” for specific day/time windows.

#### Update Rule

Track counts by coarse buckets (weekday/weekend, morning/afternoon/evening).

* If bucket has ≥ 3 attended outcomes and user repeatedly attends in that bucket, increase preference weight for that bucket.  
* If user repeatedly no-shows for a bucket, decrease slightly.

Never fully remove availability based on learning. Learning only re-weights within declared availability.

### Attraction And Aversion Tags (Optional, Bounded)

For explainability and diversity control, track coarse tags:

* preferred group size  
* preferred activity families  
* preferred social energy

Rules:

* Tags must not encode sensitive traits.  
* Store as counters with decay.

## Update Pipeline

### Ingestion

Whenever an outcome occurs, write a `learning_signals` row with a stable idempotency key.

Examples:

* attendance: `ls:attended:{linkup_id}:{user_id}`  
* do again: `ls:do_again:{linkup_id}:{user_id}`  
* mutual exchange: `ls:exchange_yes:{exchange_id}:{user_id}`  
* preview reject: `ls:preview_reject:{match_id}:{user_id}`

### Batch Update Job

A scheduled job runs periodically to update derived states.

* Frequency: daily (MVP), or every 6 hours if needed.  
* For each job run:  
  * Query signals since last successful run.  
  * Group by `user_id`.  
  * Apply deterministic update functions.  
  * Write `user_derived_state` with optimistic concurrency.

### Idempotency

* `learning_jobs.run_key` ensures each batch run is processed once.  
* Signal `idempotency_key` ensures each signal is ingested once.  
* Derived state updates are pure functions of (previous snapshot, new signals) and are safe to recompute.

### Replay

If corruption is suspected, you must be able to rebuild `user_derived_state` by replaying all signals for each user.

Recommended approach:

* Add an admin-only “rebuild derived state” job that recomputes from scratch using signals.

## Integration With Matching (Doc 09\)

Matching reads derived state overlays:

* REL component uses `user_derived_state.rel_score`.  
* ACT uses base activity weights \+ overrides.  
* TIME uses declared windows \+ overrides.

If `user_derived_state` missing, matching uses neutral defaults.

## Edge Cases

* Sparse users / cold start:  
  * Use neutral REL.  
  * Avoid overfitting activity/time adjustments.  
* Bad actor manipulation:  
  * Do not allow learning from safety holds as positive signals.  
  * If user is under review, freeze updates.  
* No-show penalties:  
  * Must decay; do not permanently punish.  
* Conflicting signals:  
  * “Attended” but “do again no” counts as mixed; apply both small updates.  
* Data gaps:  
  * If a LinkUp outcome is missing, do not infer.

## Testing Plan

### Unit Tests

* REL update computation with decay.  
* Sample threshold blending.  
* Activity delta clamping and normalization.  
* Time window bucket logic.  
* Sanitizer removes phone/email patterns from feedback.

### Integration Tests

* Signal ingestion idempotency under retries.  
* Batch job processes only new signals.  
* Derived state writes handle concurrent updates via versioning.  
* Replay rebuild produces same snapshot.

### End-To-End Tests

Simulate a user:

1. Cold start REL \= 0.5.  
2. Attend 3 LinkUps and say do-again yes twice.  
3. Run learning job.  
4. Verify REL increases within expected bounds.  
5. Verify activity overrides adjust only for tags present.  
6. Verify matching uses updated REL in scoring.

## Production Readiness

### Observability

Emit metrics/logs (Doc 05):

* `learning_signal_ingested`  
* `learning_signal_duplicate`  
* `learning_job_started/completed/failed`  
* `derived_state_updated`  
* `derived_state_rebuild_started/completed`

Include:

* `correlation_id`  
* `learning_job_id`  
* `user_id` (in logs, not metrics dimensions if too high cardinality)

### Cost Controls

* Batch updates, not per-event recomputation.  
* Cap signals processed per job.  
* Use incremental windows with checkpoints.

### Wiring Verification

In staging:

1. Create a LinkUp and submit outcomes.  
2. Confirm signals are ingested with correct idempotency keys.  
3. Run learning job manually.  
4. Verify derived state updates.  
5. Run a match run and confirm scores reflect new REL.

## Implementation Checklist

* Add `learning_signals`, `user_derived_state`, `learning_jobs` tables if not present.  
* Implement signal ingestion hooks from:  
  * post-event outcomes  
  * preview actions  
  * contact exchange  
  * blocks/reports  
* Implement feedback sanitizer.  
* Implement batch learning job with checkpoints and idempotency.  
* Implement derived state replay rebuild tool (admin-only).  
* Integrate derived state reads into matching.  
* Add observability events and dashboards.

