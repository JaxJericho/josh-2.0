# Verification Checklist — JOSH 2.0

This checklist must be completed before any change is merged.

---

## Required Checks

Before committing:

- [ ] Lint passes
- [ ] Typecheck passes
- [ ] Tests pass (if applicable)
- [ ] Build passes

---

## Database Changes

If the change includes database work:

- [ ] Migration is present and named correctly
- [ ] Migration is idempotent
- [ ] Indexes and constraints are included
- [ ] Types regenerated
- [ ] Migration applied in staging

---

## Background Jobs And Webhooks

If the change includes jobs or webhooks:

- [ ] Idempotency keys defined
- [ ] Retry safety verified
- [ ] Duplicate side effects prevented
- [ ] Manual replay tested

---

## Environment And Ops

If the change requires manual setup:

- [ ] Environment variables documented
- [ ] Dashboards or external services configured
- [ ] Manual steps listed in PR description

---

## Safety And Eligibility

If the change touches safety or eligibility:

- [ ] Safety rules reviewed
- [ ] Eligibility enforcement verified
- [ ] No bypass paths introduced

---

## Non-Negotiable Rule

If any required item is unchecked, the change must not be merged.
