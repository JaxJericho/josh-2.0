# AI Prompt Template — JOSH 2.0

Role:
- 

Ticket:
- 

Source-of-Truth Files (must read before planning):
- docs/specs/josh-2.0/josh-2.0-comprehensive-build-plan.md
- AGENTS.md
- CLAUDE.md
- docs/ai/README.md
- docs/architecture/environments.md
- docs/architecture/environment-variables.md
- docs/architecture/runtime-boundaries.md
- docs/architecture/database-boundaries.md
- docs/architecture/migrations.md

Constraints:
- Minimal scoped changes only
- No broad refactors
- Do not print secrets
- Docs/templates only (if applicable)
- No external dependencies

Build Loop (required):
1. Plan: list files to touch and why; risks; verification steps
2. Implement: smallest change set
3. Verify: run required commands and report results
4. Commit: one ticket per branch
5. Push + PR: include required PR fields

Verification (unless ticket says otherwise):
- pnpm lint
- pnpm typecheck (if present)
- pnpm test (if present)
- pnpm build

PR Requirements:
- Summary of changes
- Files changed
- Env vars added/changed (names only)
- Migrations added/applied (filenames + where)
- Manual steps
- Rollback plan
