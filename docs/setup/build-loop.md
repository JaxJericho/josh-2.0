# Build Loop — JOSH 2.0

This repository follows a strict, repeatable build loop.
All work must follow this sequence.

Skipping steps creates instability and rework.

---

## The Build Loop

### 1. Plan

Before writing code:

- Identify the exact spec(s) in `docs/specs/josh-2.0/` that apply.
- Confirm the change is in scope.
- Identify safety, eligibility, or state implications.
- Clarify ambiguities before proceeding.

If the spec is unclear, stop and ask.

---

### 2. Implement

- Make the smallest change required to satisfy the plan.
- Follow existing patterns and contracts.
- Do not refactor unrelated code.
- Do not change matching, learning, or safety behavior unless explicitly intended.

---

### 3. Verify Locally

Before committing, run all relevant checks:

- Lint
- Typecheck
- Tests
- Build

If a check fails, fix it before continuing.

---

### 4. Commit

- Commit only code related to the current task.
- Use clear, scoped commit messages.
- Do not bundle unrelated changes.

---

### 5. Push And Open PR

- Push the branch.
- Open a pull request.
- Describe what changed and why.
- List any manual steps required (migrations, env vars, dashboards).

---

### 6. Merge

- Merge only after verification is complete.
- Do not bypass required checks.
- Do not merge partially complete work.

---

## Non-Negotiable Rule

If a change violates the build loop, it is considered incorrect even if it “works.”
