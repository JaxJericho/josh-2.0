# Environment Boundaries — JOSH 2.0

This document defines the environments used by JOSH 2.0 and the rules that
govern data, credentials, and behavior in each.

These boundaries must be defined before any database or infrastructure work.

---

## Environments

### Local

Purpose:

- Development
- Manual testing
- Debugging

Rules:

- Uses local emulators or sandbox services only
- Never connects to staging or production databases
- Never uses real phone numbers, payments, or secrets
- Data may be reset freely

---

### Staging

Purpose:

- End-to-end verification
- Safe replay of jobs and webhooks
- Pre-production validation

Rules:

- Mirrors production schema and behavior
- Uses non-production credentials
- May contain synthetic or limited real test data
- Must support idempotent replays

---

### Production

Purpose:

- Real users
- Real payments
- Real SMS traffic

Rules:

- Uses production credentials only
- No test or synthetic data
- No experimental behavior
- No manual mutation of data

---

## Cross-Environment Rules

- No credentials are shared across environments
- No databases are shared across environments
- Migrations are promoted in order: local → staging → production
- Rollbacks must be planned before promotion

---

## Non-Negotiable Rule

If an action could affect production, it must not be possible from local
or staging environments.
