# Compatibility Scoring And Matching Algorithm

## Summary

This document defines the matching pipeline for JOSH 3.0: how the system selects eligible candidates, computes compatibility scores, ranks candidates, applies tie-breakers and relaxations, and outputs a LinkUp candidate set. It is designed to be implementation-ready and deterministic under retries, while leaving room for iterative tuning.

The core process is two-stage: hard filters first (eligibility, region, safety, mutual constraints, profile state), then a weighted scoring model across stored coordination signals plus system-level constraints (recency, diversity, capacity, and fatigue controls). The output includes explainability fields for user messaging, admin debugging, and model iteration.

The 1:1 Match Preview mode from JOSH 2.0 is deprecated. This spec covers LinkUp formation only.

---

## Goals

* Produce stable, high-quality LinkUp candidate sets using explicitly defined filters, scores, and tie-breakers.  
* Support the 3.0 profile architecture: 6 coordination dimensions, 3 coordination signals, activity patterns with motive weights.  
* Enforce the complete\_invited hard filter at every eligibility check call site.  
* Be safe under retries, concurrency, and delayed jobs.  
* Preserve user safety and consent via hard constraints and safety overrides.  
* Provide explainability artifacts for debugging and iteration.

## Non-Goals

* End-to-end learning, bandits, or automated weight tuning (covered by Learning And Adaptation System spec).  
* Novel embedding-based similarity search or heavy vector infrastructure (deferred).  
* Sophisticated graph matching or optimal assignment across the entire pool (deferred).  
* Real-time "who is online now" availability matching (deferred).  
* Plan Circle compatibility scoring — Plan Circle coordination uses profile signals for passive awareness only, not scored matching. See Plan Circle section below.  
* Layer B (compatibility layer) scoring — schema exists, fields are nullable, not populated at MVP, not read by any matching logic at MVP.

## Key Decisions And Trade-Offs

* Hard filters \+ weighted sum scoring: easier to implement, debug, and tune than opaque models.  
* Deterministic ranking with bounded randomness: improves reliability and reduces repeated identical matches.  
* Explainability stored alongside results: increases storage and complexity, but enables trustworthy user messaging and operations.  
* LinkUp selection uses greedy construction: simpler than combinatorial optimization; acceptable for MVP group sizes.  
* complete\_invited is a hard filter, not a soft signal: users who joined via invitation and have not completed the full interview must never enter the stranger-matching pool. This is enforced at the query level and verified at every call site.

## Definitions

* Candidate: A user eligible to be considered for LinkUp matching.  
* Hard Filters: Boolean rules that must pass; failure excludes the candidate.  
* Soft Constraints: Preferences that influence scoring but do not exclude.  
* Score: Numeric value representing compatibility; higher is better.  
* Explainability: A structured object describing the major score contributors and disqualifiers.  
* Relaxation: Step-wise loosening of some hard constraints when the pool is too small.  
* Coordination Layer (Layer A): The profile signals used for matching at MVP — 6 coordination dimensions, 3 coordination signals, activity patterns, preferences.  
* Compatibility Layer (Layer B): Extended profile signals reserved for future paid tiers — `personality_substrate`, `relational_style`, `values_orientation`. Present in schema as nullable JSONB. Not read or written at MVP.

---

## Profile Architecture And Layer Separation

### Layer A — Coordination Layer (MVP Matching)

All matching at MVP uses Layer A signals only.

Coordination dimensions (6):

* `social_energy` — preference for high-stimulation vs. low-stimulation social environments  
* `social_pace` — preference for spontaneous vs. structured plans  
* `conversation_depth` — preference for surface-level vs. substantive conversation  
* `adventure_orientation` — preference for familiar vs. novel experiences  
* `group_dynamic` — preference for leading vs. following vs. collaborating in group settings  
* `values_proximity` — importance of shared values and worldview in connections

Each dimension: `range_value` (float 0–1), `confidence` (float 0–1), `freshness_days` (integer).

Coordination signals (3):

* `scheduling_availability` — time buckets when the user is typically available  
* `notice_preference` — how far in advance plans need to be confirmed  
* `coordination_style` — how the user prefers to handle logistics (delegating vs. co-planning)

Activity patterns: array of `{ activity_key, motive_weights, constraints, preferred_windows, confidence }`.

Preferences: `group_size_pref`, `time_preferences`, `noise_sensitivity`, `outdoor_preference`.

