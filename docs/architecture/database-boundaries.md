# Database Boundaries — JOSH 2.0

This document defines where database reads and writes are allowed
and where business logic is permitted to live.

These rules apply to all environments.

---

## Database As Source Of Truth

- The database is the authoritative source of system state
- All state transitions must be persisted explicitly
- Derived state must be reproducible from base state

No hidden or implicit state is allowed.

---

## Allowed Writers

The following may write to the database:

- Server-side application code
- Background jobs
- Database migrations (schema and backfills only)

All writes must be intentional and auditable.

---

## Forbidden Writers

The following must never write to the database:

- Client-side code
- Browsers
- Admin dashboards bypassing server logic
- LLMs or AI tools directly

Clients may request changes, but servers decide.

---

## Business Logic Placement

### Allowed

- Application layer (validation, orchestration)
- Database constraints (foreign keys, uniqueness)

### Forbidden

- Complex business logic in migrations
- Side effects in database triggers
- Implicit state changes

---

## Read Rules

- Clients may read permitted data only
- Sensitive data requires explicit authorization
- Read paths must respect safety and eligibility rules

---

## Non-Negotiable Rule

If a database write cannot be traced to an explicit server-side decision,
the design is incorrect.
