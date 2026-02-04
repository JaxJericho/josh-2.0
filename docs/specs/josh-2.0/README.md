# JOSH 2.0 — Canonical Specifications Index

This directory contains the **authoritative behavioral specifications** for JOSH 2.0.

These files define what the system does.
They are the single source of truth for system behavior.

If code, prompts, UI, jobs, or documentation disagree with these specs,
**the specs win**.

---

## How To Read These Specs

Not all specs are equal in authority.
They must be read in the order below.

This order resolves ambiguity and prevents accidental behavior changes.

---

## Spec Authority Order

### 1. Domain Model And State Machines

Defines:

- Core entities
- Allowed states
- Legal transitions
- Invariants

Everything else depends on this layer.

---

### 2. Safety And Abuse Prevention

Defines:

- STOP / HELP handling
- Keyword detection
- Blocks, reports, and holds
- Safety overrides

Safety rules override all other behavior.

---

### 3. Eligibility And Entitlements

Defines:

- Who can do what
- When actions are allowed
- Subscription and credit enforcement

If eligibility is unclear, the action is denied.

---

### 4. Conversation Routing And Intent Detection

Defines:

- How inbound messages are classified
- Which system owns a message at any moment
- Routing between interview, matching, safety, and support

Conversation routing must respect state and safety boundaries.

---

### 5. Profile Interview And Signal Extraction

Defines:

- Interview flow
- Question sequencing
- Signal capture and validation
- When a profile is considered complete

Extraction logic must be deterministic and auditable.

---

### 6. Compatibility Scoring And Matching

Defines:

- Compatibility dimensions
- Scoring ranges
- Thresholds
- Manual review boundaries

Matching behavior must never be altered implicitly.

---

### 7. Learning And Adaptation System

Defines:

- What can be learned
- What cannot be learned
- Guardrails on adaptation
- Update timing

Learning is bounded and explainable.

---

### 8. LinkUp Orchestration And Group Formation

Defines:

- How LinkUps are formed
- Preconditions
- Failure handling
- Retry and cancellation rules

Orchestration must be idempotent.

---

### 9. Contact Exchange And Post-Event Flow

Defines:

- When contact exchange is allowed
- Consent requirements
- Post-event messaging
- Failure paths

No contact exchange without explicit consent.

---

### 10. Website And Dashboard Surfaces

Defines:

- Supporting UI behavior
- Allowed mutations
- Read vs write boundaries

UI surfaces never bypass system rules.

---

### 11. Personality And Conversation Engine

Defines:

- Tone constraints
- Message structure rules
- Prohibited language
- Guardrails on AI behavior

Personality never overrides correctness or safety.

---

## Change Rules

- Changes to higher-authority specs may require reviewing lower layers.
- Changes to lower layers must not contradict higher layers.
- Safety-related changes are always allowed to restrict behavior.

---

## Non-Negotiable Rule

If a proposed change makes the system harder to reason about,
it is incorrect — even if it appears to work.
