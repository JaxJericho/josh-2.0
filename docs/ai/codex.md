# Codex.md

This file is the single source of truth for how Codex must work in this repository.

If there is any conflict between these rules and what you would normally do, follow these rules.

## Operating Discipline

### Branch Discipline

- Spec changes:
  - Use spec/\* branches
  - Docs-only changes (typically docs/specs/\*\*)
- Implementation changes:
  - Use ticket/\* branches
  - Never modify docs/specs/\*_ on ticket/_ branches
- One ticket per PR. No scope mixing across tickets.

### Scope Discipline

- Implement exactly what the ticket spec says.
- Do not introduce new concepts, enums, conversation modes, schema changes, or refactors unless the spec explicitly requires it.
- Prefer the smallest change that satisfies the spec and keeps the build green.

### Verification Gates

Unless the spec says otherwise, every implementation PR must pass:

- pnpm lint
- pnpm typecheck
- pnpm build
- pnpm test

If migrations are involved:

- supabase db reset --no-seed must pass locally before claiming success
- Do not push migrations to staging unless explicitly instructed by the human operator
- Do not run supabase db pull unless explicitly instructed by the human operator

### Terminal Output Formatting

- When presenting terminal commands, output commands only. No inline comments in command blocks.

## How To Start A Ticket

1. Checkout and update main:

- git checkout main
- git pull

2. Create or switch to the ticket branch:

- ticket/<X.Y>-<slug> for implementation
- spec/<X.Y>-<slug> for docs-only/spec work

3. Read the ticket spec file:

- docs/specs/.../<X.Y>-<slug>.md

4. Implement exactly what the spec requires.

## Database And Migration Rules

### Migration Filename Requirements

- Supabase CLI only recognizes migrations with the pattern:
  YYYYMMDDHHMMSS_name.sql
- Do not create 8-digit or non-timestamp migration filenames.

### Migration Content Requirements

- Be deterministic and idempotent where feasible.
- Avoid destructive operations unless the spec explicitly calls for them and includes a precondition/rollout plan.
- If a migration is blocked by staging data (e.g., enum casts), stop and report the failing query and suggested remediation steps. Do not guess.

### Drift Avoidance

- Do not create drift-capture migrations (remote_schema, etc.) unless explicitly instructed.
- If a remote migration version mismatch occurs, stop and report:
  - supabase migration list
  - the mismatched versions
  - the exact error output

## Logging, Types, And Boundaries

### Types

- Keep types aligned across runtime and packages/db boundaries.
- When adding a new DB type, update:
  - packages/db/src/types (and any repo-specific type export points)
  - Any Zod schemas used for validation (if the spec requires it)

### Handlers And Router Wiring

- Prefer handler modules under packages/messaging/src/handlers/
- Wire routing through the shared conversation router as required by the spec
- Add/extend unit tests to cover the new behavior

### Observability

- If the spec requires structured log events, add them to the canonical event catalog and use those event names consistently.
- Do not invent new event naming schemes.

## Required Output Format After Implementation

When you finish, output the following in this exact order:

1. Branch name
2. Commit hash
3. Implementation summary
4. List EVERY created/changed file with FULL repo-relative paths (and why)
5. Verification results (commands + outputs)
6. PR title
7. PR summary (in code block)

Do not omit any of the above sections.

## When To Stop And Ask

Stop and report back (do not proceed) if:

- The spec is ambiguous about a load-bearing behavior
- Verification fails and the fix would require scope expansion
- A migration fails due to environment data, enum casts, constraints, or remote/local history mismatch
- You believe the spec requires modifying docs/specs/\*\* from an implementation branch
