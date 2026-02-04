# Compatibility Scoring And Matching Algorithm (JOSH 2.0)

## *Document \#9*

## Summary

This document defines the matching pipeline for JOSH 2.0: how the system selects eligible candidates, computes compatibility scores, ranks candidates, applies tie-breakers and relaxations, and outputs either a 1:1 intro or a LinkUp candidate set. It is designed to be implementation-ready and deterministic under retries, while still leaving room for iterative tuning.

The core idea is a two-stage process: hard filters first (eligibility, region, safety, mutual constraints), then a weighted scoring model across the user’s stored signals (Friend Fingerprint and preferences) plus system-level constraints (recency, diversity, capacity, and fatigue controls). The output includes explainability fields that can be used for user messaging, admin debugging, and model iteration.

## Goals

* Produce stable, high-quality match recommendations using explicitly defined filters, scores, and tie-breakers.  
* Support both product modes:  
  * 1:1 Match Preview (legacy mode)  
  * LinkUp formation (group mode)  
* Be safe under retries, concurrency, and delayed jobs.  
* Preserve user safety and consent via hard constraints and safety overrides.  
* Provide explainability artifacts for debugging and iteration.

## Non-Goals

* End-to-end learning, bandits, or automated weight tuning (covered by Doc 10).  
* Novel embedding-based similarity search or heavy vector infrastructure (deferred unless added later).  
* Sophisticated graph matching or optimal assignment across the entire pool (deferred).  
* Real-time “who is online now” availability matching (deferred).

## Key Decisions And Trade-Offs

* Hard filters \+ weighted sum scoring: easier to implement, debug, and tune than opaque models.  
* Deterministic ranking with bounded randomness: improves reliability and reduces repeated identical matches; randomness is optional and tightly controlled.  
* Explainability stored alongside results: increases storage and complexity, but enables trustworthy user messaging and operations.  
* LinkUp selection uses greedy construction with constraints: simpler than combinatorial optimization; acceptable for MVP group sizes.

## Definitions

* Candidate: A user eligible to be considered for matching with a given user.  
* Hard Filters: Boolean rules that must pass; failure excludes the candidate.  
* Soft Constraints: Preferences that influence scoring but do not exclude.  
* Score: Numeric value representing compatibility; higher is better.  
* Explainability: A structured object describing the major score contributors and disqualifiers.  
* Relaxation: A step-wise loosening of some hard constraints when the pool is too small.

## Inputs

### Required User Signals (From Doc 06\)

The matching engine consumes a normalized representation of:

* Friend Fingerprint (12 factors)  
* Activity patterns with motive weights  
* Boundaries and dealbreakers  
* Group/time preferences  
* Communication style and energy  
* Location (region / coarse area, privacy-preserving)

These live in a canonical profile JSON plus derived structured fields.

### System Signals

* Region open / gating status  
* Subscription and entitlements status (Doc 11\)  
* Safety status (holds, strikes, blocks)  
* Match history and fatigue controls  
* Pool density metrics per region

## Outputs

### For 1:1 Mode

* A ranked list of candidate user IDs with:  
  * `final_score`  
  * `component_scores` (breakdown)  
  * `explainability` (human-readable reasons)  
  * `filter_rejections` (if stored for debugging)

Typically only the top candidate is consumed into the preview pipeline.

### For LinkUp Mode

* A LinkUp candidate set satisfying constraints:  
  * size `N` (min and max)  
  * time window compatibility  
  * activity compatibility threshold  
  * safety and mutual constraints  
  * a group cohesion score and per-edge scores

## Scope Boundaries

### In Scope

* Eligibility filters and compatibility scoring for both modes.  
* Ranking, tie-breakers, and relaxations.  
* Deterministic selection logic.  
* Explainability object schema.

### Deferred

* ML-based weight tuning and automated experimentation (Doc 10).  
* Embedding retrieval or vector search.  
* Full global optimization (Hungarian, max matching) across pools.

## Architecture Placement

* Matching is invoked by an async job (scheduler/queue) per region or per user.  
* The job reads normalized profile signals and system constraints.  
* The job writes results to match-intent tables (or a domain event stream) consumed by preview creation (1:1) or LinkUp orchestration (group).

The matching job must be idempotent per run key.

## Data Structures