### Layer B — Compatibility Layer (Reserved, Not Used At MVP)

Fields present in `profiles` schema as nullable JSONB:

* `personality_substrate`  
* `relational_style`  
* `values_orientation`

These fields are never populated during the MVP interview. They are never read by any matching, scoring, or eligibility logic at MVP. Any code that reads Layer B fields is a bug at MVP. Reserved for future paid friendship-matching tiers.

---

## Inputs

### Required User Signals

The matching engine reads from the coordination layer only:

* 6 coordination dimensions with confidence values  
* 3 coordination signals  
* Activity patterns with motive weights  
* Boundaries and dealbreakers  
* Group size and time preferences  
* Location (region / coarse area, privacy-preserving)

### System Signals

* Region open / density status  
* Subscription and entitlements status  
* Safety status (holds, strikes, blocks)  
* Match history and fatigue controls  
* Pool density metrics per region  
* Profile state (used for complete\_invited hard filter)

---

## Outputs

### For LinkUp Mode

A LinkUp candidate set satisfying:

* Size N (min and max per LinkUp Brief)  
* Time window compatibility  
* Activity compatibility threshold  
* Safety and mutual constraints  
* Group cohesion score and per-edge scores  
* Explainability object per candidate

---

## Hard Filters

Hard filters are applied first. Any failure excludes the candidate entirely.

### 1\. Profile State Filter (complete\_invited Hard Rule)

Candidates with `profile_state = complete_invited` are excluded from the stranger-matching pool without exception. This filter must be applied at the query level — do not retrieve complete\_invited profiles into the candidate pool at all.

Every call to `evaluateEligibility({ userId, action_type: 'can_initiate_linkup' })` must verify that the subject user's `profile_state` is `complete_mvp` or `complete_full`. A user with `complete_invited` cannot initiate a LinkUp or be matched into one.

This is the highest-priority hard filter. It is never relaxed. It is never overridden by pool size constraints.

### 2\. Eligibility Filters

* Region: candidate's region must be open for LinkUps  
* Account status: phone verified, not deleted, not suspended  
* Entitlements: both subject and candidate must hold active subscriptions  
* Profile completeness: `profile_state` must be `complete_mvp` or `complete_full`

### 3\. Safety Filters

* Neither user on a safety hold that prevents matching  
* Candidate not flagged as "do not match"  
* No block relationship in either direction

### 4\. Recency And Capacity Filters

* Candidate not already in an active LinkUp in the same time window  
* Candidate not recently introduced to the subject within `RECENCY_COOLDOWN_DAYS` (default 30\)  
* Candidate not at max active conversations or pending LinkUps

### 5\. Dealbreaker Filters

Hard dealbreakers from profile signals:

* Time window non-overlap (no compatible scheduling\_availability buckets)  
* Group size constraint conflict (candidate refuses groups, or min/max incompatibility)  
* Boundary conflicts (e.g., "no alcohol" vs. activity requiring alcohol)  
* Notice preference extreme mismatch (if both extremes explicitly stated)

Dealbreakers must be explicit and limited. Do not invent hidden rules.

---

## Scoring Model

### Overview

After hard filters, compute a final score:

`final_score = Σ (weight_i * component_i)`

Each component is normalized to a 0–1 range. All weights are versioned. The default weight set is the starting configuration and should be tuned based on behavioral outcomes.

### Scoring Components

#### Coordination Dimension Similarity (CDS)

Replaces the 2.0 Friend Fingerprint Similarity component.

For each of the 6 coordination dimensions, compute per-dimension similarity:

`dim_similarity = 1 - min(1, |a.range_value - b.range_value|)`

Weight each dimension's contribution by the minimum confidence of the two profiles on that dimension:

`dim_contribution = dim_similarity * min(a.confidence, b.confidence)`

CDS is the average over all 6 dimensions with available confidence on both sides.

If a dimension is missing from one or both profiles, exclude it from the average and reduce the CDS weight contribution proportionally. Do not substitute neutral values.

#### Activity Compatibility (ACT)

Measures overlap in activity patterns and motive weight alignment.

For each activity shared by both users:

`shared_motive = Σ over motives min(subject_weight, candidate_weight)`

Sum across all shared activities, normalize by the subject's total motive weight:

`ACT = shared_motive_sum / Σ subject_motive_weights`

