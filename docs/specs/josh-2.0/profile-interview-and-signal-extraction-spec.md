# Profile Interview And Signal Extraction Spec

## Summary

This document defines the technical contracts for JOSH's profile interview: the signal targets, extraction interfaces, JSON schemas, confidence rules, completeness thresholds, and storage mapping that govern how user answers become a structured compatibility profile.

The conversation behavior — how JOSH conducts the interview, what it asks, how it reasons and infers across turns, how it navigates topics — is defined separately in the Conversation Behavior Spec (docs/conversation/conversation-behavior-spec.md). That document governs the conversation engine. This document governs the data contracts the conversation engine must satisfy.

Note on intro\_01: The intro\_01 step is deprecated. Its function (setting expectations and requesting consent to begin) is now handled by the onboarding sequence defined in the Conversation Behavior Spec. The interview begins at the first signal question (activity\_01 or equivalent). Any existing state token of interview:intro\_01 advances directly to interview:activity\_01.

---

## Scope

### In Scope

* Required extracted signals: Friend Fingerprint (12 factors), activity patterns, boundaries, preferences  
* Signal storage mapping to profiles.fingerprint, profiles.activity\_patterns, profiles.boundaries, profiles.preferences  
* Confidence threshold rules per signal type  
* Completeness thresholds for complete\_mvp and complete\_full profile states  
* LLM extraction interface (InterviewExtractInput, InterviewExtractOutput)  
* JSON schema constraints and output validation rules  
* When to ask follow-up questions (uncertainty thresholds only — the behavioral expression of these rules is in the Conversation Behavior Spec)  
* Extraction pipeline steps  
* Dropout recovery state tracking (behavioral recovery messaging is in the Conversation Behavior Spec)  
* Dependencies, testing approach, production readiness wiring

### Out Of Scope

* Conversation prompts, question wording, and JOSH voice  
* Question ordering and adaptive selection logic  
* Acknowledgment patterns and gear-shift behavior  
* Full long-form personality assessment  
* Clinical mental health assessment  
* Diagnoses or medical recommendations

### Deferred

* Adaptive interview length per region density  
* Multi-language support

---

## Key Decisions

1. Signals are stored as structured fields with confidence  
   * This supports explainable matching and safe learning from behavior over time.  
2. Follow-ups are gated by uncertainty thresholds  
   * A follow-up question is warranted only when motive weights are too flat (no motive \>= 0.55), a user answer contradicts earlier signals, or a mismatch risk is high. Max one follow-up per ambiguous answer. The conversation engine enforces these rules; this spec defines the thresholds.  
3. Confidence is updated incrementally  
   * Each new answer updates confidence for affected factors. Single answers should not swing any factor strongly. The extraction contract enforces this.  
4. Profile completeness is a defined threshold, not a step count  
   * complete\_mvp is reached when the completeness thresholds below are met, regardless of how many questions it took.

---

## Required Extracted Signals

### A) Friend Fingerprint (12 factors)

Stored in profiles.fingerprint.

Each factor must have:

* range\_value (float, 0..1)  
* confidence (float, 0..1)  
* freshness\_days (integer)  
* sources (weights from interview vs behavioral signals)

#### Canonical Factors

1. connection\_depth  
2. social\_energy  
3. social\_pace  
4. novelty\_seeking  
5. structure\_preference  
6. humor\_style  
7. conversation\_style  
8. emotional\_directness  
9. adventure\_comfort  
10. conflict\_tolerance  
11. values\_alignment\_importance  
12. group\_vs\_1on1\_preference

Factor keys are stable and used directly by the matching algorithm. Do not rename or add factors without a matching algorithm version bump.

### B) Activity Patterns

Stored in profiles.activity\_patterns (array).

Each activity pattern must include:

* activity\_key (from the activity catalog)  
* motive\_weights (float 0..1 per motive; weights are independent, not required to sum to 1\)  
* constraints (booleans, e.g. quiet, indoor, outdoor)  
* preferred\_windows (time buckets from the canonical window list)  
* confidence (float, 0..1)  
* freshness\_days (integer)

#### Canonical Motives

* connection  
* comfort  
* growth  
* play  
* restorative  
* adventure

### C) Boundaries And Safety-Relevant Preferences

Stored in profiles.boundaries.

* no\_thanks: list of activity category keys  
* hard\_constraints: booleans or enums (examples: smoking, substances, late\_night)  
* social\_safety: string list (examples: "meet in public", "daytime only")

### D) Preferences

Stored in profiles.preferences.