This doc assumes the schema from Doc 03 exists. If your schema differs, preserve semantics.

### Canonical Match Run

Create a durable record of each match run for observability and debugging.

Table: `match_runs` (recommended; if already exists, adapt)

* `id` (uuid)  
* `mode` enum: `one_to_one | linkup`  
* `region_id`  
* `subject_user_id` (nullable for region batch runs)  
* `run_key` (text, unique)  
* `created_at`  
* `completed_at`  
* `status` enum: `started | completed | failed`  
* `error_code` / `error_detail` (nullable)  
* `params` jsonb (weights version, relaxation level)

Uniqueness: `unique(run_key)`

### Candidate Score Record

Table: `match_candidates` (recommended)

* `match_run_id`  
* `subject_user_id`  
* `candidate_user_id`  
* `mode`  
* `passed_hard_filters` boolean  
* `final_score` numeric  
* `component_scores` jsonb  
* `explainability` jsonb  
* `created_at`

Indexes:

* `(subject_user_id, mode, final_score desc)`  
* `(match_run_id)`

### Explainability Schema

`explainability` jsonb should include:

* `top_reasons`: array of `{key, label, contribution}`  
* `dealbreakers_checked`: array of `{key, passed}`  
* `activity_overlap`: `{shared_activities: [...], overlap_score}`  
* `time_overlap`: `{windows_matched: [...], overlap_score}`  
* `notes_for_admin`: optional

Keep it bounded in size.

## Hard Filters

Hard filters are applied first. If any fail, the candidate is excluded.

### Eligibility Filters

1. Region eligibility  
   * Same active region OR region-crossing allowed by policy (default: no)  
   * Candidate’s region must be open  
2. Account status  
   * Phone verified  
   * Not deleted / not suspended  
3. Entitlements (Doc 11\)  
   * Subject user must be eligible to receive a match  
   * Candidate user must be eligible to participate  
4. Safety  
   * Neither user on a safety hold that prevents matching  
   * Candidate not flagged as “do not match”  
5. Blocks  
   * No block relationship either direction  
6. Recent match prevention  
   * Candidate not already in an active preview with subject  
   * Candidate not recently introduced within `RECENCY_COOLDOWN_DAYS` (default 30\)  
7. Availability / capacity  
   * Candidate not at max active conversations/previews  
   * For LinkUp: candidate not already locked into another LinkUp in same time window

### Dealbreaker Filters

Dealbreakers come from profile signals and are treated as hard filters.

Examples (tunable):

* Age range requirements  
* Group-size constraints (user refuses groups)  
* Time window non-overlap (no compatible times)  
* Boundary conflicts (e.g., “no drinking” vs “bar crawl only”)

Dealbreakers must be explicit and limited. Avoid inventing hidden rules.

## Scoring Model

### Overview

After hard filters, compute a final score:

`final_score = Σ (weight_i * component_i)`

Each component is normalized to a 0–1 range.

### Recommended Components

1. Friend Fingerprint Similarity (FFS)  
   * Measures alignment across 12 factors.  
   * Use weighted distance or cosine-like similarity across normalized factor vectors.  
2. Activity Compatibility (ACT)  
   * Measures overlap in activity categories and motive weights.  
   * Reward shared “high weight” motives.  
3. Time Window Compatibility (TIME)  
   * Based on user’s preferred days/times and group cadence.  
4. Communication Style Alignment (COMMS)  
   * Energy, frequency, depth, humor, texting style.  
5. Novelty And Diversity (NOV)  
   * Encourages not repeating the same “type” repeatedly.  
   * Penalty for matching within too-narrow a cluster, if you track clusters.  
6. Proximity (PROX)  
   * Coarse region proximity score.  
   * Must not reveal precise location.  
7. Reliability (REL)  
   * Encourages candidates with a record of attendance/positive feedback.  
   * Must be bounded and not permanently punish new users.

### Default Weight Set (Versioned)

Store weights as a versioned config:

* `weights_version = v1`  
* `w = {FFS: 0.30, ACT: 0.25, TIME: 0.15, COMMS: 0.10, PROX: 0.10, REL: 0.05, NOV: 0.05}`

These are starting values only and should be tuned. The key requirement is that weights are explicit and versioned.

### Component Definitions

