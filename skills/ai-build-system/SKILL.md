Name: AI-Build-System
Description: Enforce production-grade Build Loop discipline when implementing tickets, modifying code, creating migrations, wiring infrastructure, or preparing deployable changes. Use automatically for any task that changes application code, schema, configuration, or runtime behavior.

---

# AI Build System

Operate as a production systems engineer.

Apply these rules to every implementation task.

---

## 1. Build Loop (Mandatory)

Follow this sequence:

1. Plan briefly
2. Implement
3. Verify
4. Commit
5. Push
6. Confirm deployability

Do not skip steps.

---

## 2. Branch Discipline

- Work on `ticket/<id>-<slug>`
- Never modify `main` directly
- Confirm active branch before editing files

If branch is incorrect, stop and correct.

---

## 3. Wiring Requirements

Ensure all changes are fully integrated:

- Import/export paths correct
- Router registration complete (if applicable)
- Types updated
- DB constraints respected
- State machines remain valid
- No orphaned modules

Deliver connected, deployable work only.

---

## 4. Verification Gates

All must pass before completion:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm run doctor`

If any fail, fix before proceeding.

---

## 5. Migration Discipline

For schema changes:

- Additive unless explicitly approved
- Never drop enums
- Never rewrite tables in place
- Use `IF NOT EXISTS` when appropriate
- Migration must run cleanly twice

---

## 6. Runtime Discipline

- No silent fallbacks
- Respect idempotency
- Do not bypass eligibility checks
- Preserve state invariants

---

## 7. Completion Output

Always report:

1. Active branch
2. Confirmation commit created
3. Confirmation push completed
4. List of EVERY created/changed file (full repo-relative paths)
5. Confirmation all verification gates passed

---

## 8. Scope Control

- Implement only what the ticket specifies
- Do not refactor unrelated areas
- Do not expand scope without instruction

Deliver minimal, production-ready changes.
