# JOSH 2.0 Project Guidance

## Source Of Truth

- Specs: docs/specs/josh-2.0/
- Architecture guardrails: docs/architecture/
- Ticket workflow: docs/setup/ticket-workflow-and-pr-rules.md

If anything conflicts, follow specs + architecture. If still unclear, stop and ask.

## Build Loop (Mandatory)

Plan → Implement → Verify → Commit/PR → Merge

- One ticket per PR.
- Never commit directly to main.

## Environment Safety

- Local-first always.
- Do not link cloud projects until the ticket explicitly requires it.
- For Phase 1:
  - Link Supabase staging only after local migrations verify.
  - Do not link production until staging verification is clean.

## Database Discipline

- All schema changes must be migrations under supabase/migrations/.
- No manual schema edits in Supabase Studio.
- Use DB constraints for idempotency and uniqueness.
- After migrations: regenerate types and fix TypeScript.
