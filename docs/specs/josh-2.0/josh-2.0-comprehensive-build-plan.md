# JOSH 2.0 Comprehensive Build Plan

## **Purpose**

This is a ticket-based build plan for JOSH 2.0 that starts with local \+ account/CLI setup and ends with E2E testing on staging, ready for production deployment. It is optimized for stability and minimal rework by sequencing “foundations first” (schema/contracts/queues) before UI and polish.

Key constraints:

* Not time-bound. Task/ticket-bound.  
* QStash is the job runner.  
* Cursor should handle as much of the coding/docs/migrations as possible.  
* You will complete manual steps that require dashboards, secrets, and external service configuration.  
* Before commit/merge, you run a verification checklist including any manual steps required for that ticket.  
* JOSH “personality” is a first-class build deliverable (prompt library \+ response constraints \+ guardrails), not a vibe you bolt on later.

---

## **A. Repo Layout To Support Build \+ Ops**

Create a predictable place for specs, runbooks, prompts, and test harnesses so Cursor can “find the truth” quickly.

### **Recommended Folder Tree (Add To Repo)**

```
.
├─ apps/
│  ├─ web/                        # Next.js app (public site + dashboard + admin)
│  └─ api/                        # (Optional) if you split API from web; otherwise keep in web
├─ packages/
│  ├─ shared/                     # shared types, utils, domain logic
│  ├─ db/                         # db helpers, migrations helpers, generated types
│  ├─ messaging/                  # Twilio templates + helpers
│  └─ ai/                         # LLM client, prompt library, output validators, eval harness
├─ prompts/
│  ├─ josh/                        # prompt source files (versioned, human-readable)
│  └─ README.md                    # what prompts exist + how to change safely
├─ supabase/
│  ├─ migrations/                  # canonical migrations (tracked)
│  ├─ seed/                        # seed scripts + fixtures
│  └─ config.toml
├─ docs/
│  ├─ specs/josh-2.0/              # exported buildable specs (Docs 01–15 + Personality)
│  ├─ setup/                       # CLI + environment setup
│  ├─ runbooks/                    # ops playbooks: region activation, incidents, billing, etc.
│  ├─ testing/                     # E2E plan + manual testing checklist
│  └─ architecture/                # diagrams, ADRs, integration contracts
├─ scripts/
│  ├─ dev/                         # local helpers (reset db, seed, gen types)
│  ├─ staging/                     # guarded scripts for staging (seed, reconcile)
│  └─ ops/                         # safe operational scripts (rebuild derived state)
├─ .cursor/
│  ├─ rules/                       # Cursor Rules (.mdc) - scoped instructions
│  └─ snippets/                    # (Optional) reusable prompt snippets
├─ .vscode/
│  ├─ settings.json
│  ├─ extensions.json
│  ├─ tasks.json
│  └─ launch.json
├─ .github/
│  ├─ pull_request_template.md
│  └─ copilot-instructions.md      # optional; keep aligned with Cursor Rules
├─ .editorconfig
├─ .cursorignore
├─ .env.example
├─ README.md
└─ SECURITY.md
```

Notes:

* If your repo is already monorepo/non-monorepo, keep your structure—just ensure these directories exist somewhere consistent.  
* `/docs/specs/josh-2.0/` is the single source of truth for the system build.  
* `/prompts/` is the single source of truth for the JOSH personality prompt text. Code consumes prompts from here (or compiles them at build time).

---

## **B. VS Code \+ Cursor Context And Consistency System**

This section answers: “What files should I create to optimize context & memory, write consistent code across all tickets, and get the most out of Cursor?”

### **1\) Cursor Rules (Project Instructions)**

Create scoped rule files in:

* `.cursor/rules/*.mdc`

Recommended rule files:

* `.cursor/rules/00-project-overview.mdc`  
  * One-paragraph product summary  
  * Tech stack \+ key integrations  
  * Environments: local/staging/prod separation rules  
  * “Source of truth” pointers (docs/specs/josh-2.0)  
* `.cursor/rules/01-build-loop-workflow.mdc`  
  * Build Loop (plan → implement → verify → commit/PR → merge)  
  * One-ticket-per-PR, branch naming conventions  
  * “Stop and ask” rules  
* `.cursor/rules/02-database-and-migrations.mdc`  
  * Migration rules \+ naming  
  * “No schema drift”: regenerate types after migrations  
  * RLS defaults and service-role usage  
* `.cursor/rules/03-queues-and-idempotency.mdc`  
  * Job runner: QStash  
  * Idempotency key patterns  
  * Retry safety rules  
* `.cursor/rules/04-api-contracts-and-validation.mdc`  
  * Request validation patterns  
  * Error envelope conventions  
  * Observability tagging requirements  
