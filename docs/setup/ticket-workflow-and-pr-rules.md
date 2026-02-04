# Ticket Workflow And PR Rules

This document defines the canonical workflow for executing tickets and submitting pull requests for JOSH 2.0.

This workflow is non-negotiable. If a step is skipped, the ticket is not complete.

## Scope

Applies to:

- All code changes
- All migrations
- All documentation changes that affect system behavior, safety, or operations

Does not apply to:

- Pure note-taking drafts that never ship to `main`

## Single Source Of Truth

System behavior is defined by:

- `docs/specs/josh-2.0/`

Architecture and operational guardrails are defined by:

- `docs/architecture/`

If code disagrees with specs, specs win.

## Ticket Workflow

Each ticket follows the same Build Loop.

### 1. Plan

Deliverables:

- A short implementation plan (5–12 bullets)
- Clear acceptance criteria
- Enumerated risks and edge cases
- Any manual tasks required (env vars, dashboards, CLI linking, migrations)

Rules:

- If the ticket touches user-visible behavior, cite the relevant spec file(s) by path
- If the ticket touches safety, cite the safety spec file(s) by path
- If the ticket touches state transitions, cite the domain model spec by path

### 2. Implement

Rules:

- Make the smallest correct change that satisfies the ticket
- Do not introduce new abstractions unless the ticket requires them
- Do not change spec-defined behavior without a spec change first

### 3. Verify

Deliverables:

- A verification checklist executed locally
- Evidence of success (command output summary)

Rules:

- Verification commands are defined in `docs/setup/verification-checklist.md`
- If the ticket includes migrations, include a fresh migration run on a clean local DB

### 4. Commit

Rules:

- One ticket per PR
- Commits should be scoped and descriptive
- Do not mix refactors with behavior changes

Commit message format:

- `chore: ...` for tooling/docs that do not change behavior
- `spec: ...` for specs
- `arch: ...` for architecture guardrails
- `feat: ...` for new behavior
- `fix: ...` for bug fixes
- `refactor: ...` for non-functional restructuring

### 5. Pull Request

Deliverables:

- PR title
- PR summary
- Checklist completion
- Manual tasks listed explicitly

### 6. Merge

Rules:

- Merge only after verification is complete
- Merge only after CI checks pass
- Merge only when the PR clearly maps to a single ticket

## Branch And PR Rules

### Branch Naming

Use one of:

- `feat/<ticket-short-name>`
- `fix/<ticket-short-name>`
- `chore/<ticket-short-name>`
- `spec/<ticket-short-name>`
- `arch/<ticket-short-name>`

Examples:

- `arch/env-boundaries`
- `spec/import-josh-2-specs`
- `feat/profile-interview-sms`

### One Ticket Per PR

Rules:

- A PR must implement exactly one ticket
- If a change is discovered that belongs elsewhere, open a follow-up ticket

### PR Title

Format:

- `<type>: <ticket name>`

Examples:

- `arch: Define database migration discipline`
- `spec: Import canonical JOSH 2.0 specifications`

### PR Summary Must Include

- What changed
- Why it changed
- What specs or architecture docs it relates to (by file path)
- How it was verified (exact commands)
- Manual tasks required (if any)

### Manual Tasks Reporting

If a ticket requires manual work, list it explicitly in the PR summary as a checklist.

Examples:

- Set env vars in Vercel staging and production
- Apply migrations to staging
- Configure Supabase auth settings
- Confirm Twilio console configuration

## Migrations And Database Safety

Rules:

- Migrations must follow `docs/architecture/migrations.md`
- Migrations must be authored locally
- Migrations must be applied to staging before production
- Never connect local tooling to production unless the ticket explicitly requires it

## Definition Of Done

A ticket is done only when:

- The change matches the relevant specs
- Verification steps have been executed and recorded
- All required manual tasks are listed and completed
- PR is merged with passing checks
- Any follow-up tickets are created and captured
  n

## Non-Negotiable Rule

If a change makes the system harder to reason about or less safe to operate, it is incorrect, even if it appears to work.
