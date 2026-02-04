# Profile Interview And Signal Extraction Spec (JOSH 2.0)

## *Document \#6*

## Summary

This document defines JOSH’s conversational interview: the SMS flow that turns a new user’s natural answers into a structured compatibility profile. The interview is the core product, because everything else (matching accuracy, LinkUp fit, and user trust) depends on capturing the right signals with the right confidence.

The interview is designed to feel human and low-friction. JOSH asks a small number of high-yield questions, uses short choice-based prompts when helpful, and follows a strict rule: ask follow-ups only when they materially improve signal quality. If a user gives vague answers or goes quiet, JOSH recovers gracefully and continues later without losing progress.

This spec is implementation-ready: it includes the interview phases, required extracted signals, storage mapping, validation rules, decision trees, prompt templates for extraction, examples, edge cases, and production readiness wiring.

---

## Scope, Out Of Scope, Deferred

### In Scope

* Interview phase structure and step catalog.  
* Signal extraction requirements for:  
  * Friend Fingerprint (12 factors)  
  * Activity patterns (motive weights, constraints, preferred windows)  
  * Interaction style and group preferences  
  * Values/constraints relevant to safety and comfort  
* Confidence thresholds and update rules.  
* “Why probing” rules (when to ask follow-up questions).  
* Handling refusals, vague responses, negativity.  
* Dropout recovery and progress tracking.  
* Storage mapping to `profiles.fingerprint`, `profiles.activity_patterns`, `profiles.boundaries`, `profiles.preferences`.

### Out Of Scope

* Full long-form personality assessment.  
* Clinical mental health assessment.  
* Diagnoses or medical recommendations.

### Deferred

* Adaptive interview length per region density.  
* Multi-language support.

---

## Key Decisions

1. Short, high-yield interview that supports gradual enrichment  
   * MVP completeness is achievable in a short session.  
   * The system can enrich later via small follow-ups.  
2. Signals are stored as structured fields with confidence  
   * This supports explainable matching and safe learning.  
3. Follow-ups are gated by uncertainty  
   * Only ask “why” or clarifiers when it increases confidence or reduces mismatch risk.  
4. Progress is explicit  
   * Users should know where they are (e.g., “2 of 6 complete”).  
5. No spirals  
   * One clarifier maximum per ambiguous response.

---

## Compatibility Dimensions (Interview Phases)

This interview aligns to your compatibility system: activity patterns \+ motive-based scoring \+ interaction style fit.

### Phase Overview

1. Activity Discovery  
2. Motive Extraction (Why)  
3. Interaction Style  
4. Social Pace And Group Comfort  
5. Values And Boundaries  
6. Practical Constraints (time/location)

MVP goal: reach `complete_mvp` profile state.

---

## Required Extracted Signals

### A) Friend Fingerprint (12 factors)

These are stored in `profiles.fingerprint`.

Each factor must have:

* `range_value` (0..1)  
* `confidence` (0..1)  
* `freshness_days`  
* `sources` (weights from interview vs behavior)

#### Canonical Factors

1. `connection_depth`  
2. `social_energy`  
3. `social_pace`  
4. `novelty_seeking`  
5. `structure_preference`  
6. `humor_style`  
7. `conversation_style`  
8. `emotional_directness`  
9. `adventure_comfort`  
10. `conflict_tolerance`  
11. `values_alignment_importance`  
12. `group_vs_1on1_preference`

Notes:

* Names are stable keys used by matching.  
* Values are inferred from multiple answers when possible.

### B) Activity Patterns

Stored in `profiles.activity_patterns` (array).

Each activity pattern includes:

* `activity_key` (from catalog)  
* `motive_weights` (0..1 per motive; not required to sum to 1\)  
* `constraints` (booleans)  
* `preferred_windows` (time buckets)  
* `confidence`  
* `freshness_days`

#### Motives (Canonical)

* `connection`  
* `comfort`  
* `growth`  
* `play`  
* `restorative`  
* `adventure`

### C) Boundaries And Safety-Relevant Preferences

Stored in `profiles.boundaries`.

* `no_thanks`: list of activity categories  
* `hard_constraints`: booleans or enums (examples: smoking, substances, late\_night)  
* `social_safety`: “meet in public,” “daytime only,” etc.

### D) Preferences

Stored in `profiles.preferences`.

* `group_size_pref`: `{min,max}`  
* `time_preferences`: preferred buckets  
* `noise_sensitivity` (0..1)  
* `outdoor_preference` (0..1)  
* `planning_style`: `spontaneous|balanced|planned`

---

## Interview Step Catalog

The catalog is implemented as a stable list of steps with IDs.

### Step IDs

* `intro_01`  
* `activity_01`  
* `activity_02`  
* `motive_01`  
* `motive_02`  
* `style_01`  
* `style_02`  
* `pace_01`  
* `group_01`  
* `values_01`  
* `boundaries_01`  
* `constraints_01`  
* `wrap_01`

You may add more later, but these IDs should stay stable.