* `.cursor/rules/05-style-and-consistency.mdc`  
  * Formatting (Prettier), lint rules  
  * File naming conventions  
  * Logging conventions  
* `.cursor/rules/06-llm-personality-and-prompts.mdc`  
  * Prompts must be versioned and referenced by ID  
  * Output constraints (SMS length, one question, no therapy talk, no “AI-speak”)  
  * Safety overrides (STOP/HELP \+ crisis)  
  * Never leak contact/PII in SMS  
  * Prompt change checklist (evals \+ fixtures)

Keep these rules directive and high signal.

### **2\) Cursor Ignore**

Create:

* `.cursorignore`

Use it to exclude:

* secrets files and local env files  
* build artifacts  
* huge vendor folders  
* logs  
* any directory where random untrusted content lands (downloads, exports)

### **3\) VS Code Workspace And Editor Consistency**

Create:

* `.vscode/settings.json`  
  * format on save  
  * ESLint integration  
  * TypeScript SDK: workspace  
  * search excludes aligned to `.cursorignore`  
* `.vscode/extensions.json`  
  * recommend ESLint, Prettier, SQL tooling, Sentry, etc.  
* `.vscode/tasks.json`  
  * tasks: lint, typecheck, test, build, gen types, reset+seed local  
* `.vscode/launch.json`  
  * debug configs for Next.js server \+ API routes

Optional but useful:

* `josh.code-workspace`  
  * multi-folder setups (apps/web \+ packages \+ docs)

### **4\) Standard Code Style And “One True Way” Files**

* `.editorconfig`  
* `.prettierrc` (or `prettier.config.js`)  
* `.eslintrc.*`  
* `tsconfig.json` and `tsconfig.base.json` (if monorepo)  
* `package.json` scripts for lint/typecheck/test/build

### **5\) AI Instruction Files For VS Code Ecosystem**

If you also use GitHub Copilot-style instruction loading, add:

* `.github/copilot-instructions.md`

Keep it aligned with your Cursor Rules.

### **6\) Context Index Files (The Big Win)**

Create short “index” docs that act like table-of-contents for Cursor:

* `docs/README.md`  
* `docs/specs/josh-2.0/README.md`  
* `docs/runbooks/README.md`  
* `docs/testing/README.md`  
* `prompts/README.md` (lists prompt IDs, owners, and safe-change procedure)

### **7\) Security And Prompt Injection Guardrails**

Add:

* `SECURITY.md`  
  * no secrets in repo  
  * key rotation playbook  
  * suspicious file/PR handling

Ensure `.cursorignore` excludes any directory where untrusted content lands.

---

## **C. Ticket Plan (Setup → E2E Ready For Production)**

Each ticket includes: Cursor work, your manual work, and a pre-commit verification checklist. Prompts for Cursor should instruct it to: implement the ticket, summarize deliverables, list your manual tasks (env vars, dashboards, migrations), then provide PR title \+ summary.

### **Phase 0: Foundations And Tooling**

#### **Ticket 0.1: Repository Baseline And PR Workflow**

Cursor does

* Add PR template checklist (migrations, env vars, verification commands).  
* Add minimal docs structure (docs/setup, docs/runbooks, docs/testing).

You do (manual)

* Confirm GitHub branch protections and required CI checks.

Verify before merge