Add a bonus if there are at least K=2 shared activities with activity-level confidence \>= 0.50 on both sides.

#### Time Window Compatibility (TIME)

Based on `scheduling_availability` signal and `time_preferences`.

Compute overlap across preferred time buckets. Normalize by the subject's available bucket count.

`TIME = matched_buckets / subject_total_buckets`

Clamp to \[0,1\].

If `scheduling_availability` is missing for either user, TIME \= 0.5 (neutral). Do not exclude the candidate — scheduling signals are captured early in the abbreviated interview and may be present even for newer profiles.

#### Notice Preference Alignment (NOTICE)

Based on `notice_preference` signal.

Score \= 1 if both users are within one bucket of each other (same-day / 1-day / 2-3 days / week+). Score \= 0.5 if two buckets apart. Score \= 0 if three or more buckets apart.

If either user's `notice_preference` is missing, NOTICE \= 0.5 (neutral).

#### Proximity (PROX)

* Score \= 1 if same city or zone  
* Score \= 0.5 if adjacent zone within region  
* Score \= 0 if different region (should be excluded by hard filter, but include as a guard)

Must use coarse geographic buckets only. Never expose or compute precise location.

#### Reliability (REL)

A bounded score derived from post-event behavioral outcomes:

* Attendance rate  
* Do-again rate (positive post-activity checkin signal)  
* No-show penalty

For cold start (insufficient behavioral history): REL \= 0.5 (neutral). REL penalty decays over time. No-show history must not be permanent. Decay rules are defined in the Learning And Adaptation System spec.

#### Novelty And Diversity (NOV)

Penalizes repeated matching within too-narrow a cluster.

If archetype tracking is available: apply penalty when the candidate is in the same archetype cluster as the subject's two most recent matches. If not available at MVP: NOV \= 0.5 (neutral).

### Default Weight Set (v1)

```
weights_version = "scoring-v1"
weights = {
  CDS:    0.30,
  ACT:    0.25,
  TIME:   0.15,
  NOTICE: 0.10,
  PROX:   0.10,
  REL:    0.05,
  NOV:    0.05
}
```

These are starting values. Weights must be versioned and stored with every match run. Do not change weights without bumping `weights_version` and recording a reason.

---

## Ranking, Tie-Breakers, And Randomness

### Ranking

Rank candidates by `final_score desc`.

### Tie-Breakers

When two candidates have the same score within `EPS = 0.001`, apply in order:

1. Higher TIME  
2. Higher ACT  
3. Lower recency (longer since last match exposure)  
4. Random stable hash: `hash(subject_user_id + candidate_user_id + run_key)`

### Bounded Randomness (Optional)

If slight exploration is desired without instability:

* Take top M candidates (e.g., 5\)  
* Choose using softmax over scores with low temperature  
* Seed with `(subject_user_id, run_key)` so retries are deterministic

If not implemented, choose the top candidate deterministically.

---

## Relaxation Strategy

Relaxations apply only when the eligible pool falls below a minimum threshold. The complete\_invited hard filter is never relaxed regardless of pool size.

### Pool Thresholds

* LinkUp mode requires `MIN_POOL_LINKUP = target_size * 3` eligible candidates (tunable)

### Relaxation Levels

Level 0 (Default): All hard filters enforced.

Level 1: Expand time window matching to adjacent buckets. Lower minimum activity overlap threshold.

Level 2: Expand proximity buckets within the same region.

Level 3: Reduce recency cooldown (e.g., 30 → 14 days) except for explicitly rejected pairs.

Level 4 (Last Resort, Must Be Explicit In Policy): Allow candidates with partial dealbreaker mismatch only if the dealbreaker is marked "soft-dealbreaker" in profile signals.

If the pool remains insufficient after Level 4: reduce target LinkUp size within min bound, or delay the event and notify the initiating user.

All relaxation decisions must be stored in `match_runs.params`.

---

## LinkUp Candidate Selection

LinkUp selection must satisfy group constraints and maximize group cohesion.

### Candidate Pool

Apply all hard filters. Add LinkUp-specific filters:

* Must support group events (group\_dynamic not explicitly solo-only)  
* Must match the required time window  
* Must meet minimum activity compatibility with the LinkUp Brief

### Group Construction Algorithm (Greedy)

Given a LinkUp Brief and a filtered candidate pool:

