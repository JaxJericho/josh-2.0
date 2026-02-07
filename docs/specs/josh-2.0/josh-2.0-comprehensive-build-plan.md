# JOSH 2.0 Comprehensive Build Plan

## Purpose

This is the single, authoritative, ticket-based build plan for JOSH 2.0. It starts with foundations and ends with staged E2E validation and production cutover. It is optimized for stability and minimal rework by sequencing “foundations first” (contracts, schema, reliability, scheduler proof) before feature breadth and UI polish.

This plan assumes:

* Vercel for web and API hosting.  
* Supabase for Postgres, Auth, Storage (if used), and Edge Functions.  
* Twilio for SMS.  
* Stripe for billing.  
* A scheduler path that is explicitly proven early (Vercel Cron is the default).  
* Production-grade correctness: least privilege, secure-by-default auth, idempotency, retry safety, and minimal scoped changes per ticket.

Key constraints:

* Not time-bound. Ticket-bound.  
* One ticket per PR.  
* Avoid broad refactors.  
* Manual work is limited to dashboards, secrets, and external service configuration.  
* JOSH personality is a first-class deliverable (prompt library, constraints, guardrails, fixtures).

Source plan consolidation notes:

* This plan incorporates the full scope and sequencing intent of the original plan and the revised plan.  
* QStash-specific scheduling is removed as a hard dependency due to operational friction; the default scheduler path is Vercel Cron calling a protected Next.js endpoint, which invokes Supabase Edge Functions.

---

## Global Operating Rules

### One Ticket Per PR

* Every ticket is one branch and one PR.  
* Never commit to main.  
* Every PR includes:  
  * Verification commands run and results.  
  * Migrations applied (if any) and filenames.  
  * Env vars added/changed (names only, no values).  
  * Rollback notes.

### Environment Separation

Maintain strict separation for:

* Supabase: staging vs production projects.  
* Vercel: staging vs production projects (or equivalent environment separation).  
* Twilio: staging vs production Messaging Service and numbers.  
* Stripe: staging vs production endpoints and Price IDs.

### Reliability Rules

* All webhook handlers must validate signatures.  
* All inbound message processing must be idempotent.  
* All outbound sends must be idempotent.  
* All runners and schedulers must be retry safe under concurrency.  
* Scheduled work must be explicitly proven early in staging before downstream orchestration.

### Secrets Rules

* Never paste secrets into PRs, docs, issues, or logs.  
* If a secret is pasted anywhere, rotate it.  
* Secret rotation steps must be documented.

---

## Repository Layout To Support Build And Ops

Ensure the repo contains predictable locations for specs, runbooks, prompts, and test harnesses so Claude Code and Codex can “find the truth” quickly.

### Recommended Folder Tree

```
.
├─ apps/
│  ├─ web/                        # Next.js app (public site + dashboard + admin)
│  └─ api/                        # Optional: split API from web; otherwise keep in web
├─ packages/
│  ├─ shared/                     # shared types, utils, domain logic
│  ├─ db/                         # db helpers, migrations helpers, generated types
│  ├─ messaging/                  # Twilio templates + helpers
│  └─ ai/                         # LLM client, prompt library, output validators, eval harness
├─ prompts/
│  ├─ josh/                       # prompt source files (versioned, human-readable)
│  └─ README.md                   # what prompts exist + how to change safely
├─ supabase/
│  ├─ migrations/                 # canonical migrations (tracked)
│  ├─ seed/                       # seed scripts + fixtures
│  └─ config.toml
├─ docs/
│  ├─ specs/josh-2.0/             # buildable specs (exported authoritative docs)
│  ├─ setup/                      # CLI + environment setup
│  ├─ runbooks/                   # ops playbooks: incidents, billing, regions, etc.
│  ├─ testing/                    # E2E plan + manual testing checklist
│  └─ architecture/               # diagrams, ADRs, integration contracts
├─ scripts/
│  ├─ dev/                        # local helpers (reset db, seed, gen types)
│  ├─ staging/                    # guarded scripts for staging (seed, reconcile)
│  └─ ops/                        # safe operational scripts (rebuild derived state)
├─ .github/
│  ├─ pull_request_template.md
│  └─ copilot-instructions.md     # optional; keep aligned with agent rules
├─ .vscode/
│  ├─ settings.json
│  ├─ extensions.json
│  ├─ tasks.json
│  └─ launch.json
├─ .editorconfig
├─ .env.example
├─ README.md
└─ SECURITY.md
```

