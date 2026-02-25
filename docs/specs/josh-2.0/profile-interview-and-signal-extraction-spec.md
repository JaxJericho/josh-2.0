# Profile Interview And Signal Extraction Spec

This document defines the technical contracts for JOSH's profile interview: the signal targets, extraction interfaces, JSON schemas, confidence rules, completeness thresholds, and storage mapping that govern how user answers become a structured profile.

The conversation behavior — how JOSH conducts the interview, what it asks, how it reasons and infers across turns, how it navigates topics — is defined separately in the Conversation Behavior Spec. That document governs the conversation engine. This document governs the data contracts the conversation engine must satisfy.

The profile is organized in two layers. The coordination layer is collected during the MVP interview and serves all three 3.0 coordination paths immediately. The compatibility layer is reserved in the schema but not populated at MVP — it becomes active when deeper friendship-matching tiers are introduced. This separation allows the matching algorithm and interview to evolve independently of each other.

Note on intro\_01: The intro\_01 step is deprecated. Its function (setting expectations and requesting consent to begin) is now handled by the onboarding sequence defined in the Conversation Behavior Spec. The interview begins at the first signal question. Any existing state token of interview:intro\_01 advances directly to the first uncovered coordination dimension question.

---

## Scope

### In Scope

* Required extracted signals: six coordination dimensions, three coordination signals, activity patterns, boundaries, preferences  
* Layer separation: coordination layer (MVP) and compatibility layer (schema-present, empty at MVP)  
* Signal storage mapping to profiles.coordination\_dimensions, profiles.coordination\_signals, profiles.activity\_patterns, profiles.boundaries, profiles.preferences  
* Confidence threshold rules per signal type  
* Completeness thresholds for complete\_mvp, complete\_full, and complete\_invited profile states  
* LLM extraction interface (HolisticExtractInput, HolisticExtractOutput)  
* Holistic extraction architecture: extraction runs at pause points across the full conversation history, not per message  
* JSON schema constraints and output validation rules  
* When to trigger follow-up questions (uncertainty thresholds — behavioral expression defined in Conversation Behavior Spec)  
* Extraction pipeline steps and trigger rules  
* Dropout recovery state tracking  
* Dependencies, testing approach, production readiness wiring

### Out Of Scope

* Conversation prompts, question wording, and JOSH voice  
* Question ordering and adaptive selection logic  
* Acknowledgment patterns and gear-shift behavior  
* Full long-form personality assessment  
* Clinical mental health assessment  
* Diagnoses or medical recommendations  
* Compatibility layer population (deferred to future tiers)

### Deferred

* Adaptive interview length per region density  
* Multi-language support  
* Compatibility layer interview questions and extraction  
* Big Five personality substrate collection  
* Attachment orientation signals

---

## Key Decisions

1. Two-layer profile architecture

   * The coordination layer serves the MVP use case (activity suggestion, named contact coordination, LinkUp formation) and is collected during the MVP interview.  
   * The compatibility layer is reserved in the schema as nullable JSONB fields. It is never populated at MVP. When deeper friendship tiers are introduced, these fields activate without requiring schema changes.  
   * This prevents the interview from becoming a bloated multi-purpose instrument before the product needs it to be.  
2. Holistic extraction replaces per-step extraction

   * The previous model extracted signals from individual question-answer pairs. This produced fragile confidence values and failed to capture the inferential richness of multi-turn conversation.  
   * The new model runs a single holistic extraction pass against the full conversation history at natural pause points. The extractor reads everything said and updates all factors it has evidence for simultaneously.  
   * Confidence is earned through convergence across turns, not from individual answers.  
3. Six consolidated coordination dimensions replace twelve fingerprint factors

   * The previous twelve factors contained meaningful overlap (adventure\_comfort and novelty\_seeking were correlated; connection\_depth and conversation\_style were partially redundant). Consolidation into six orthogonal dimensions reduces extraction noise and improves matching signal quality.  
   * Factor keys are stable and used directly by the matching algorithm. Do not rename or add dimensions without a matching algorithm version bump.  
4. Three coordination signals are new additions

   * scheduling\_availability, notice\_preference, and coordination\_style capture how a person makes plans, not just what they enjoy. These signals serve the named contact coordination path and the suggestion engine, neither of which existed in 2.0.  
