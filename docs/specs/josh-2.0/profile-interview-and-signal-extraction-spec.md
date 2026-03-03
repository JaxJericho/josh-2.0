# Profile Interview And Signal Extraction Spec

This document defines the 3.0 profile interview extraction contracts: the six coordination dimensions, three coordination signals, holistic extraction interfaces, trigger points, completeness thresholds, and confidence update rules.

The conversation behavior and prompt wording live in `docs/conversation/conversation-behavior-spec.md`. This spec defines the profile data contracts those conversations must satisfy.

---

## 1) 6-Dimension Coordination Profile (Layer A)

Layer A is the coordination profile used in 3.0 matching and coordination paths.

### Canonical dimension keys

- `social_energy`
- `social_pace`
- `conversation_depth`
- `adventure_orientation`
- `group_dynamic`
- `values_proximity`

### Canonical dimension profile entry shape

Each coordination dimension is represented as:

```ts
{
  range_value: number;    // float 0..1
  confidence: number;     // float 0..1
  freshness_days: number; // integer
}
```

### Dimension definitions

- `social_energy`: captures preference for high-stimulation vs. low-stimulation social environments.
  Data type: `range_value` float 0..1, `confidence` float 0..1, `freshness_days` integer.
- `social_pace`: captures preference for spontaneous vs. structured plans.
  Data type: `range_value` float 0..1, `confidence` float 0..1, `freshness_days` integer.
- `conversation_depth`: captures preference for surface-level vs. substantive conversation.
  Data type: `range_value` float 0..1, `confidence` float 0..1, `freshness_days` integer.
- `adventure_orientation`: captures preference for familiar vs. novel experiences.
  Data type: `range_value` float 0..1, `confidence` float 0..1, `freshness_days` integer.
- `group_dynamic`: captures preference for leading vs. following vs. collaborating.
  Data type: `range_value` float 0..1, `confidence` float 0..1, `freshness_days` integer.
- `values_proximity`: captures importance of shared values and worldview in connections.
  Data type: `range_value` float 0..1, `confidence` float 0..1, `freshness_days` integer.

---

## 2) Coordination Signals (3)

### Canonical signal keys

- `scheduling_availability`: time buckets when the user is typically available.
- `notice_preference`: how far in advance plans need to be confirmed.
- `coordination_style`: how the user prefers to handle logistics.

### Runtime type contract (from `packages/db/src/types/coordination-signals.ts`)

```ts
export type CoordinationSignals = {
  scheduling_availability: JsonValue | null;
  notice_preference: string | null;
  coordination_style: string | null;
};
```

---

## 3) HolisticExtractInput / HolisticExtractOutput Interfaces

Authoritative source files:

- `packages/db/src/types/holistic-extraction.ts`
- `packages/db/src/types/coordination-dimensions.ts`
- `packages/db/src/types/coordination-signals.ts`
- `packages/db/src/types/dimension-coverage-summary.ts`

### Supporting types

```ts
export type ConversationTurn = {
  role: "user" | "assistant";
  text: string;
};

export type CoordinationDimensionKey =
  | "social_energy"
  | "social_pace"
  | "conversation_depth"
  | "adventure_orientation"
  | "group_dynamic"
  | "values_proximity";

export type CoordinationDimensionValue = {
  value: number;
  confidence: number;
};

export type CoordinationDimensions = Record<
  CoordinationDimensionKey,
  CoordinationDimensionValue
>;

export type CoverageSummaryEntry = {
  covered: boolean;
  confidence: number;
};

export type DimensionCoverageSummary = {
  dimensions: Record<CoordinationDimensionKey, CoverageSummaryEntry>;
  signals: { [K in keyof CoordinationSignals]: CoverageSummaryEntry };
};
```

### HolisticExtractInput

```ts
export type HolisticExtractInput = {
  conversationHistory: ConversationTurn[];
  currentProfile: Partial<CoordinationDimensions>;
  sessionId: string;
};
```

### HolisticExtractOutput

```ts
export type HolisticExtractOutput = {
  coordinationDimensionUpdates: Partial<CoordinationDimensions>;
  coordinationSignalUpdates: Partial<CoordinationSignals>;
  coverageSummary: DimensionCoverageSummary;
  needsFollowUp: boolean;
};
```

### Output schema constraints

From `packages/llm/src/schemas/holistic-extract-output.schema.ts`:

- Top-level keys are limited to `coordinationDimensionUpdates`, `coordinationSignalUpdates`, `coverageSummary`, and `needsFollowUp`.
- `coordinationDimensionUpdates` accepts only the 6 canonical dimension keys; each update must include `value` and `confidence` in [0,1].
- `coordinationSignalUpdates` accepts only `scheduling_availability`, `notice_preference`, and `coordination_style`.
- `coverageSummary` must include all 6 dimensions and all 3 signals with `{ covered: boolean, confidence: number }` entries.
- `needsFollowUp` is required and must be boolean.

---

## 4) Holistic Extraction Trigger Points

The holistic extraction call fires at these trigger points:

- After every user reply during the interview.
- At abbreviated interview wrap for invited users.
- When the signal coverage tracker detects a gap requiring targeted follow-up.

---

## 5) Completeness Thresholds

### complete_mvp

`complete_mvp` requires all of the following:

- All 6 coordination dimensions at confidence >= 0.55.
- All 3 coordination signals captured at confidence >= 0.60.
- At least 3 activity patterns at confidence >= 0.60.
- `group_size_pref` captured.
- `time_preferences` captured (at least one bucket).

### complete_invited

`complete_invited` requires all of the following:

- At least 3 coordination dimensions at confidence >= 0.45.
- `scheduling_availability` captured.
- At least 1 activity pattern at confidence >= 0.50.

---

## 6) Confidence Update Rules

These constraints apply to holistic extraction outputs:

- No coordination dimension `range_value` may move by more than 0.25 in a single extraction pass.
- Confidence may not exceed 0.75 in a single extraction pass.
- Inferred signals must be 0.10-0.15 lower confidence than directly extracted signals.
- If evidence is weak, fields must be absent rather than guessed.

---

## Verification Anchors

This file must continue to reflect the current extraction contracts in:

- `packages/db/src/types/holistic-extraction.ts`
- `packages/db/src/types/coordination-dimensions.ts`
- `packages/db/src/types/coordination-signals.ts`
- `packages/db/src/types/dimension-coverage-summary.ts`
- `packages/llm/src/schemas/holistic-extract-output.schema.ts`
