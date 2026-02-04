# Runtime Boundaries — JOSH 2.0

This document defines where code runs, how components communicate,
and where state is allowed to change.

These boundaries are non-negotiable.

---

## Execution Environments

### Local

Used for:

- Development
- Testing
- Debugging

May simulate:

- SMS ingress/egress
- Webhooks
- Background jobs

Must never:

- Use production credentials
- Mutate production data

---

### Staging

Used for:

- End-to-end verification
- Safe replay of jobs and webhooks
- Pre-production validation

Must mirror production behavior as closely as possible.

---

### Production

Used for:

- Real users
- Real payments
- Real SMS

No experimental behavior is allowed.

---

## Runtime Components

### Web Server

- Handles HTTP requests
- Serves the website and dashboards
- Receives inbound webhooks

Must be stateless.

---

### SMS Ingress

- Receives inbound SMS
- Validates sender and message
- Routes messages via conversation routing

Must be idempotent.

---

### Background Jobs

- Handle async work (matching, notifications, follow-ups)
- Must be retry-safe
- Must not assume ordering

Jobs may be re-run without side effects.

---

### Database

- Source of truth for state
- Enforces constraints and invariants
- No business logic in the client

State mutations must be explicit and auditable.

---

## Communication Rules

- Clients may call servers
- Servers may enqueue jobs
- Jobs may mutate state
- Jobs must not call clients directly
- Clients must not mutate authoritative state

All communication paths are explicit.

---

## State Mutation Rules

- State changes occur in one place
- No hidden side effects
- Derived state must be reproducible
- Learning updates are gated and bounded

If a state change cannot be explained, it is incorrect.

---

## Synchronous vs Asynchronous

### Synchronous

- User-visible actions
- Eligibility checks
- Safety checks

### Asynchronous

- Matching
- Learning updates
- Notifications
- Follow-ups

Async work must tolerate retries and delays.

---

## Non-Negotiable Rule

If a proposed change blurs a runtime boundary,
the change must not be made.