5. Profile completeness is a threshold condition, not a step count

   * complete\_mvp is reached when coverage thresholds are met, regardless of how many questions it took. A user who gives rich, signal-dense answers may complete in fewer exchanges than a user who gives sparse answers.  
6. complete\_invited is a new profile state for invited users

   * Users who join JOSH via a contact invitation complete a shorter interview before confirming a plan. Their profile state is complete\_invited. These profiles satisfy the invited coordination path but must not enter the LinkUp stranger-matching pool until complete\_mvp is reached.

---

## Profile Layer Architecture

### Layer A — Coordination Profile (MVP)

Populated during the MVP interview. Serves activity suggestion, named contact coordination, and LinkUp formation.

Fields:

* `profiles.coordination_dimensions` (JSONB) — six factors with confidence and freshness  
* `profiles.coordination_signals` (JSONB) — three coordination behavioral signals  
* `profiles.activity_patterns` (JSONB array) — activities with motive weights  
* `profiles.boundaries` (JSONB) — hard constraints and safety preferences  
* `profiles.preferences` (JSONB) — group size, time windows, noise/outdoor preferences

### Layer B — Compatibility Profile (Reserved, Empty at MVP)

Schema present, never populated at MVP. Populated by future deeper-matching tier interview flows.

Fields:

* `profiles.personality_substrate` (JSONB, nullable) — reserved for personality dimensions  
* `profiles.relational_style` (JSONB, nullable) — reserved for attachment and reliability signals  
* `profiles.values_orientation` (JSONB, nullable) — reserved for worldview and values signals

Layer B fields must always be nullable. Never read them in MVP matching logic. Never ask interview questions that target them at MVP.

---

## Required Extracted Signals

### A) Coordination Dimensions (6 factors)

Stored in profiles.coordination\_dimensions.

Each dimension must have:

* `range_value` (float, 0..1) — position on the dimension's spectrum  
* `confidence` (float, 0..1) — extraction confidence  
* `freshness_days` (integer) — days since last meaningful update  
* `sources` (object) — relative weights from interview vs. behavioral signals

#### Canonical Dimensions

| Key | Spectrum (0 → 1\) |
| ----- | ----- |
| `social_energy` | Strongly introverted → Strongly extroverted |
| `social_pace` | Needs significant advance notice → Fully spontaneous |
| `conversation_depth` | Light and social → Substantive and deep |
| `adventure_orientation` | Comfort zone / familiar → Novelty-seeking / challenging |
| `group_dynamic` | Intimate (1–2 people) → Larger social group |
| `values_proximity` | Shared worldview irrelevant → Shared worldview essential |

Dimension keys are stable and used directly by the matching algorithm. Do not rename or add dimensions without a matching algorithm version bump.

#### Mapping from deprecated 12-factor model

For any codebase that still references old factor keys, apply the following mapping:

| Deprecated Key | Maps To |
| ----- | ----- |
| social\_energy | social\_energy |
| social\_pace | social\_pace |
| structure\_preference | social\_pace (merged — both capture planning vs. spontaneity) |
| connection\_depth | conversation\_depth |
| conversation\_style | conversation\_depth (merged — both capture depth of exchange) |
| adventure\_comfort | adventure\_orientation |
| novelty\_seeking | adventure\_orientation (merged — highly correlated) |
| group\_vs\_1on1\_preference | group\_dynamic |
| values\_alignment\_importance | values\_proximity |
| humor\_style | Deprecated — no replacement in coordination layer. Absorbed into activity\_patterns motive weights where relevant. |
| emotional\_directness | Deprecated — no replacement in coordination layer. Reserved for compatibility layer. |
| conflict\_tolerance | Deprecated — no replacement in coordination layer. Reserved for compatibility layer. |

### B) Coordination Signals (3 signals)

Stored in profiles.coordination\_signals.

Each signal must have:

* `value` (string | null) — the captured enum value  
* `confidence` (float, 0..1) — extraction confidence  
* `freshness_days` (integer)

#### Canonical Coordination Signals

scheduling\_availability

* Enum: `weekends_only` | `weekday_evenings` | `mornings` | `flexible`  
* What it captures: when the user is generally available for social plans

notice\_preference

* Enum: `same_day` | `few_days` | `week_plus`  
* What it captures: how far in advance a plan needs to be confirmed for the user to feel comfortable