* group\_size\_pref: { min: integer, max: integer }  
* time\_preferences: array of canonical time bucket keys  
* noise\_sensitivity: float 0..1  
* outdoor\_preference: float 0..1  
* planning\_style: enum "spontaneous" | "balanced" | "planned"

---

## Signal Extraction Pipeline

Every inbound message during an active interview session must execute the following steps in order:

1. Persist inbound message to sms\_messages.  
2. Identify the current signal target from the session state token.  
3. Build the extraction prompt for that signal target (prompt content defined in the Conversation Behavior Spec).  
4. Call the LLM extractor with InterviewExtractInput.  
5. Validate the response against the InterviewExtractOutput JSON schema. If validation fails, fall back to the regex parser for this signal target and log interview.llm\_extraction\_failed \+ interview.regex\_fallback\_used.  
6. Apply profile updates in a transaction:  
   * Update profiles.fingerprint, profiles.activity\_patterns, profiles.boundaries, profiles.preferences JSON fields  
   * Write a profile\_events row for each patch applied  
   * Update profiles.state if completeness threshold is met  
   * Advance the session state token (the conversation engine determines the next signal target based on coverage state)  
7. Enqueue outbound message job for the next question or wrap message.

---

## Confidence Rules

* Structured choice reply (A/B/C/D): confidence boost (+0.15 to \+0.20 on affected factors)  
* Free-form reply with clear signal: medium confidence (0.50–0.65)  
* Free-form reply with inferred signal: lower confidence (0.40–0.55)  
* Vague or non-answer: low confidence (0.25–0.40), store with flag  
* No single answer should move any fingerprint factor by more than 0.25 in a single extraction pass

---

## Completeness Thresholds

### complete\_mvp

Profile state transitions to complete\_mvp when all of the following are true:

* At least 8 of 12 fingerprint factors have confidence \>= 0.55  
* At least 3 activity patterns exist with confidence \>= 0.60  
* group\_size\_pref is captured (any value)  
* time\_preferences is captured (at least one bucket)

### complete\_full

Profile state transitions to complete\_full when all of the following are true:

* All 12 fingerprint factors have confidence \>= 0.65  
* At least 5 activity patterns exist with confidence \>= 0.60  
* profiles.boundaries has been asked (can be empty, but the question must have been presented and a response recorded)

---

## Follow-Up Question Thresholds

A follow-up question (clarifier or motive probe) is warranted only when one or more of the following conditions are true:

* Motive weights after extraction are too flat: no single motive \>= 0.55  
* User's answer contradicts a signal captured in a previous turn (e.g., adventure implied earlier, but answer implies avoidance)  
* A mismatch risk is high (e.g., activity implies late\_night but boundaries includes late\_night constraint)

Maximum one follow-up per ambiguous answer. The conversation engine enforces the behavioral expression of these rules. This spec defines only the threshold conditions that trigger them.

---

## LLM Extraction Contract

### InterviewExtractInput

```ts
export type InterviewExtractInput = {
  userId: string;
  signalTarget: string;         // replaces stepId — the coverage factor being targeted
  questionText: string;         // the question JOSH asked
  userAnswerText: string;       // the user's reply
  conversationHistory: Array<{  // all prior turns in this interview session
    role: "josh" | "user";
    text: string;
  }>;
  currentProfile: {
    fingerprint: Record<string, {
      range_value: number;
      confidence: number;
      freshness_days: number;
    }>;
    activityPatterns: Array<Record<string, unknown>>;
    boundaries: Record<string, unknown>;
    preferences: Record<string, unknown>;
  };
};
```

Note: signalTarget replaces the legacy stepId field. It represents the coverage factor the current question was targeting, not a fixed step in a sequence. conversationHistory is included to enable cross-signal inference — the extractor can and should infer signals from earlier turns even when they were not the explicit target of this question.

### InterviewExtractOutput

```ts
export type InterviewExtractOutput = {
  signalTarget: string;
  extracted: {
    fingerprintPatches?: Array<{
      key: string;
      range_value: number;
      confidence: number;
    }>;
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
  inferred?: {
    fingerprintPatches?: Array<{
      key: string;
      range_value: number;
      confidence: number;
      inferredFrom: string; // description of what triggered the inference
    }>;
  };
  notes?: {
    needsFollowUp?: boolean;
    followUpReason?: "flat_motives" | "contradiction" | "mismatch_risk";
  };
};
```

### Output Constraints

* Valid JSON only. The output validator rejects and discards non-JSON responses.  
* All float values must be in range 0..1 inclusive.  
* No single fingerprintPatch may set range\_value with confidence \> 0.75 from a single answer (prevents overconfident single-turn updates).  
* If unsure about a signal, leave the field absent rather than guessing.  
* needsFollowUp may only be true when one of the three threshold conditions in "Follow-Up Question Thresholds" is met.  
* inferred patches should have confidence 0.10–0.20 lower than direct extraction patches to reflect the lower certainty of inference.