1. Choose a seed candidate: highest REL score in the pool, or highest pairwise score against the Brief initiator.  
2. Iteratively add the next candidate that maximizes:

`group_score = average(pairwise_score(existing_member, new_candidate)) + brief_score(new_candidate)`

3. Enforce at each addition:  
   * No block relationship between new candidate and any existing member  
   * Time window overlap sufficient with the group  
   * Activity overlap meets threshold against the Brief  
4. Stop when size reaches target or pool is exhausted.

### Pairwise Score

Reuse the same scoring components. Omit PROX if all candidates are already within the same region.

### Cohesion Threshold

Require:

* Average pairwise score ≥ `COHESION_MIN` (tunable, default 0.55)  
* No individual member below `INDIVIDUAL_MIN` compatibility vs. Brief (tunable, default 0.40)

If constraints fail: backtrack once (remove worst-fit member) and try the next candidate. If still failing: apply relaxation.

### Output

* Selected participant IDs  
* Group cohesion score  
* Per-member brief\_score  
* Explainability: top shared themes and shared activities

---

## Plan Circle And Compatibility Scoring

Plan Circle coordination does not use the matching pipeline. There is no scored candidate selection for named-contact plans.

At MVP, JOSH performs one passive awareness check when making a solo activity suggestion: it silently evaluates whether any of the user's Plan Circle contacts have activity patterns compatible with the suggested activity. This is not a score — it is a binary flag used to decide whether to mention the possibility of inviting a contact. No score is stored, no match record is created.

If this awareness check expands in future versions, it will be defined as an explicit addition to this spec.

---

## Explainability And User Messaging

Explainability must support admin debugging and safe user messaging. It must never expose private attributes, safety status, exact location, or internal scoring mechanics.

### Explainability Schema

`explainability` jsonb must include:

```json
{
  "top_reasons": [
    { "key": "shared_activities", "label": "You both enjoy hiking and coffee walks", "contribution": 0.18 }
  ],
  "dealbreakers_checked": [
    { "key": "time_window", "passed": true }
  ],
  "activity_overlap": {
    "shared_activities": ["hiking", "coffee"],
    "overlap_score": 0.72
  },
  "time_overlap": {
    "windows_matched": ["weekend_morning", "weekday_evening"],
    "overlap_score": 0.60
  },
  "notes_for_admin": "CDS confidence low on conversation_depth — both profiles early-stage"
}
```

Recommended user-facing reason types:

* Shared activities  
* Shared time preferences  
* Similar social energy  
* Similar planning style

---

## Data Structures

### match\_runs Table

* `id` (uuid)  
* `mode` enum: `linkup`  
* `region_id`  
* `subject_user_id` (nullable for region batch runs)  
* `run_key` (text, unique)  
* `created_at`  
* `completed_at`  
* `status` enum: `started | completed | failed`  
* `error_code` / `error_detail` (nullable)  
* `params` jsonb (weights\_version, relaxation\_level, pool\_size\_at\_run)

Uniqueness: `unique(run_key)`

### match\_candidates Table

* `match_run_id`  
* `subject_user_id`  
* `candidate_user_id`  
* `passed_hard_filters` boolean  
* `final_score` numeric  
* `component_scores` jsonb  
* `explainability` jsonb  
* `created_at`

Indexes:

* `(subject_user_id, final_score desc)`  
* `(match_run_id)`

---

## Idempotency And Retry Safety

### Match Run Key

Define a stable run key per invocation:

* Region batch: `match:linkup:{region_id}:{YYYYMMDD}:{slot}`  
* Per user: `match:linkup:{user_id}:{YYYYMMDD}:{slot}`

Slot is a time bucket (morning / afternoon / evening) or an explicit scheduler tick.

### Deterministic Outputs

Given the same inputs and run\_key, ranking must be stable. If bounded randomness is used, seed it deterministically with `(subject_user_id, run_key)`.

### Concurrency Controls

Use the locking strategy from the Domain Model And State Machines spec to prevent multiple active LinkUp assignments per user in the same time window. The matching job must not over-allocate — LinkUp orchestration applies its own locks.

---

## Edge Cases

