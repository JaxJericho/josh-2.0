# AI Prompt Template — JOSH 2.0

Role: [Specify Correct Role For This Ticket]

Examples:

- Principal Database Engineer
- Principal Backend Engineer
- Production Readiness Engineer
- Messaging Systems Engineer
- Security & RLS Architect

Repo: josh-2.0

Branch (MANDATORY — Must Be Used)

Before doing any work:

1. git checkout main
2. git pull --rebase
3. git checkout -b ticket/[TICKET-ID]-[short-slug]

If branch already exists:

- git checkout ticket/[TICKET-ID]-[short-slug]

Confirm active branch before proceeding.
If active branch is main: STOP. Do not proceed.

Context

Briefly describe the context of this task.

Infrastructure Status:

- Staging Supabase project ref: rcqlnfywwfsixznrmzmv
- Production Supabase: [Not Created]
- Staging Vercel: https://josh-2-0-staging.vercel.app
- Production Vercel: https://josh-2-0-production.vercel.app
- Production domain: https://www.callmejosh.ai

Environment Contract:
Canonical env contract lives at:
docs/runbooks/environment-contract.md

Doctor / Preflight:
Run:
pnpm run doctor

Goal

[Clear, explicit description of what this ticket must accomplish.]

Be specific.
No vague goals.
Define exact success criteria.

Hard Rules (Non-Negotiable)

- Do NOT assume any dependency is configured correctly.
- Do NOT assume any integration is wired.
- Do NOT use dashboard click-ops unless explicitly allowed.
- Migrations only (if DB ticket).
- No silent fallbacks.
- Fail fast on misconfiguration.
- Exit non-zero on validation failure.
- Do not print secrets.
- Keep changes tightly scoped to this ticket.
- Commit and push when complete.
- List EVERY created/changed file with FULL repo-relative paths.
- Provide PR title and PR body.

Inputs / Source Files

Explicitly list canonical spec files this ticket must align with.

Examples:

- docs/specs/josh-2.0/Database Schema And Relationships (JOSH 2.0).md
- docs/specs/josh-2.0/Domain Model And State Machines (JOSH 2.0).md
- docs/runbooks/environment-contract.md
- docs/runbooks/webhooks-twilio.md

If file path differs, locate correct one and state it.

Tasks

1. [Task 1 — explicit]
   - Files to create:
   - Files to update:
   - Constraints to enforce:
   - Indexes required:
   - Idempotency rules (if relevant):
   - Security requirements:

2. [Task 2 — explicit]

3. [Task 3 — explicit]

Be concrete. No ambiguity.

Verification (Must Be Demonstrated)

The following must pass:

pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm run doctor (if environment-related)

If DB ticket:

- Migration apply command
- SQL verification queries
- Evidence of indexes + constraints

If messaging ticket:

- Simulated webhook test
- Idempotency test
- CLI proof of execution
- DB verification queries

If billing ticket:

- Simulated Stripe event replay
- Webhook verification

Must show:

- Command outputs
- Evidence of constraints/indexes
- Evidence of idempotency

Deliverables

- Implementation complete
- Commit pushed to correct branch
- PR title
- PR body
- FULL list of created/changed files (repo-relative paths)
- Summary of verification results
- Exact staging test commands

Proceed now.