### Step Content (MVP)

#### intro\_01

* Purpose: set expectations, ask consent to continue.  
* Message: short and friendly.

Example:

* “Hey {FirstName}. I’m JOSH. I’ll ask a few quick questions to learn your vibe and match you into small group hangouts. Ready? Reply Yes or Later.”

Rules:

* If `Later`, set a reminder suggestion but do not spam.

#### activity\_01

Goal: capture 2–3 preferred activities.

Prompt:

* “What are 2–3 things you’d genuinely enjoy doing with new friends? (Coffee, walk, museum, climbing, etc.)”

Extraction:

* map to `activity_key` list using catalog matching.  
* if user gives none or vague, ask one clarifier:  
  * “Which sounds closer? A coffee, B walk, C games, D other.”

#### activity\_02

Goal: rank or pick a top activity.

Prompt:

* “If you had to pick one for this week, what would it be?”

Extraction:

* select `active_intent.activity_key`.

#### motive\_01

Goal: extract why they like the top activity.

Prompt:

* “What do you want that to feel like? (Deeper convo, light fun, calm reset, adventure, etc.)”

Extraction:

* map phrases to motive weights.  
* if answer is vague (“idk just chill”): treat as `comfort` \+ `restorative` with lower confidence.

#### motive\_02

Goal: sharpen motive weights and connection depth.

Prompt:

* “Quick pick: A deep conversation, B easygoing laughs, C quiet recharge, D something new.”

Extraction:

* update motive weights \+ fingerprint factors.

#### style\_01

Goal: interaction style.

Prompt:

* “When you meet new people, what’s your best vibe? A curious, B funny, C thoughtful, D energetic.”

Extraction:

* update fingerprint factors: humor style, conversation style, social energy.

#### style\_02

Goal: communication preference.

Prompt:

* “Do you like to talk about ideas, feelings, stories, or plans? Pick 1–2.”

Extraction:

* map to conversation style dimensions.

#### pace\_01

Goal: social pace.

Prompt:

* “How fast do you like friendships to move? A slow and steady, B medium, C fast.”

Extraction:

* update `social_pace`, confidence high.

#### group\_01

Goal: group size comfort.

Prompt:

* “What size group feels best? A 2–3, B 4–6, C 7–10.”

Extraction:

* set `group_size_pref`.

#### values\_01

Goal: values alignment importance.

Prompt:

* “How important is it that friends share your values? A very, B somewhat, C not a big deal.”

Extraction:

* update `values_alignment_importance`.

#### boundaries\_01

Goal: boundaries and no-thanks.

Prompt:

* “Anything you don’t want in a first hang? (Bars, late nights, super loud places, etc.)”

Extraction:

* populate `boundaries.no_thanks` and constraints.

If refusal:

* If user replies “prefer not to say” → store empty, confidence neutral.

#### constraints\_01

Goal: time/location.

Prompt:

* “What times usually work best? A mornings, B afternoons, C evenings, D weekends only.”

Extraction:

* update `time_preferences`.

#### wrap\_01

Goal: confirm progress and what happens next.

Message:

* “Got it. That’s enough to start matching. You can update anything anytime by texting me.”

---

## Progress Tracking

### Progress Model

* Interview progress lives in `profiles.last_interview_step` and optionally a `profiles.preferences.interview_progress` object.  
* Display progress as “X of 6 dimensions.”

### Dropout Recovery

If user stops responding:

* If they return later:  
  * Resume from last step.  
  * Send a short recap: “Want to keep going?”

Rules:

* Do not send reminders more than:  
  * 1 reminder at 2 hours  
  * 1 reminder at 24 hours

Reminders must respect opt-out state.

---

## Signal Extraction And Validation

### Extraction Pipeline

1. Persist inbound message.  
2. Identify current interview step from session.  
3. Build extraction prompt for that step.  
4. Call LLM “extractor” (not the general intent classifier).  
5. Validate JSON schema.  
6. Apply updates to profile (transaction):  
   * update JSON blobs  
   * write `profile_events`  
   * update `profiles.state` if completeness threshold met  
   * advance session state token  
7. Create outbound message job.

### Confidence Rules

* Structured A/B/C replies: confidence boost.  
* Free-form replies: medium confidence.  
* Vague or non-answer: low confidence.

### Completeness Thresholds

Profile becomes `complete_mvp` when:

* At least 8 of 12 fingerprint factors have confidence ≥ 0.55  
* At least 3 activity patterns exist with confidence ≥ 0.60  
* Group size preference captured  
* Time preference captured

Profile becomes `complete_full` when:

* 12/12 factors with confidence ≥ 0.65  
* At least 5 activity patterns  
* Boundaries captured (can be empty but asked)

---

## “Why” Probing Rules

Ask a follow-up “why” question only when:

* Motive weights are too flat or unclear (no motive ≥ 0.55)  
* User gives a contradictory answer compared to earlier signals  
* A mismatch risk is high (e.g., user implies “bars” but boundary says “no bars”)