---

## Dropout Recovery State Tracking

Dropout detection is the responsibility of the scheduled runner. The following fields on conversation\_sessions govern dropout behavior:

* updated\_at: timestamp of last inbound message in this session  
* dropout\_nudge\_sent\_at: timestamp of the dropout nudge, if sent

Dropout nudge rules (timing):

* Send one nudge when updated\_at \> 24 hours ago and mode \= interviewing and dropout\_nudge\_sent\_at IS NULL  
* Do not send a second nudge  
* Nudge respects STOP opt-out state

The nudge message content and resume behavior are defined in the Conversation Behavior Spec.

---

## Examples

### Example: Activity And Motive Extraction With Inference

User answer: "Coffee with new friends sounds like a calm reset and a chance for real conversation."

Expected InterviewExtractOutput (abbreviated):

```json
{
  "signalTarget": "activity_patterns",
  "extracted": {
    "activityPatternsAdd": [
      {
        "activity_key": "coffee",
        "motive_weights": {
          "restorative": 0.70,
          "connection": 0.75,
          "comfort": 0.55
        },
        "constraints": { "quiet": true, "indoor": true },
        "preferred_windows": ["morning", "day"],
        "confidence": 0.72
      }
    ],
    "fingerprintPatches": [
      { "key": "connection_depth", "range_value": 0.70, "confidence": 0.62 },
      { "key": "social_pace", "range_value": 0.45, "confidence": 0.55 }
    ]
  }
}
```

### Example: Refusal

User answer: "Prefer not to answer."

Expected behavior: no profile changes applied, signal target marked as asked-but-skipped in profile\_events, conversation engine advances to next uncovered signal.

### Example: Cross-Signal Inference

Prior turn: user mentioned skydiving and white water rafting. Current question target: novelty\_seeking.

Expected behavior: extractor should include inferred patches for adventure\_comfort and novelty\_seeking in the inferred block, not ask a direct adventure question, and the signal coverage tracker should mark these factors as covered from inference.

---

## Dependencies

* Document 2: profile state machine and update safety rules  
* Document 3: schema mapping to profiles and profile\_events  
* Document 4: conversation routing and intent classification  
* Document 9: matching algorithm consumes these signals  
* Conversation Behavior Spec: governs how the conversation engine uses these contracts to conduct the interview

---

## Testing Approach

### Unit Tests

* Completeness checker: returns complete\_mvp only when all four thresholds met  
* Confidence rules: structured reply produces expected confidence boost  
* Output validator: rejects non-JSON, rejects out-of-range floats, rejects confidence \> 0.75 on any single patch  
* Dropout detection: nudge fires once at 24 hours, not twice

### Integration Tests

* LLM extractor returns valid InterviewExtractOutput schema  
* Profile patch application transaction: all patches applied or none (rollback on partial failure)  
* complete\_mvp transition fires when thresholds met, not before

### Golden Tests

* Coffee calm reset answer → expected motive weights within ±0.10  
* Skydiving and rafting mentioned → adventure\_comfort and novelty\_seeking inferred in inferred block with reduced confidence  
* Refusal → no profile change, step marked asked-but-skipped

---

## Production Readiness

### Infrastructure

* ANTHROPIC\_API\_KEY configured in all environments  
* LLM calls have a 5-second timeout with one retry on transient failure  
* Fallback to regex parser if LLM fails after retry  
* Rate limiting: maximum 1 LLM extraction call per inbound message per user

### Environment Parity

* Staging runs the same extraction with test numbers and higher log verbosity  
* Golden test suite runs against staging before each production deploy

### Wiring Verification

Smoke tests before production launch:

* Complete 5–8 interview exchanges  
* Verify profiles.fingerprint and profiles.activity\_patterns populated with correct structure and confidence values  
* Verify profile\_events rows created for each patch applied  
* Verify profiles.state transitions to complete\_mvp when thresholds met  
* Verify conversation session state token advances correctly per turn  
* Verify LLM fallback fires correctly when Anthropic API key is disabled

### Operational Metrics

* interview.llm\_extraction\_success and interview.llm\_extraction\_failed counters  
* interview.regex\_fallback\_used counter (ratio vs LLM success)  
* interview.complete\_mvp\_reached counter  
* interview.session\_duration\_seconds histogram  
* interview.exchanges\_to\_mvp histogram  
* llm.extraction\_latency\_ms histogram