Notes:

* If your repo is already monorepo or not, keep your structure. Ensure these directories exist somewhere consistent.  
* `docs/specs/josh-2.0/` is the single source of truth for system behavior.  
* `prompts/` is the single source of truth for personality prompt text.

---

## AI Coding Assistant Toolkit

This section defines the files, templates, and procedures that make Claude Code and Codex reliable and consistent.

### Required Files

* `.github/pull_request_template.md`  
* `docs/ai/README.md`  
* `docs/ai/definitions.md` (glossary: LinkUp, Runner, Holds, Entitlements, SafeChat)  
* `docs/ai/ticket-template.md`  
* `docs/ai/prompt-template.md` (your canonical prompt template)  
* `docs/ai/claude-code-template.md`  
* `docs/ai/codex-template.md`

### Required Runbooks

* `docs/runbooks/environment-contract.md`  
* `docs/runbooks/secrets-and-rotation.md`  
* `docs/runbooks/schema-and-types.md`  
* `docs/runbooks/vercel-cron-runner.md`  
* `docs/runbooks/webhooks-twilio.md`  
* `docs/runbooks/webhooks-stripe.md`  
* `docs/runbooks/backups-and-restore.md`  
* `docs/runbooks/staging-soak.md`  
* `docs/runbooks/production-cutover-and-rollback.md`

### Required Testing Docs

* `docs/testing/e2e-harness.md`  
* `docs/testing/simulator.md`

### Required Utility Scripts

* `scripts/doctor.mjs` (safe diagnostics, no secret values)  
* `scripts/print-env-fingerprint.mjs` (presence, length, sha256 prefix)  
* `scripts/simulate-twilio-inbound.mjs` (local/staging testing helper)  
* `scripts/simulate-twilio-status.mjs` (local/staging testing helper)

---

## VS Code Agent Context System

### VS Code Settings

* `.vscode/settings.json`:  
  * format on save  
  * ESLint integration  
  * TypeScript SDK: workspace  
  * search excludes aligned to ignores  
* `.vscode/extensions.json`: ESLint, Prettier, SQL tooling, etc.  
* `.vscode/tasks.json`:  
  * tasks: lint, typecheck, test, build, gen types, reset and seed local  
* `.vscode/launch.json`: debug configs for Next.js server and API routes

### AI Instruction Files

* Keep your prompt template in `docs/ai/prompt-template.md`.  
* Keep your PR template in `.github/pull_request_template.md`.

---

## Standard Ticket Format

Every ticket must include:

* Goal  
* Scope  
* Dependencies  
* Agent Work (Claude Code and Codex)  
* Manual Work (You)  
* Acceptance Criteria  
* Verification Checklist  
* Artifacts Updated Or Created  
* Risk Notes  
* PR Requirements

---

# Phase 0: Additive Foundation Improvements (Do Not Redo Prior Work)

## Ticket 0.3: Rebaseline Inventory And Project Map (Docs \+ Doctor Script)

* Goal: Stop guessing. Create an authoritative map of environments \+ a safe diagnostics script.  
* Scope: Docs and scripts only. No runtime behavior changes.  
* Dependencies: None.  
* Agent Work:  
  * Create `docs/runbooks/environment-contract.md` with:  
    * Staging vs production: Supabase refs, Vercel base URLs  
    * Twilio inbound webhook \+ status callback URLs per env  
    * Stripe webhook URLs per env  
    * Scheduler path (Vercel Cron route → Supabase runner endpoint)  
    * Required env vars (names only)  
  * Add `scripts/doctor.mjs` that checks (no secret values):  
    * env var presence (set/unset)  
    * runner URL contains no query params  
    * webhook route files exist  
    * build scripts exist  
    * outputs PASS/FAIL with next-step hints  
  * Create `docs/runbooks/rebaseline-findings.md`.  
* Manual Work (You):  
  * Fill in any missing URL names you know (no secrets).  
* Acceptance Criteria:  
  * `node scripts/doctor.mjs` provides a clean PASS/FAIL output and exits non-zero on FAIL.  
* Verification Checklist:  
  * `node scripts/doctor.mjs`  
* Artifacts Updated/Created:  
  * `docs/runbooks/environment-contract.md`  
  * `scripts/doctor.mjs`  
  * `docs/runbooks/rebaseline-findings.md`