Max one follow-up per step.

---

## Handling Refusals, Vague, Negative

### Refusals

* If user says “prefer not to say”:  
  * record that step as skipped  
  * do not penalize profile  
  * proceed

### Vague Answers

* If the answer cannot be mapped:  
  * ask one clarifier with choices  
  * if still unclear, store “unknown” and proceed

### Negative Replies

* If user expresses dislike for all suggestions:  
  * offer “Other: tell me what you’d like.”  
  * do not guilt or pressure

---

## LLM Extraction Contract

### Interface

```ts
export type InterviewExtractInput = {
  userId: string;
  stepId: string;
  questionText: string;
  userAnswerText: string;
  currentProfile: {
    fingerprint: Record<string, unknown>;
    activityPatterns: Array<Record<string, unknown>>;
    boundaries: Record<string, unknown>;
    preferences: Record<string, unknown>;
  };
};

export type InterviewExtractOutput = {
  stepId: string;
  extracted: {
    fingerprintPatches?: Array<{ key: string; range_value: number; confidence: number }>;
    activityPatternsAdd?: Array<{
      activity_key: string;
      motive_weights: Record<string, number>;
      constraints?: Record<string, boolean>;
      preferred_windows?: string[];
      confidence: number;
    }>;
    boundariesPatch?: Record<string, unknown>;
    preferencesPatch?: Record<string, unknown>;
  };
  notes?: {
    needsFollowUp?: boolean;
    followUpQuestion?: string;
    followUpOptions?: Array<{ key: string; label: string }>;
  };
};
```

### Output Constraints

* Valid JSON only.  
* Values must be in range (0..1) where specified.  
* If unsure, leave fields empty rather than guessing.

---

## Examples

### Example: Motive Extraction

User:

* “Coffee with new friends sounds like a calm reset and a chance for real conversation.”

Extracted:

```json
{
  "activityPatternsAdd": [
    {
      "activity_key": "coffee",
      "motive_weights": {"restorative": 0.7, "connection": 0.75, "comfort": 0.55},
      "constraints": {"quiet": true, "indoor": true},
      "preferred_windows": ["morning", "day"],
      "confidence": 0.72
    }
  ],
  "fingerprintPatches": [
    {"key": "connection_depth", "range_value": 0.7, "confidence": 0.62},
    {"key": "social_pace", "range_value": 0.45, "confidence": 0.55}
  ]
}
```

### Example: Refusal

User:

* “Prefer not to answer.”

System:

* store no change, mark step complete, proceed.

---

## Dependencies

* Document 2: profile state machine and update safety rules.  
* Document 3: schema mapping to `profiles` and `profile_events`.  
* Document 4: conversation routing and intent classification.  
* Document 9: matching algorithm uses these signals.

---

## Risks And Mitigation

1. Interview feels too long  
   * Mitigation: keep steps short, allow “Later,” reach MVP quickly.  
2. Signal extraction drift  
   * Mitigation: strict JSON schema validation, stable step prompts.  
3. Users answer in unexpected formats  
   * Mitigation: local parsing \+ clarifier \+ proceed.  
4. Users worry about privacy  
   * Mitigation: explain in onboarding that messages are used to match and data is protected.

---

## Testing Approach

### Unit Tests

* step progression logic  
* completeness checks  
* refusal/vague handling

### Integration Tests

* LLM extractor schema validation  
* profile patch application transaction

### E2E Scenarios

* New user completes interview in one sitting  
* User drops out mid-interview, returns next day  
* User answers vaguely, clarifier asked, then proceeds

---

## Production Readiness

### 1\) Infrastructure Setup

* Ensure `ANTHROPIC_API_KEY` configured.  
* Ensure LLM calls have timeouts and retry once on transient failures.  
* Ensure rate limiting per user to avoid runaway costs.

### 2\) Environment Parity

* Staging should run the exact same interview with:  
  * test numbers  
  * logging at higher verbosity

### 3\) Deployment Procedure

1. Deploy interview step catalog and extractor prompts.  
2. Validate that profile writes are correct in staging.  
3. Verify `complete_mvp` transitions.

### 4\) Wiring Verification

Smoke tests:

* Start interview and complete 5–8 steps.  
* Verify `profiles.fingerprint` and `profiles.activity_patterns` populated.  
* Verify `profile_events` rows created.  
* Verify conversation session advanced.

### 5\) Operational Readiness

* Metrics:  
  * interview completion rate  
  * step drop-off rates  
  * clarifier frequency  
* Logging:  
  * step ID, extraction success/failure, profile state

---

## Implementation Checklist

1. Implement interview step catalog with stable IDs.  
2. Implement interview router handler.  
3. Implement extractor prompts per step.  
4. Implement JSON schema validation for extractor output.  
5. Implement profile patch applier \+ transaction \+ events.  
6. Implement completeness checker (MVP vs full).  
7. Implement dropout recovery and reminders.  
8. Add metrics for progress and drop-offs.  
9. Write unit \+ integration tests.