* `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

---

#### **Ticket 0.2: CLI Setup And Environment Linking**

Cursor does

* Write `/docs/setup/cli.md` with exact commands.  
* Add `.env.example` with all required keys (no secrets).

You do (manual)

* Login/link:  
  * Supabase CLI: link staging \+ prod  
  * Vercel CLI: link staging \+ prod  
  * Stripe CLI (for webhook testing)  
  * Twilio console access confirmed  
  * QStash account/project created

Verify before merge

* `supabase status` runs  
* Local dev boots with placeholder env

---

### **Phase 1: Database Baseline**

#### **Ticket 1.1: Schema Migrations (Docs 03, 08–13)**

Cursor does

* Implement migrations for canonical schema \+ indexes \+ unique idempotency constraints.  
* Add scripts: `db:reset`, `db:migrate`, `db:gen-types`.

You do (manual)

* Apply migrations to staging.

Verify before merge

* Fresh local DB migrate succeeds  
* `db:gen-types` then `pnpm build`

---

#### **Ticket 1.2: RLS And Access Patterns**

Cursor does

* Implement deny-by-default RLS with user-owned access and admin/service-role access patterns.

You do (manual)

* Set service role secrets in Vercel staging/prod.

Verify before merge

* User can only access their own rows  
* Admin routes blocked without admin auth

---

#### **Ticket 1.3: Seed \+ Synthetic Test Data**

Cursor does

* Seed scripts and fixtures for regions, users, profiles, LinkUps.

You do (manual)

* Run seed once on staging.

Verify before merge

* Seeded data visible in dashboard and admin

---

### **Phase 2: Messaging Core**

#### **Ticket 2.1: Twilio Inbound Webhook (Router Entry)**

Cursor does

* Signature validation, message persistence, strict idempotency, STOP/HELP precedence.

You do (manual)

* Configure Twilio Messaging Service webhooks for staging.

Verify before merge

* Replay same MessageSid → no duplicate processing  
* STOP immediately opts out

---

#### **Ticket 2.2: Outbound Jobs \+ Status Callbacks**

Cursor does

* Outbound job runner \+ retries \+ idempotency keys \+ status tracking.

You do (manual)

* Configure Twilio status callback URLs.

Verify before merge

* Same outbound idempotency\_key sends once  
* Failures retry and settle

---

### **Phase 3: Conversation Router \+ Interview \+ Personality**

#### **Ticket 3.1: Intent Routing Contract (Doc 04\)**

Cursor does

* Local parsers, LLM classifier fallback, one-clarifier rule.

You do (manual)

* Add LLM provider keys in staging.

Verify before merge

* Deterministic routing for representative messages

---

#### **Ticket 3.2: Interview \+ Signal Extraction (Doc 06\)**

Cursor does

* Step catalog \+ extractor contract \+ persistence mapping \+ resume behavior.

You do (manual)

* Confirm onboarding copy if needed.

Verify before merge

* Full interview creates complete profile  
* Partial resumes correctly

---

#### **Ticket 3.3: JOSH Personality Prompt Library \+ Output Guardrails (Personality & Reasoning spec)**

This is the “conversation engine” layer: the tone rules, question style, and response constraints that shape every user-facing SMS beyond simple intent routing.

Cursor does

* Add `packages/ai/` prompt runtime:  
  * Prompt registry (prompt IDs, versions, templates)  
  * Prompt rendering helpers (inject user profile \+ short history)  
  * Output validators/normalizers:  
    * SMS length cap (configurable; default \~220 chars)  
    * Exactly one question (or a bounded choice list)  
    * No “AI-speak” phrases (configurable deny-list)  
    * No therapy/dating-app framing  
    * No contact sharing in SMS (hard block)  
* Add prompt sources under `prompts/josh/` (versioned):  
  * Conversation management prompt  
  * “Follow-up question” prompt (one question, energy-following)  
  * “Clarifier message” prompt (max one clarifier)  
  * (Optional) “Summarize progress” internal prompt used only for storage/debug  
* Add lightweight evaluation harness (no fancy infra):  
  * `scripts/dev/eval-personality.ts` runs curated fixture conversations  
  * Asserts outputs meet constraints (length, question count, banned phrases)  
* Wire the personality layer into the SMS response path(s):  
  * Interview messages (when using LLM text)  
  * Post-event prompts  
  * General “chatty” support responses (non-HELP)

You do (manual)

* Pick the initial model \+ temperature/routing defaults per environment (documented values; set env vars).  
* Review and approve the initial prompt text in `prompts/josh/` (this is “product copy,” treat like UX).

Verify before merge

* Eval harness passes on fixtures  
* Real SMS simulation outputs are:  
  * short  
  * one question  
  * aligned tone  
  * never contain contact or unsafe content

Notes

* This ticket should not change compatibility scoring/matching logic.  
* Prefer code-level versioning for MVP (prompt files \+ hash), rather than storing prompts in DB.

---

### **Phase 4: Matching And LinkUps**

#### **Ticket 4.1: Matching Engine (Doc 09\) \+ Explainability**

Cursor does

* Filters, scoring, tie-breakers, match\_runs storage, deterministic output.

You do (manual)

* Ensure staging has enough seeded users.

Verify before merge

* Same run\_key → same results  
* Blocks/holds exclude candidates

---

#### **Ticket 4.2: LinkUp Orchestration (Doc 07\) \+ Scheduling**

Cursor does

* create\_key idempotency, invite waves, lock transaction, reminders.  
* Schedule via QStash.

You do (manual)

* Create QStash topics and set env vars for staging/prod.

Verify before merge

* Duplicate create doesn’t duplicate LinkUp  
* Lock happens once  
* Reminders schedule correctly

---

### **Phase 5: Post-Event And Contact Exchange**

#### **Ticket 5.1: Post-Event Outcome Capture (Doc 08\)**

Cursor does

* Post-event prompts, parsing, persistence, QStash scheduling.

You do (manual)

* Confirm QStash is delivering jobs to staging endpoints.

Verify before merge

* Simulated past event triggers prompts  
* Replies are idempotent under retries

---

#### **Ticket 5.2: Mutual Consent Contact Exchange (Doc 08\)**

Cursor does

* Choices upsert, mutual detection, reveal messaging guarded by safety/blocks.

You do (manual)

* Review reveal template copy.

Verify before merge

* Mutual yes creates one exchange row  
* Holds/blocks suppress reveal

---

### **Phase 6: Billing And Entitlements**

#### **Ticket 6.1: Stripe Webhooks \+ Subscription Snapshot**

Cursor does

* Signature validation, idempotent billing\_events, snapshot mapping.

You do (manual)

* Configure Stripe webhooks for staging/prod.  
* Set Stripe secrets in Vercel.

Verify before merge

* Duplicate event doesn’t double process  
* Snapshot stays correct with out-of-order events

---

#### **Ticket 6.2: Entitlements Reconcile \+ Enforcement (Doc 11\)**

Cursor does

* entitlements table \+ ledger \+ reconcile job.  
* evaluateEligibility enforced at SMS, matching, LinkUps, contact exchange, dashboard.

You do (manual)

* Confirm Stripe Price IDs mapped per env.

Verify before merge

* Paid user allowed; unpaid denied with reason code  
* Grace window behavior correct

---

### **Phase 7: Safety \+ Admin**

#### **Ticket 7.1: Safety System (Doc 13\)**

Cursor does

* Keyword detection, incidents, holds, blocks/reports, enforcement hooks.

You do (manual)

* Confirm crisis resource message content.

Verify before merge

* High severity triggers hold and suppresses product actions

---

#### **Ticket 7.2: Admin Dashboard (Doc 14\)**

Cursor does

* RBAC, core pages, audit log, safe error states.

You do (manual)

* Create admin users/claims.

Verify before merge

* Role restrictions enforced  
* All mutations audited

---

### **Phase 8: Website \+ User Dashboard**

#### **Ticket 8.1: Registration \+ OTP \+ Region Gating (Doc 15\)**

Cursor does

* Public site, registration, OTP verification, gating states.

You do (manual)

* Configure OTP provider settings for staging/prod.

Verify before merge

* Full flow works in open and closed region cases

---

#### **Ticket 8.2: Dashboard Surfaces (Doc 15\)**

Cursor does

* Profile editor, LinkUps views, post-event fallback, contact exchange UI, subscription entry.

You do (manual)

* Validate copy.

Verify before merge

* Every core flow completable even if SMS missed

---

### **Phase 9: Observability \+ Readiness**

#### **Ticket 9.1: Observability Stack (Doc 05\)**

Cursor does

* Correlation IDs everywhere, Sentry instrumentation, structured logs, key metrics.

You do (manual)

* Create Sentry projects for staging/prod and set DSNs.

Verify before merge

* Forced error shows in Sentry with context tags

---

### **Phase 10: E2E Testing And Go-Live Prep**

#### **Ticket 10.1: Automated E2E Harness \+ Fixtures**

Cursor does

* E2E harness (web \+ API \+ simulated SMS webhook posts).  
* Seed fixtures for predictable test cohorts.  
* Add “personality regression” fixtures (outputs must meet constraints).

You do (manual)

* Provide 10–15 real phone numbers for final manual validation.

Verify before merge

* E2E suite passes in CI against staging

---

#### **Ticket 10.2: Manual E2E Runbook \+ Production Readiness Checklist**

Cursor does

* Manual E2E runbook with real-phone steps.  
* Go/no-go checklist: env diff, webhook endpoints, QStash topics, region activation.

You do (manual)

* Run staging soak with real phones.  
* Confirm deliverability and ops readiness.

Verify before production deploy

* No critical errors in Sentry for soak window  
* Runbook \+ checklist fully complete

---

## **D. QStash Setup Checklist (Manual)**

For any ticket that schedules jobs, you will:

* Create required QStash topics  
* Add env vars for each environment  
* Verify delivery to staging endpoint  
* Ensure each job has:  
  * stable `idempotency_key`  
  * retry-safe handler  
  * correlation ID logging

---

## **E. Does The Schema Need To Change For Personality?**

For MVP, you can ship personality without any schema changes by keeping prompts in `prompts/` and logging prompt versions via:

* structured logs \+ Sentry tags (prompt\_id, prompt\_version\_hash)  
* existing domain event/audit mechanisms

Only add schema if you want any of these MVP+ features:

* Admin-editable prompt text  
* A/B prompt experiments stored server-side  
* Long-term prompt performance analytics by version

If you want that later, add a small table pair:

* `llm_prompt_versions` (id, prompt\_id, version, hash, created\_at)  
* `llm_call_traces` (id, prompt\_version\_id, model, tokens, latency\_ms, outcome, created\_at, plus encrypted payload fields)

Keep it out of the critical path for launch unless you truly need it.