coordination\_style

* Enum: `initiator` | `collaborative` | `deferrer`  
* What it captures: whether the user prefers to decide (pick the place, time, activity), co-decide, or follow someone else's lead

### C) Activity Patterns

Stored in profiles.activity\_patterns (array). Unchanged from previous model — this signal structure is strong and serves all coordination paths.

Each activity pattern must include:

* `activity_key` (from the activity catalog)  
* `motive_weights` (float 0..1 per motive; weights are independent, not required to sum to 1\)  
* `constraints` (booleans, e.g. quiet, indoor, outdoor)  
* `preferred_windows` (time buckets from the canonical window list)  
* `confidence` (float, 0..1)  
* `freshness_days` (integer)

#### Canonical Motives

* connection  
* comfort  
* growth  
* play  
* restorative  
* adventure

### D) Boundaries And Safety-Relevant Preferences

Stored in profiles.boundaries. Unchanged from previous model.

* `no_thanks`: list of activity category keys  
* `hard_constraints`: booleans or enums (examples: smoking, substances, late\_night)  
* `social_safety`: string list (examples: "meet in public", "daytime only")

### E) Preferences

Stored in profiles.preferences.

* `group_size_pref`: { min: integer, max: integer }  
* `time_preferences`: array of canonical time bucket keys  
* `noise_sensitivity`: float 0..1  
* `outdoor_preference`: float 0..1

Note: `planning_style` from the previous model is deprecated. It is superseded by `coordination_signals.social_pace` and `coordination_signals.notice_preference`, which capture the same concept with more precision.

---

## Signal Extraction Architecture

### Holistic Extraction Model

The previous model extracted signals from individual question-answer pairs (one LLM call per message). The new model uses holistic extraction: a single pass that reads the full conversation history and updates all factors it has evidence for simultaneously.

This change was made because:

* Single-answer extraction produces low-confidence, noisy signals  
* Inferential richness across multiple turns is lost when extraction is scoped to one exchange  
* Confidence should reflect convergence across turns, not the strength of a single answer

### Extraction Trigger Rules

Extraction runs at the following points:

1. After every 2–3 user messages during an active interview session (natural pause point)  
2. Before the conversation engine selects the next question (to determine what's still uncovered)  
3. When checking whether completeness thresholds have been met  
4. At interview wrap (final extraction pass)

Extraction must NOT run on every single message — this is a rate limit, not just a suggestion. Maximum one extraction call per two inbound messages per user during the interview. The conversation engine queues extraction runs and executes them at the trigger points above.

### Extraction Pipeline Steps

Every extraction trigger executes the following steps in order:

1. Build HolisticExtractInput from current conversation history and profile state.  
2. Call the LLM holistic extractor.  
3. Validate response against HolisticExtractOutput JSON schema. If validation fails, discard the response, log interview.llm\_extraction\_failed, and do not update the profile. The conversation engine continues using the last valid profile state.  
4. Apply profile updates in a transaction:  
   * Update profiles.coordination\_dimensions JSON field  
   * Update profiles.coordination\_signals JSON field  
   * Update profiles.activity\_patterns, profiles.boundaries, profiles.preferences  
   * Write a profile\_events row for each patch applied  
   * Update profiles.state if completeness threshold is newly met  
5. Update the signal coverage tracker from the updated profile state.  
6. If question selection was the trigger: select the next question based on updated coverage.

There is no regex fallback for holistic extraction. If LLM extraction fails, the conversation engine selects the next question based on the last valid profile state and continues. The failed extraction is logged and the extraction will be reattempted at the next trigger point.

---

## Confidence Rules

* Structured choice reply (A/B/C): confidence boost (+0.15 to \+0.20 on affected dimensions)  
* Free-form reply with clear, unambiguous signal: medium-high confidence (0.55–0.70)  
* Free-form reply with inferred signal across multiple turns: medium confidence (0.45–0.60)  
* Free-form reply with inferred signal from a single mention: lower confidence (0.35–0.50)  
* Vague or non-committal answer: low confidence (0.25–0.40), store with flag  
* Inferred signals from prior turns must have confidence 0.10–0.15 lower than directly extracted signals from the current extraction pass  
* No single extraction pass should move any coordination dimension by more than 0.25 from its current range\_value  
* Confidence accumulates across extraction passes — a factor at 0.45 can reach 0.65 after two corroborating passes

---

## Completeness Thresholds

### complete\_mvp

Profile state transitions to complete\_mvp when all of the following are true:

* All 6 coordination dimensions have confidence \>= 0.55  
* All 3 coordination signals have confidence \>= 0.60 (value is not null)  
* At least 3 activity patterns exist with confidence \>= 0.60  
* group\_size\_pref is captured (any value)  
* time\_preferences is captured (at least one bucket)

### complete\_full

Profile state transitions to complete\_full when all of the following are true:

* All 6 coordination dimensions have confidence \>= 0.70  
* All 3 coordination signals have confidence \>= 0.70  
* At least 5 activity patterns exist with confidence \>= 0.60  
* profiles.boundaries has been asked (can be empty, but the question must have been presented and a response recorded)

### complete\_invited

Profile state for users who joined via a contact invitation and completed the abbreviated interview. This state satisfies the named contact coordination path only.

complete\_invited is reached when:

* At least 3 coordination dimensions have confidence \>= 0.45  
* scheduling\_availability signal is captured (any value)  
* At least 1 activity pattern exists with confidence \>= 0.50

Critical constraint: complete\_invited profiles must never enter the LinkUp stranger-matching pool. The matching engine enforces this as a hard filter: candidates with profile\_state \= complete\_invited are excluded from all LinkUp candidate queries. This filter must not be relaxed until the profile reaches complete\_mvp.

---

## Follow-Up Question Thresholds

A follow-up question (clarifier or motive probe) is warranted only when one or more of the following conditions are true:

* Motive weights after extraction are too flat: no single motive \>= 0.55 for any activity pattern at confidence \>= 0.50  
* User's answer contradicts a signal captured in a prior extraction pass (e.g., adventure\_orientation implied high in pass 1, but current answer implies avoidance)  
* A mismatch risk is high (e.g., activity implies late\_night but boundaries includes late\_night constraint)  
* A coordination signal is critical to the current coordination path and still null after 4+ exchanges

Maximum one follow-up per ambiguous answer. The conversation engine enforces the behavioral expression of these rules. This spec defines only the threshold conditions that trigger them.

---

## LLM Extraction Contract

### HolisticExtractInput

```ts
export type HolisticExtractInput = {
  userId: string;
  conversationHistory: Array<{
    role: "josh" | "user";
    text: string;
    turnIndex: number;
  }>;
  currentProfile: {
    coordinationDimensions: Record<string, {
      range_value: number;
      confidence: number;
      freshness_days: number;
    }>;
    coordinationSignals: Record<string, {
      value: string | null;
      confidence: number;
    }>;
    activityPatterns: Array<Record<string, unknown>>;
    boundaries: Record<string, unknown>;
    preferences: Record<string, unknown>;
  };
  conversationFocus?: string; // Optional hint about the most recently discussed topic area.
                               // This is not a constraint — the extractor should update
                               // any dimension it has evidence for, not only the focus area.
};
```

### HolisticExtractOutput

```ts
export type HolisticExtractOutput = {
  coordinationPatches?: Array<{
    key: string;           // Must be one of the 6 canonical dimension keys
    range_value: number;   // 0..1
    confidence: number;    // 0..1
    inferredFrom?: string; // Description of what in the conversation history supports this
  }>;
  coordinationSignalPatches?: Array<{
    key: string;           // Must be one of the 3 canonical signal keys
    value: string;         // Must be a valid enum value for this signal
    confidence: number;    // 0..1
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
  notes?: {
    needsFollowUp?: boolean;
    followUpReason?: "flat_motives" | "contradiction" | "mismatch_risk" | "insufficient_scheduling";
    coverageSummary?: Record<string, number>; // Current confidence per dimension — used for debugging
  };
};
```

### Output Constraints

* Valid JSON only. The output validator rejects and discards non-JSON responses.  
* All float values must be in range 0..1 inclusive.  
* coordinationPatches key values must match canonical dimension keys exactly. Unknown keys are rejected.  
* coordinationSignalPatches key values must match canonical signal keys exactly. Unknown enum values are rejected.  
* No single coordinationPatch may set a range\_value that represents a change of more than 0.25 from the current profile value in a single extraction pass.  
* No single coordinationPatch may set confidence above 0.75 in a single extraction pass. Confidence \> 0.75 requires corroboration across at least two extraction passes.  
* Inferred patches (where inferredFrom is populated) should have confidence 0.10–0.15 lower than directly extracted patches.  
* If evidence for a dimension is absent or ambiguous, omit the patch entirely rather than guessing.  
* needsFollowUp may only be true when one of the four threshold conditions in "Follow-Up Question Thresholds" is met.  
* coverageSummary is optional but encouraged — it helps the conversation engine make better question selections.

---

## Dropout Recovery State Tracking

Dropout detection is the responsibility of the scheduled runner. The following fields on conversation\_sessions govern dropout behavior:

* `updated_at`: timestamp of last inbound message in this session  
* `dropout_nudge_sent_at`: timestamp of the dropout nudge, if sent

Dropout nudge rules:

* Send one nudge when updated\_at \> 24 hours ago AND mode \= interviewing AND dropout\_nudge\_sent\_at IS NULL  
* Do not send a second nudge  
* Nudge respects STOP opt-out state

The nudge message content and resume behavior are defined in the Conversation Behavior Spec.

---

## Examples

### Example: Multi-Turn Holistic Extraction

Conversation history (3 turns):

* Turn 1 — JOSH: "What's something you'd genuinely enjoy doing with new people?"  
* Turn 1 — User: "Probably hiking. I like being outdoors and I find it easier to talk when you're moving."  
* Turn 2 — JOSH: "What kind of group feels right for that — a couple of people, or more?"  
* Turn 2 — User: "Definitely smaller. Two or three max. I find big groups exhausting."  
* Turn 3 — JOSH: "If someone texted you tonight about plans tomorrow, what's your gut reaction?"  
* Turn 3 — User: "Honestly, I'd probably need to think about it. I'm better with a few days notice."

Expected HolisticExtractOutput (abbreviated):

```json
{
  "coordinationPatches": [
    { "key": "social_energy", "range_value": 0.30, "confidence": 0.52, "inferredFrom": "mentions big groups as exhausting; prefers smaller settings" },
    { "key": "group_dynamic", "range_value": 0.20, "confidence": 0.65, "inferredFrom": "explicitly stated 2-3 max, finds big groups exhausting" },
    { "key": "social_pace", "range_value": 0.25, "confidence": 0.60, "inferredFrom": "direct statement: needs a few days notice, gut reaction to same-day is hesitation" },
    { "key": "adventure_orientation", "range_value": 0.55, "confidence": 0.48, "inferredFrom": "outdoor hiking preference suggests moderate novelty comfort; insufficient data for high confidence" }
  ],
  "coordinationSignalPatches": [
    { "key": "notice_preference", "value": "few_days", "confidence": 0.65 }
  ],
  "activityPatternsAdd": [
    {
      "activity_key": "hiking",
      "motive_weights": { "restorative": 0.60, "connection": 0.55, "adventure": 0.40 },
      "constraints": { "outdoor": true },
      "preferred_windows": [],
      "confidence": 0.68
    }
  ],
  "notes": {
    "coverageSummary": {
      "social_energy": 0.52,
      "social_pace": 0.60,
      "conversation_depth": 0.0,
      "adventure_orientation": 0.48,
      "group_dynamic": 0.65,
      "values_proximity": 0.0
    }
  }
}
```

### Example: Scenario Answer Producing Cross-Dimension Inference

User answer: "A friend asks me at 6pm to meet for drinks at 9pm. My gut reaction is anxiety — I just can't context-switch that fast. I've learned I need to mentally prepare for social stuff."

Expected: social\_pace updated toward planned end (low range\_value, higher confidence). social\_energy inferred toward introverted. No activity pattern added (drinks not stated as preferred). notice\_preference updated to few\_days or week\_plus.

### Example: Refusal

User answer: "Prefer not to answer."

Expected behavior: no profile changes applied, signal target marked as asked-but-skipped in profile\_events, conversation engine advances to next uncovered signal per coverage tracker.

### Example: complete\_invited Profile Threshold Check

After abbreviated interview (3–4 turns):

* social\_energy: confidence 0.48 ✓  
* social\_pace: confidence 0.50 ✓  
* conversation\_depth: confidence 0.45 ✓ (minimum 3 dimensions at \>= 0.45 met)  
* scheduling\_availability: value \= "weekends\_only", confidence 0.62 ✓  
* activity\_patterns: 1 pattern at confidence 0.55 ✓

Result: profile\_state transitions to complete\_invited. User is directed to plan confirmation. Profile must NOT appear in LinkUp candidate pool.

---

## Dependencies

* Document 2 (Domain Model): profile state machine and update safety rules — must include complete\_invited state  
* Document 3 (Database Schema): schema mapping — must include coordination\_dimensions, coordination\_signals, and Layer B nullable fields  
* Document 4 (Conversation Routing): intent classification  
* Document 9 (Matching Algorithm): consumes coordination\_dimensions and coordination\_signals; must enforce complete\_invited hard filter  
* Conversation Behavior Spec: governs how the conversation engine conducts the interview and triggers extraction

---

## Testing Approach

### Unit Tests

* Completeness checker: returns complete\_mvp only when all thresholds met  
* Completeness checker: returns complete\_invited when abbreviated thresholds met  
* complete\_invited hard filter: profiles with complete\_invited state are excluded from LinkUp candidate queries  
* Confidence rules: structured reply produces expected confidence boost  
* Confidence cap: no single extraction pass sets confidence above 0.75  
* Confidence delta cap: no single extraction pass moves a dimension by more than 0.25  
* Output validator: rejects non-JSON, rejects out-of-range floats, rejects unknown dimension keys, rejects unknown signal enum values  
* Dropout detection: nudge fires once at 24 hours, not twice  
* Extraction trigger rate limiter: extraction runs at most once per two inbound messages

### Integration Tests

* LLM holistic extractor returns valid HolisticExtractOutput schema  
* Profile patch application transaction: all patches applied or none (rollback on partial failure)  
* complete\_mvp transition fires when thresholds met, not before  
* complete\_invited transition fires correctly and does not match complete\_mvp conditions  
* Extraction pass at turn 3 with 3-turn history produces multi-dimension patches

### Golden Tests

* Hiking \+ small group \+ needs notice (3 turns) → social\_energy \<= 0.40, group\_dynamic \<= 0.30, notice\_preference \= few\_days or week\_plus  
* "Coffee as a calm reset and real conversation" → restorative \>= 0.60, connection \>= 0.65, quiet constraint  
* Skydiving and white water rafting mentioned → adventure\_orientation \>= 0.70 inferred from history  
* Scenario question about same-day plans → notice\_preference and social\_pace updated with moderate confidence  
* Refusal → no profile change, asked-but-skipped recorded  
* Abbreviated interview (3–4 rich turns) reaches complete\_invited thresholds

---

## Production Readiness

### Infrastructure

* ANTHROPIC\_API\_KEY configured in all environments  
* LLM calls have a 5-second timeout with one retry on transient failure  
* No regex fallback — if LLM fails after retry, conversation continues from last valid profile state. Failure is logged and extraction reattempted at next trigger.  
* Rate limiting: maximum one extraction call per two inbound messages per user

### Environment Parity

* Staging runs the same extraction with test numbers and higher log verbosity  
* Golden test suite runs against staging before each production deploy

### Wiring Verification

Smoke tests before production launch:

* Complete a 6–10 exchange interview with a human tester  
* Verify profiles.coordination\_dimensions populated with all 6 keys at confidence \>= 0.45 after 4 exchanges  
* Verify profiles.coordination\_signals populated with at least 2 of 3 signals after 6 exchanges  
* Verify profiles.activity\_patterns has at least 2 patterns after 4 exchanges  
* Verify profile\_events rows created for each extraction pass  
* Verify profiles.state transitions to complete\_mvp when thresholds met  
* Verify complete\_invited profile does not appear in match\_candidates query results  
* Verify LLM timeout results in conversation continuing (not crashing), failure logged

### Operational Metrics

* interview.llm\_extraction\_success (count)  
* interview.llm\_extraction\_failed (count)  
* interview.complete\_mvp\_reached (count)  
* interview.complete\_invited\_reached (count)  
* interview.session\_duration\_seconds (histogram)  
* interview.exchanges\_to\_mvp (histogram)  
* interview.exchanges\_to\_invited (histogram)  
* llm.holistic\_extraction\_latency\_ms (histogram)  
* interview.complete\_invited\_upgraded\_to\_mvp (count) — tracks invited users who completed full interview