## Ticket 0.4: AI Assistant Toolkit Scaffolding (Templates)

* Goal: Make Claude Code and Codex execution consistent.  
* Scope: Templates and docs only.  
* Dependencies: None.  
* Agent Work:  
  * Add:  
    * `.github/pull_request_template.md`  
    * `docs/ai/README.md`  
    * `docs/ai/definitions.md`  
    * `docs/ai/ticket-template.md`  
    * `docs/ai/prompt-template.md` (your canonical template)  
    * `docs/ai/claude-code-template.md`  
    * `docs/ai/codex-template.md`  
* Manual Work (You): None.  
* Acceptance Criteria:  
  * Templates exist and are referenced from `docs/ai/README.md`.

## Ticket 0.5: Secrets And Rotation \+ Env Fingerprints

* Goal: Verify “which token is active” without ever printing secrets.  
* Scope: Runbook \+ helper script.  
* Dependencies: None.  
* Agent Work:  
  * Create `docs/runbooks/secrets-and-rotation.md`.  
  * Add `scripts/print-env-fingerprint.mjs` (presence, length, sha256 prefix only).  
  * Add `pnpm env:fingerprint`.  
* Manual Work (You):  
  * Decide where local env vars live (shell vs `.env.local`).  
* Acceptance Criteria:  
  * You can confirm mismatched tokens via fingerprint output.

## Ticket 0.6: Scheduler Baseline Swap (QStash → Vercel Cron) For Staging

* Goal: Replace the fragile scheduler path with a proven one that you own.  
* Scope: Vercel cron config \+ protected cron route \+ runbook. Does not change the runner logic.  
* Dependencies: None.  
* Agent Work:  
  * Add `vercel.json` cron:  
    * Path: `/api/cron/twilio-outbound-runner`  
    * Schedule: start with `*/5 * * * *`  
  * Add protected cron route that:  
    * Requires `Authorization: Bearer ${CRON_SECRET}`  
    * Calls Supabase runner endpoint using `STAGING_RUNNER_URL` and `STAGING_RUNNER_SECRET`  
    * Hard-fails if runner URL contains `?`  
    * Returns upstream status and body  
  * Create `docs/runbooks/vercel-cron-runner.md`.  
* Manual Work (You):  
  * In Vercel staging env vars set:  
    * `CRON_SECRET`  
    * `STAGING_RUNNER_URL` (no query params)  
    * `STAGING_RUNNER_SECRET`  
  * Redeploy staging.  
* Acceptance Criteria:  
  * Cron route returns 200 with correct auth.  
  * Supabase Edge Function logs show scheduled invocations.  
    ---

# Phase 1: Additive Database Readiness (Do Not Redo Existing Schema)

## Ticket 1.2: Schema Drift Guardrails (If Not Already Enforced)

* Goal: Prevent schema/type mismatches from breaking builds.  
* Scope: scripts \+ CI only.  
* Dependencies: None.  
* Agent Work:  
  * Add scripts:  
    * `pnpm db:gen-types`  
    * `pnpm db:verify-types` (fails if types are stale)  
  * Document in `docs/runbooks/schema-and-types.md`.  
  * Add CI check if feasible in this repo.  
* Manual Work (You):  
  * Ensure Supabase CLI is linked for type generation (already done for staging).  
* Acceptance Criteria:  
  * CI (or local) fails when types are stale.

## Ticket 1.5: Backups, Restore, Retention, Data Classification (Docs \+ Verification)

* Goal: Production ops safety for data.  
* Scope: docs \+ checklist.  
* Dependencies: None.  
* Agent Work:  
  * Create:  
    * `docs/runbooks/backups-and-restore.md`  
    * `docs/architecture/data-classification.md`  
    * `docs/architecture/retention-policy.md`  
* Manual Work (You):  
  * Confirm backup settings for staging \+ production.  
    ---

# Phase 2: Messaging Core (Outstanding)

## Ticket 2.3: Twilio Status Callback Handler

* Goal: Track delivery outcomes and reconcile message state.  
* Scope: Callback endpoint, idempotency, status history.  
* Dependencies: Phase 2.2 complete.  
* Agent Work:  
  * Implement status callback endpoint.  
  * Idempotent update of last status.  
  * Store status history rows.  
  * Update `docs/runbooks/webhooks-twilio.md` with exact callback configuration.  
* Manual Work (You):  
  * Configure Twilio status callback URL for staging.  