* Missing coordination dimension signals: exclude the dimension from CDS average and reduce weight contribution proportionally. Do not substitute neutral values. If more than 3 of 6 dimensions are missing, exclude the candidate from the pool.  
* complete\_invited profiles: excluded by hard filter at query time. Never reached by scoring logic.  
* Sparse regions: apply relaxations up to configured maximum. If still sparse, defer matching and notify the user via post-solo-suggestion message that LinkUps are coming.  
* High churn / repeated no-shows: REL penalty decays over time per Learning And Adaptation System spec. No penalty is permanent.  
* Conflicting user preferences: explicit dealbreakers are hard. Vague preferences are soft.

---

## Dependencies

* Domain Model And State Machines spec: states, locks, and profile state enum.  
* Database Schema spec: profiles, match\_runs, match\_candidates, activity\_patterns tables.  
* Profile Interview And Signal Extraction Spec: coordination dimension and signal definitions, completeness thresholds, profile\_state enum values.  
* Eligibility And Entitlements Enforcement spec: `evaluateEligibility()` — called before match run begins.  
* Link Up Orchestration Contract: LinkUp Brief schema; consumes match output.  
* Learning And Adaptation System spec: REL score computation and decay rules; behavioral outcome signals from post-activity checkins.

---

## Testing Plan

### Unit Tests

* CDS computation with full, partial, and missing dimension confidence values.  
* ACT overlap with motive weights including cross-activity inference.  
* TIME overlap with matching and non-matching availability buckets.  
* NOTICE alignment across all bucket distance combinations.  
* Tie-breaker determinism under identical scores.  
* Relaxation progression respects complete\_invited hard filter even at Level 4\.  
* `evaluateEligibility()` correctly blocks complete\_invited users from LinkUp initiation.

### Integration Tests

* Candidate pool query excludes complete\_invited profiles at the query level.  
* Block and safety holds prevent selection.  
* Match run idempotency prevents duplicates under retry.  
* Deterministic selection under retries.  
* Relaxation level stored correctly in match\_runs.params.

### End-To-End Tests

* Populate a synthetic region pool with known profiles.  
* Run matching and verify:  
  * Top candidate matches expected based on controlled signals.  
  * complete\_invited candidate never appears in pool.  
  * Relaxations apply only when pool thresholds not met.  
  * LinkUp group construction yields a cohesive set meeting cohesion threshold.  
  * Explainability includes expected reasons.

---

## Production Readiness

### Observability

Emit logs and metrics per Observability And Monitoring Stack conventions:

* `match_run_started` / `match_run_completed` / `match_run_failed`  
* `match_pool_size` gauge (after hard filters)  
* `match_pool_complete_invited_excluded` counter (audit signal — should always be \> 0 in active regions)  
* `match_relaxation_level_applied` counter  
* `match_candidate_scored` counter  
* `match_candidate_selected` counter  
* `linkup_group_constructed` counter

All events must include: `correlation_id`, `match_run_id`, `region_id`, `weights_version`.

### Operational Guardrails

* Cap max candidates scored per run to control LLM and compute costs.  
* Enforce a maximum run duration; abort and retry later.  
* Record `weights_version` and `relaxation_level` for every run.  
* Alert if `match_pool_complete_invited_excluded` is zero for a region with active invited users — this may indicate the hard filter is not firing.

### Wiring Verification

In staging:

1. Create a test region with 30+ synthetic profiles including at least 2 complete\_invited profiles.  
2. Trigger a match run.  
3. Verify:  
   * complete\_invited profiles are absent from match\_candidates.  
   * Pool size and filter exclusions are logged.  
   * Candidate scoring is stored with all component\_scores.  
   * Ranking is deterministic across two identical runs.  
   * Group construction produces a valid set meeting cohesion threshold.  
   * Explainability object is populated with expected fields.

---

## Implementation Checklist

* Confirm `match_runs` and `match_candidates` tables exist with correct indexes.  
* Implement candidate pool query with complete\_invited hard filter at query level.  
* Implement all hard filters with explicit test coverage for each.  
* Implement CDS, ACT, TIME, NOTICE, PROX, REL, NOV scoring components.  
* Implement explainability object generation.  
* Implement ranking with deterministic tie-breakers.  
* Implement relaxation strategy — verify complete\_invited filter is not included in relaxation path.  
* Implement LinkUp group construction algorithm.  
* Implement Plan Circle passive awareness check (separate from match pipeline).  
* Add observability events and alerting including complete\_invited exclusion counter.  
* Add synthetic test harness with controlled profile pools including complete\_invited users.