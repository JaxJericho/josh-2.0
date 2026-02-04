# Database Migrations — JOSH 2.0

This document defines how database migrations are written, reviewed,
and promoted across environments.

No schema work may begin before these rules exist.

---

## Migration Principles

- Migrations must be deterministic
- Migrations must be idempotent
- Migrations must be ordered
- Migrations must be reversible where possible

If a migration cannot be safely reasoned about, it must not be written.

---

## What Migrations May Do

Allowed:

- Create or modify tables
- Add indexes and constraints
- Perform bounded backfills
- Add non-breaking defaults

---

## What Migrations Must Not Do

Forbidden:

- Destructive data loss without explicit approval
- Long-running unbounded operations
- Business logic execution
- Side effects outside the database

---

## Backfills

- Backfills must be incremental
- Backfills must be resumable
- Backfills must not lock critical tables
- Large backfills must be split across migrations

---

## Promotion Rules

- Migrations are authored locally
- Applied to staging first
- Verified against real flows
- Promoted to production only after verification

No migration skips staging.

---

## Rollback Expectations

- Every migration must have a rollback plan
- Rollbacks must be tested in staging
- If rollback is impossible, mitigation must be documented

---

## Non-Negotiable Rule

If a migration puts production data at risk,
it must not be merged.