* Acceptance Criteria:  
  * Duplicate callbacks do not corrupt state.  
  * Message status transitions are visible in logs/DB.

## Ticket 2.4: Messaging Simulator And Golden Tests

* Goal: Test messaging flows without needing many real phones.  
* Scope: simulator scripts \+ fixtures \+ docs.  
* Dependencies: Ticket 2.3.  
* Agent Work:  
  * Add:  
    * `scripts/simulate-twilio-inbound.mjs`  
    * `scripts/simulate-twilio-status.mjs`  
  * Add fixtures.  
  * Create `docs/testing/simulator.md`.  
* Manual Work (You): None.  
* Acceptance Criteria:  
  * You can simulate inbound \+ status callbacks against staging.

---

# Phase 3: Conversation Router, Interview, And Personality

## Ticket 3.1: Intent Routing Contract

* Goal: Deterministically route inbound messages into the correct flow.  
* Scope: Local parsers, LLM classifier fallback, one-clarifier rule.  
* Dependencies: Ticket 2.1.  
* Agent Work:  
  * Implement deterministic routing for common intents.  
  * Add LLM fallback for ambiguous cases.  
  * Enforce one-clarifier rule.  
  * Add tests for representative messages.  
* Manual Work:  
  * Add LLM provider keys in staging.  
* Acceptance Criteria:  
  * Deterministic routing for representative messages.

## Ticket 3.2: Interview And Signal Extraction

* Goal: Complete onboarding via SMS and store a usable profile.  
* Scope: Step catalog, extractor contract, persistence mapping, resume behavior.  
* Dependencies: Ticket 3.1.  
* Agent Work:  
  * Implement interview flow.  
  * Persist extracted signals.  
  * Resume after interruption.  
* Manual Work:  
  * Confirm onboarding copy.  
* Acceptance Criteria:  
  * Full interview creates complete profile.  
  * Partial interview resumes correctly.

## Ticket 3.3: JOSH Personality Prompt Library And Output Guardrails

* Goal: A versioned prompt library that shapes user-facing SMS with hard constraints.  
* Scope: Prompt runtime, prompt sources, validators, eval harness, wiring into SMS paths.  
* Dependencies: Ticket 3.1.  
* Agent Work:  
  * Add `packages/ai/` prompt runtime:  
    * Prompt registry (IDs, versions)  
    * Rendering helpers  
    * Output validators and normalizers:  
      * SMS length cap  
      * Exactly one question or bounded choice list  
      * Deny-list for AI-speak phrases  
      * No therapy framing  
      * No contact sharing in SMS  
  * Add prompt sources under `prompts/josh/`:  
    * Conversation management prompt  
    * Follow-up question prompt  
    * Clarifier prompt  
  * Add lightweight eval harness:  
    * `scripts/dev/eval-personality` runs fixture conversations  
    * Asserts outputs meet constraints  
  * Wire personality layer into SMS response paths:  
    * Interview messages  
    * Post-event prompts  
    * General support responses (non-HELP)  
* Manual Work:  
  * Pick initial model and routing defaults per environment.  
  * Review and approve prompt text.  
* Acceptance Criteria:  
  * Eval harness passes fixtures.  
  * SMS outputs are short, one question, aligned tone, no contact info.

## Ticket 3.4: Deterministic Fallback Messaging For Critical Paths

* Goal: Critical responses work even if the LLM is unavailable.  
* Scope: Deterministic templates for STOP, HELP, billing status, outages.  
* Dependencies: Ticket 3.1.  
* Agent Work:  
  * Implement fallback templates and routing.  
* Manual Work:  
  * Approve template copy.  
* Acceptance Criteria:  
  * Critical paths never require LLM availability.

---

# Phase 4: Matching And LinkUp Orchestration

## Ticket 4.1: Eligibility And Region Gating

* Goal: Gate participation by region status and eligibility rules.  
* Scope: Region states, waitlist handling, eligibility enforcement.  
* Dependencies: Ticket 3.2.  
* Agent Work:  
  * Implement region gating states.  
  * Implement waitlist behavior.  
* Manual Work:  
  * Confirm which regions are open and closed.  
* Acceptance Criteria:  
  * Users in closed regions are waitlisted and handled consistently.

## Ticket 4.2: Matching Engine And Explainability

