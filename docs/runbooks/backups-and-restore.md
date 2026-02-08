# Backups And Restore — JOSH 2.0

This runbook defines backup verification and restore drills for Supabase.
Use it for both staging and production. Do not include secrets or PII.

## Scope

- Database backups for Supabase Postgres
- Staging and production verification checklists
- Restore drills and post-restore validation

## Backup Verification Checklist (Supabase Dashboard)

Run this in both staging and production projects.

### Staging (project ref: `wbeneoawrqvmoufubwzn`)

- [ ] Open Supabase Dashboard → Project Settings → Backups
- [ ] Confirm backups are enabled
- [ ] Confirm backup schedule (frequency) is visible
- [ ] Confirm retention period is visible
- [ ] Confirm latest backup timestamp is recent
- [ ] Record values in an internal ops note (do not paste into PR)

### Production (project ref: `<UNKNOWN_OR_TBD>`)

- [ ] Open Supabase Dashboard → Project Settings → Backups
- [ ] Confirm backups are enabled
- [ ] Confirm backup schedule (frequency) is visible
- [ ] Confirm retention period is visible
- [ ] Confirm latest backup timestamp is recent
- [ ] Record values in an internal ops note (do not paste into PR)

## Fields To Confirm (Do Not Guess)

- Backup frequency / schedule
- Retention period
- Point-in-time recovery (if enabled)
- Encryption-at-rest status (as shown in dashboard)

## Restore Drill Checklist (Staging Only)

Goal: Prove a restore can be performed and the app still functions.

Pre-reqs:
- Staging environment only
- Confirm no production credentials are in use

Steps:
- [ ] Announce the drill window to the team (internal)
- [ ] Snapshot current migration head (latest file in `supabase/migrations/`)
- [ ] Confirm current app version deployed to staging
- [ ] Initiate restore from a known backup in Supabase Dashboard
- [ ] Wait for restore completion
- [ ] Re-apply any migrations created after the backup (if needed)
- [ ] Confirm Supabase Edge Functions are healthy

## Post-Restore Validation Checklist

- [ ] Run a minimal smoke test for API routes and edge functions
- [ ] Verify Twilio inbound webhook responds 200 (staging only)
- [ ] Verify cron route auth rejects missing/invalid bearer token
- [ ] Verify DB schema matches migration head
- [ ] Confirm no unexpected data loss in key tables (spot check only)

## Failure Modes Checklist

If restore fails or behavior is incorrect, check:

- [ ] RLS policies exist and are enabled
- [ ] Service role key and anon key are present in staging env config
- [ ] Edge Functions `verify_jwt` settings are correct
- [ ] Webhook URLs still point to staging project ref
- [ ] Cron route still points to staging runner URL
- [ ] Migrations after backup were re-applied

## Rollback Notes

If the restore drill causes issues:
- Re-restore from a newer backup
- Re-deploy the current staging build
- Re-apply migrations to align schema

## Evidence Capture (No Secrets)

Store evidence as internal notes only:
- Date/time of drill
- Backup timestamp used
- Result: success/fail
- Observed issues and remediation steps