#### Friend Fingerprint Similarity (FFS)

* Represent each factor as normalized numeric or categorical mapping.  
* For numeric: similarity \= `1 - min(1, |a-b|/range)`  
* For categorical: similarity \= 1 if equal, else 0, or use partial mapping.

FFS is an average over the 12 factors with optional factor-specific weights.

#### Activity Compatibility (ACT)

* Each user has activities with motive weights.  
* Define overlap as:

`shared = Σ over activities min(w_subject, w_candidate)`

Normalize shared by the subject’s total:

`ACT = shared / Σ w_subject`

Add bonus if there are at least `K` shared activities above a threshold.

#### Time Window Compatibility (TIME)

* Each user defines preferred windows.  
* Compute overlap duration across windows.  
* Normalize by subject availability.

`TIME = overlap_minutes / subject_available_minutes`

Clamp to \[0,1\].

#### Communication Style Alignment (COMMS)

* Map styles to a small vector.  
* Similarity via average factor similarity.

#### Proximity (PROX)

* Score \= 1 if same city/zone, else decay by distance buckets.  
* Must use coarse buckets.

#### Reliability (REL)

* A bounded score from post-event outcomes:  
  * attended rate  
  * do-again rate  
  * no-show penalties

For cold start:

* If insufficient history, REL \= 0.5 (neutral).

#### Novelty And Diversity (NOV)

* If you track “match archetype” tags, NOV penalizes repeating the same archetype too often.  
* If not available, set NOV \= 0.5 (neutral) in v1.

## Ranking, Tie-Breakers, And Randomness

### Ranking

Rank candidates by `final_score desc`.

### Tie-Breakers

When two candidates have the same score within `EPS = 0.001`, apply:

1. Higher TIME  
2. Higher ACT  
3. Lower recency (longer since last match exposure)  
4. Random stable hash tie-breaker

### Bounded Randomness (Optional)

If you want slight exploration without chaos:

* Take top `M` (e.g., 5\)  
* Choose 1 using a softmax over scores with low temperature  
* Seed randomness with `(subject_user_id, run_key)` so retries are deterministic

If not implemented, choose the top candidate deterministically.

## Relaxation Strategy

Relaxations only occur when the eligible pool is below a minimum.

### Pool Thresholds

* 1:1 mode requires `MIN_POOL_ONE_TO_ONE = 10` eligible candidates (tunable)  
* LinkUp mode requires `MIN_POOL_LINKUP = target_size * 3` eligible candidates (tunable)

If pool \< threshold, apply relaxations step-wise.

### Relaxation Levels

Each level relaxes only soft constraints first, then certain dealbreakers only if explicitly allowed.

Level 0 (Default):

* All hard filters enforced

Level 1:

* Expand time window matching to “adjacent” windows  
* Lower minimum activity overlap threshold

Level 2:

* Expand proximity buckets within the same region

Level 3:

* Reduce recency cooldown (e.g., 30 → 14 days) except for explicitly rejected pairs

Level 4 (Last Resort, Must Be Explicit In Policy):

* Allow candidates with partial dealbreaker mismatch only if the dealbreaker is marked “soft-dealbreaker” in profile signals

If still insufficient pool, do not match and instead:

* For 1:1: queue a wait message and retry later  
* For LinkUp: reduce target size within min bound or delay the event

All relaxation decisions must be stored in `match_runs.params`.

## LinkUp Candidate Selection

LinkUp selection must satisfy group constraints and aims to maximize group cohesion.

### Candidate Pool

* Use hard filters as above.  
* Add LinkUp-specific filters:  
  * Must support group events  
  * Must match required time window  
  * Must meet minimum activity compatibility with LinkUp Brief

### Group Construction Algorithm (Greedy)

Given a LinkUp Brief and a candidate pool:

1. Choose a seed user:  
   * Highest REL among pool, or highest score against the brief  
2. Iteratively add the next user that maximizes:

`group_score = average(pairwise_score(existing_member, new_user)) + brief_score(new_user)`

3. Enforce constraints at each addition:  
   * No blocks  
   * Time overlap sufficient with group  
   * Activity overlap meets threshold  
4. Stop when size reaches target or pool exhausted

### Pairwise Score

Reuse the same scoring components but omit PROX if already covered by region.

### Cohesion Threshold