* Goal: Produce candidate sets and ranked matches with explainability metadata.  
* Scope: Filters, scoring, tie-breakers, match runs storage, deterministic output.  
* Dependencies: Ticket 4.1.  
* Agent Work:  
  * Implement matching run pipeline.  
  * Store match run output.  
  * Ensure deterministic output for same run key.  
* Manual Work:  
  * Ensure staging has enough seeded users.  
* Acceptance Criteria:  
  * Same run key produces same results.  
  * Holds and blocks exclude candidates.

## Ticket 4.3: LinkUp Orchestration And Scheduling

* Goal: Create LinkUps, run invite waves, lock quorum, and schedule reminders.  
* Scope: Idempotent creation, invites, lock transaction, reminders.  
* Dependencies: Ticket 4.2 and Ticket 2.2.  
* Agent Work:  
  * Implement LinkUp orchestration state machine.  
  * Ensure create key idempotency.  
  * Implement quorum lock transaction.  
  * Schedule reminders via runner-driven jobs.  
* Manual Work:  
  * None beyond existing scheduler baseline.  
* Acceptance Criteria:  
  * Duplicate create does not duplicate LinkUp.  
  * Lock happens once.  
  * Reminders schedule and are idempotent.

---

# Phase 5: Post-Event And Contact Exchange

## Ticket 5.1: Post-Event Outcome Capture

* Goal: Collect outcomes after a LinkUp and store results.  
* Scope: Prompts, parsing, persistence, schedule triggers.  
* Dependencies: Ticket 4.3.  
* Agent Work:  
  * Implement post-event prompts and outcome storage.  
  * Ensure replies are idempotent under retries.  
* Manual Work:  
  * Approve post-event copy.  
* Acceptance Criteria:  
  * Simulated past event triggers prompts.  
  * Replies do not double-apply.

## Ticket 5.2: Mutual Consent Contact Exchange With Safety Gates

* Goal: Exchange contact info only after mutual consent and safety checks.  
* Scope: Choices upsert, mutual detection, reveal messaging, suppression on holds and blocks.  
* Dependencies: Ticket 5.1 and Ticket 7.1.  
* Agent Work:  
  * Implement consent capture.  
  * Implement mutual detection.  
  * Implement reveal messaging guarded by safety.  
* Manual Work:  
  * Approve reveal copy.  
* Acceptance Criteria:  
  * Mutual yes creates one exchange record.  
  * Holds and blocks suppress reveal.

---

# Phase 6: Billing And Entitlements

## Ticket 6.1: Stripe Webhooks And Subscription Snapshot

* Goal: Reliably process Stripe events and maintain subscription snapshot.  
* Scope: Signature validation, idempotent billing events, out-of-order safety.  
* Dependencies: Ticket 1.1.  
* Agent Work:  
  * Implement Stripe webhook endpoint.  
  * Signature validation.  
  * Idempotent processing.  
  * Snapshot mapping safe under out-of-order events.  
  * Create `docs/runbooks/webhooks-stripe.md`.  
* Manual Work:  
  * Configure Stripe webhooks for staging and production.  
  * Set Stripe secrets in Vercel.  
* Acceptance Criteria:  
  * Duplicate events do not double-process.  
  * Snapshot stays correct under replays.

## Ticket 6.2: Entitlements Reconcile And Enforcement

* Goal: Enforce subscription eligibility across key actions.  
* Scope: Entitlements ledger, enforcement hooks across SMS, matching, LinkUps, contact exchange, dashboard.  
* Dependencies: Ticket 6.1.  
* Agent Work:  
  * Implement entitlements ledger.  
  * Implement enforcement.  
  * Implement reconcile job to repair missed events.  
* Manual Work:  
  * Map Stripe Price IDs per environment.  
* Acceptance Criteria:  
  * Paid user allowed; unpaid denied with reason codes.  
  * Grace window behavior correct.

---

# Phase 7: Safety And Admin

## Ticket 7.1: Safety System

* Goal: Detect abuse, create holds, and enforce safety gates.  
* Scope: Keyword detection, incidents, holds, blocks and reports, enforcement hooks.  
* Dependencies: Ticket 3.1 and Ticket 1.1.  
* Agent Work:  
  * Implement incidents and holds.  
  * Enforce holds across messaging, LinkUps, and contact exchange.  
* Manual Work:  
  * Confirm crisis resource message content.  
* Acceptance Criteria:  
  * High severity triggers hold and suppresses product actions.

## Ticket 7.2: Admin Dashboard

