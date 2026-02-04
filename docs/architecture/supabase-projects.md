# Supabase Project Strategy — JOSH 2.0

This document defines how Supabase projects are structured and used
across environments.

Database work must not begin until this is defined.

---

## Supabase Projects

JOSH 2.0 uses **three separate Supabase projects**:

1. Local (Supabase CLI)
2. Staging
3. Production

Each project has its own:

- Database
- Auth configuration
- Storage
- Secrets

No project is shared across environments.

---

## Local Project

- Managed by Supabase CLI
- Runs locally using Docker
- Used for:
  - Development
  - Migration authoring
  - Local testing

Local databases may be reset freely.

---

## Staging Project

- Cloud-hosted Supabase project
- Mirrors production schema
- Used for:
  - End-to-end testing
  - Migration verification
  - Safe replay of jobs

Staging data may be wiped if necessary.

---

## Production Project

- Cloud-hosted Supabase project
- Source of truth for real users
- Contains irreversible data

No destructive actions are allowed without explicit approval.

---

## Migration Promotion Rules

- Migrations are authored locally
- Applied to staging first
- Verified in staging
- Promoted to production only after verification

Migrations must be idempotent and ordered.

---

## Non-Negotiable Rule

If a migration cannot be safely applied to production,
it must not exist.