Require:

* Average pairwise score ≥ `COHESION_MIN` (tunable)  
* No member below `INDIVIDUAL_MIN` compatibility vs brief

If constraints fail, backtrack once (remove worst fit) and try next candidate.

### Output

* Selected participant IDs  
* Group cohesion score  
* Explainability: top shared themes and shared activities

## Explainability And User Messaging

Explainability must support:

* Admin debugging: “Why did this happen?”  
* Safe user messaging: “You both love outdoor activities and prefer weekends.”

Rules:

* Never reveal private attributes.  
* Do not mention safety status.  
* Do not mention exact location.

Recommended user-facing reason types:

* Shared activities  
* Shared time preferences  
* Similar social energy  
* Shared values style (if captured)

## Idempotency And Retry Safety

### Match Run Key

Define a stable run key per invocation.

Examples:

* Region batch: `match:{mode}:{region_id}:{YYYYMMDD}:{slot}`  
* Per user: `match:{mode}:{user_id}:{YYYYMMDD}:{slot}`

Slot can be a time bucket (morning/afternoon/evening) or an explicit scheduler tick.

### Deterministic Outputs

* Given the same inputs and run\_key, the ranking must be stable.  
* If bounded randomness is used, seed it deterministically.

### Concurrency Controls

* Use the locking strategy from Doc 02 for preventing multiple active previews per user.  
* For LinkUps, LinkUp orchestration will apply its own locks; matching should not over-allocate.

## Edge Cases

* Missing profile signals:  
  * Use neutral defaults per component and reduce weight contribution.  
  * If too incomplete, exclude candidate from pool until interview completeness threshold met.  
* Sparse regions:  
  * Apply relaxations up to configured maximum.  
  * If still sparse, defer matching and notify user.  
* High churn / repeated no-shows:  
  * REL penalty should not be permanent; include decay (Doc 10).  
* Conflicting user preferences:  
  * Treat explicit dealbreakers as hard.  
  * Treat vague preferences as soft.

## Testing Plan

### Unit Tests

* Each component score computation (FFS, ACT, TIME, COMMS, PROX, REL).  
* Normalization and clamping.  
* Tie-breakers and deterministic hash.  
* Relaxation progression.  
* LinkUp group selection coherence rules.

### Integration Tests

* Candidate pool queries enforce hard filters correctly.  
* Block and safety holds prevent selection.  
* Match run idempotency prevents duplicates.  
* Deterministic selection under retries.

### End-To-End Tests

* Populate a synthetic region pool with known profiles.  
* Run matching and verify:  
  * Top candidate matches expected based on controlled signals.  
  * Relaxations apply only when pool thresholds not met.  
  * LinkUp group selection yields a coherent set.  
  * Explainability includes expected reasons.

## Production Readiness

### Observability

Emit logs and metrics (Doc 05 conventions):

* `match_run_started` / `match_run_completed` / `match_run_failed`  
* `match_pool_size` gauge  
* `match_relaxation_level_applied` counter  
* `match_candidate_scored` counter  
* `match_candidate_selected` counter  
* `linkup_group_constructed` counter

All must include:

* `correlation_id`  
* `match_run_id`  
* `region_id`  
* `mode`

### Operational Guardrails

* Cap max candidates scored per run to control costs.  
* Enforce a maximum run duration; abort and retry later.  
* Record `weights_version` and `relaxation_level` for audit.

### Wiring Verification

In staging:

1. Create a test region with 30 synthetic users.  
2. Populate profiles with known signals.  
3. Trigger a match run (manual).  
4. Verify:  
   * Pool size and filters are correct.  
   * Candidate scoring is stored.  
   * Ranking is deterministic.  
   * Preview creation consumes the selected candidate correctly.  
   * LinkUp selection produces a valid group when in LinkUp mode.

## Implementation Checklist

* Add `match_runs` and `match_candidates` tables (or adapt existing schema) with indexes.  
* Implement candidate pool query with all hard filters.  
* Implement scoring components and normalization.  
* Implement explainability object generation.  
* Implement ranking and deterministic tie-breakers.  
* Implement relaxation strategy with persisted level.  
* Implement LinkUp group construction algorithm.  
* Add observability events and dashboards.  
* Add synthetic test harness for controlled profile pools.