* Goal: Admin tooling to monitor and intervene safely.  
* Scope: RBAC, core pages, audit log, safe error states.  
* Dependencies: Ticket 7.1.  
* Agent Work:  
  * Implement admin RBAC.  
  * Implement audit log.  
  * Implement core admin pages.  
* Manual Work:  
  * Create admin users and claims.  
* Acceptance Criteria:  
  * Role restrictions enforced.  
  * All mutations audited.

---

# Phase 8: Website And User Dashboard

## Ticket 8.1: Registration, OTP, Region Entry

* Goal: Users can register, verify OTP, and be routed into onboarding.  
* Scope: Registration capture, OTP verification, consent capture, region gating states.  
* Dependencies: Ticket 4.1.  
* Agent Work:  
  * Implement registration and OTP flow.  
  * Implement region gating entry behavior.  
* Manual Work:  
  * Configure OTP provider settings for staging and production.  
* Acceptance Criteria:  
  * Full flow works in open and closed region cases.

## Ticket 8.2: Dashboard Surfaces

* Goal: Provide user-facing dashboard features that mirror SMS state.  
* Scope: Profile editor, LinkUp views, post-event fallback, contact exchange UI, subscription entry.  
* Dependencies: Ticket 3.2 and Ticket 4.3.  
* Agent Work:  
  * Implement dashboard pages.  
  * Ensure safe error states.  
* Manual Work:  
  * Validate copy.  
* Acceptance Criteria:  
  * Core flows are completable even if SMS is missed.

---

# Phase 9: Observability And Readiness

## Ticket 9.1: Observability Stack

* Goal: Trace user actions end-to-end and debug failures quickly.  
* Scope: Correlation IDs, Sentry instrumentation, structured logs, key metrics.  
* Dependencies: Ticket 2.1.  
* Agent Work:  
  * Add correlation IDs across inbound, processing, outbound.  
  * Add structured logging.  
  * Add Sentry instrumentation.  
* Manual Work:  
  * Create Sentry projects for staging and production; set DSNs.  
* Acceptance Criteria:  
  * Forced error shows in Sentry with context tags.

## Ticket 9.2: Alerts And Operational Dashboards

* Goal: Alert on failures that break user experience.  
* Scope: Alerts for Twilio webhook failures, runner failures, Stripe webhook failures.  
* Dependencies: Ticket 9.1.  
* Agent Work:  
  * Define alert conditions.  
  * Document dashboards.  
* Manual Work:  
  * Configure alert destinations.  
* Acceptance Criteria:  
  * Test alerts fire.

---

# Phase 10: E2E Testing And Go-Live Prep

## Ticket 10.1: Automated E2E Harness And Fixtures

* Goal: Run E2E tests against staging with minimal human input.  
* Scope: Harness for web, API, simulated SMS posts; fixtures for deterministic cohorts.  
* Dependencies: Ticket 8.2 and Ticket 2.4.  
* Agent Work:  
  * Implement E2E harness.  
  * Add seed fixtures for test cohorts.  
  * Add personality regression fixtures.  
  * Integrate into CI where feasible.  
* Manual Work:  
  * Provide 10 to 15 real phone numbers for final manual validation.  
* Acceptance Criteria:  
  * E2E suite passes against staging.

## Ticket 10.2: Manual E2E Runbook, Staging Soak, Production Checklist

* Goal: A repeatable manual run with real phones plus readiness checklist.  
* Scope: Manual runbook, staging soak procedure, go/no-go checklist.  
* Dependencies: Ticket 10.1.  
* Agent Work:  
  * Create `docs/testing/manual-e2e-runbook.md`.  
  * Create `docs/runbooks/staging-soak.md`.  
  * Create `docs/runbooks/production-cutover-and-rollback.md`.  
* Manual Work:  
  * Run staging soak with real phones.  
  * Confirm deliverability and ops readiness.  
* Acceptance Criteria:  
  * No critical errors during soak window.  
  * Runbook and checklist complete.

---

## Definition Of Done

You are production ready when:

* Staging passes automated E2E and manual runbook.  
* Scheduled runner invocations are reliable and visible.  
* Twilio inbound, outbound, and status callbacks are idempotent and retry-safe.  
* Billing and entitlements are correct under replay.  
* Safety holds reliably suppress risky actions.  
* Alerts exist for the most user-impacting failures.  
* Backups and restore steps are written and verified.