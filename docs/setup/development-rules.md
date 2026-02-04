# Development Rules — JOSH 2.0

These rules are mandatory for all work in this repository.
They exist to preserve correctness, safety, and long-term stability.

---

## One Task Per Change

- One task per commit.
- One task per pull request.
- Do not mix unrelated changes.

If work expands beyond the original task, stop and create a new task.

---

## Stop-And-Ask Conditions

Development must stop immediately if:

- Specs conflict or are ambiguous
- A change might weaken safety controls
- A state transition is unclear
- Matching or learning behavior could change unintentionally
- Credits or entitlements could be consumed incorrectly

Asking early is required.

---

## Spec Authority

- Behavioral authority lives in `docs/specs/josh-2.0/`
- Execution order lives in the build plan
- Code must conform to specs, not reinterpret them

If code and specs disagree, the specs win.

---

## Environment Discipline

- Local, staging, and production are strictly separated
- Never share secrets or data across environments
- Never test risky changes directly in production

---

## Safety-Critical Areas

Extra care is required when touching:

- SMS handling
- Safety and abuse prevention
- Eligibility and entitlements
- Contact exchange
- Learning and derived state updates

Changes in these areas require explicit verification.

---

## Non-Negotiable Rule

If a change increases speed but reduces clarity, safety, or auditability, do not make the change.
