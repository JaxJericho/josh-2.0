# JOSH 2.0

JOSH 2.0 is an SMS-first friendship matching system designed for correctness, safety, and long-term operational stability.

JOSH is not a chat app, a dating app, or a social feed. It is a **guided, stateful system** that helps people form real-world connections through intentional group experiences, with strict enforcement of consent, eligibility, and safety at every boundary.

---

## What JOSH Is

JOSH is a **deterministic product system with conversational surfaces**.

Core characteristics:

- SMS-first. The website and dashboard are supporting surfaces, not the core experience.
- State-driven. All user actions are governed by explicit state machines and contracts.
- Safety-forward. Safety rules override growth, engagement, and convenience.
- Explainable. Matching and learning behavior must be debuggable and bounded.

Correctness is prioritized over cleverness.

---

## What JOSH Is Not

JOSH is explicitly not:

- A real-time chat platform
- A social feed or community
- An opaque ML recommendation engine
- A therapeutic, coaching, or counseling system
- A free-form AI assistant

Any implementation that drifts toward these patterns is incorrect.

---

## Source Of Truth

The single source of truth for **system behavior** lives in:
