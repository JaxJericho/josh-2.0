# Codex Template — JOSH 2.0

Copy into Codex at ticket start:

```
Role:
-

Ticket:
-

Source-of-Truth Files (must read before planning):
- docs/specs/josh-2.0/josh-2.0-comprehensive-build-plan.md
- AGENTS.md
- CLAUDE.md
- docs/ai/README.md

Constraints:
- Minimal scoped changes only
- No broad refactors
- Do not print secrets
- Follow build loop exactly

Plan:
- Files to touch (paths + why)
- Risks/edge cases
- Verification steps

Implement:
- Smallest correct change set

Verify:
- pnpm lint
- pnpm typecheck (if present)
- pnpm test (if present)
- pnpm build

PR Output:
- What changed
- Why it changed
- What specs or architecture docs it relates to (by file path)
- How it was verified (exact commands)
- Manual tasks required (if any)
- Env vars added/changed (names only)
- Migrations added/applied (filenames + where)
- Rollback plan
```
