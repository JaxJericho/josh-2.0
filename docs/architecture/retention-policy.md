# Retention Policy — JOSH 2.0

This document defines retention timelines and deletion/anonymization strategy.
All compliance requirements are listed as "to confirm" items.

## Retention Timelines (Placeholders)

Replace placeholders once schema and compliance requirements are confirmed.

- Users: `<TBD>`
- Profiles: `<TBD>`
- Messages (metadata): `<TBD>`
- Messages (encrypted bodies): `<TBD>`
- Safety incidents / strikes: `<TBD>`
- Matching runs / candidates: `<TBD>`
- LinkUp records: `<TBD>`
- Billing records (Stripe IDs only): `<TBD>`
- Audit logs: `<TBD>`

## Deletion And Anonymization Strategy

- Prefer hard delete for non-regulated operational data when allowed.
- For user deletion requests:
  - Remove direct identifiers (phone, email)
  - Anonymize profile traits where possible
  - Retain minimal audit trail with anonymous IDs
- For SMS bodies:
  - Store encrypted at rest
  - Purge encrypted bodies on schedule
  - Retain only metadata needed for ops
- For safety incidents:
  - Retain for review window, then anonymize
  - Keep aggregate counts where needed

## Operational Deletion Workflow (High Level)

- [ ] Confirm deletion request is authorized
- [ ] Identify all tables that include user identifiers
- [ ] Run deletion/anonymization jobs in staging first
- [ ] Verify no PII remains
- [ ] Apply to production
- [ ] Record completion in internal log

## Compliance Checklist (To Confirm)

- [ ] Confirm applicable legal regimes (jurisdictional)
- [ ] Confirm minimum retention requirements for safety records
- [ ] Confirm data subject request SLAs
- [ ] Confirm audit log retention requirements
- [ ] Confirm whether message bodies must be purged on a strict schedule

## Notes

- Do not store unnecessary identifiers
- Default to least privilege access
- Do not log restricted data
