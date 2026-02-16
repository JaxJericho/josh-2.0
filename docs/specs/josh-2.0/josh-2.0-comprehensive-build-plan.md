# JOSH 2.0 Comprehensive Build Plan

This document is a complete, end-to-end build plan for a production-ready rebuild of JOSH 2.0.

## Scope, Assumptions, And Decisions

### What We Are Building (MVP)

* LinkUps-only (no 1:1 intro mode in MVP)  
* SMS-first onboarding interview that builds a structured compatibility profile  
* Profile update flow triggered from the dashboard that continues over SMS  
* Region gating \+ waitlist  
* Entitlements \+ billing (Stripe) with admin override for testing  
* Safety system (STOP/HELP precedence, keyword detection, holds, block/report)  
* LinkUp orchestration (candidate selection → invites → quorum lock → coordination → post-event)  
* Admin dashboard (users, messaging, LinkUps, safety, billing, regions)  
* Observability full stack (logs \+ metrics \+ alerting) from day 1

### Environments

* Local: developer machine \+ local tooling  
* Staging: Supabase \+ Twilio staging number (A2P/campaign must be fixed) \+ Vercel staging  
* Production: separate Supabase \+ Twilio production number \+ Vercel production

### Key Calls I’m Making To Unblock The Plan (You Can Flip These Later)

Because some answers were “A/B”, this plan proceeds with explicit defaults:

* Twilio outbound: Messaging Service (default) with ability to fall back to a single number if needed.  
* Staging DB: Rebaseline recommended (fresh schema via migrations) because you do not need to preserve data; we’ll keep the option to “adopt existing” if you prefer.  
* Stripe: Enabled in MVP, but with an admin entitlement override so you can test everything regardless of payment.  
* LLM provider: OpenAI first (fastest path), with abstraction for adding Anthropic later.

### Non-Negotiable Reliability Rules

* Idempotency for all webhooks (Twilio, Stripe) and scheduled runners  
* DB uniqueness constraints for external IDs (Twilio SIDs, Stripe event IDs)  
* State transitions in transactions (LinkUp lock and invite acceptance)  
* Correlation IDs and structured logs everywhere  
* Secrets isolated per environment

## System Architecture

### High-Level Components

1. Web App (Next.js on Vercel)  
   * Marketing site  
   * Member dashboard (PWA)  
   * Admin dashboard (PWA)  
   * API routes for Twilio/Stripe webhooks and cron runners  
2. Data Layer (Supabase)  
   * Postgres schema \+ migrations  
   * RLS where appropriate  
   * Edge Functions optional (we will decide per endpoint; the plan works with Vercel API routes as primary)  
3. Messaging (Twilio)  
   * Inbound webhook → message intake  
   * Outbound send pipeline → Twilio Messaging Service  
   * Status callbacks → delivery receipts  
4. Billing (Stripe)  
   * Checkout \+ portal  
   * Webhooks derive entitlements and subscription state  
5. Scheduler  
   * Vercel Cron → protected runner endpoint  
6. LLM Layer  
   * Deterministic parsing first  
   * LLM fallback for classification/extraction  
   * Strict JSON schemas \+ validators  
7. Observability  
   * Structured logs  
   * Error tracking  
   * Metrics \+ alerts

## Repo Structure

### Target Monorepo Layout

* `apps/web/` — Next.js app (site \+ member dashboard \+ admin)  
* `packages/core/` — shared domain logic (state machines, validators, scoring)  
* `packages/db/` — typed DB client, migrations helpers, SQL utilities  
* `packages/messaging/` — Twilio helpers, idempotency, templates  
* `packages/llm/` — provider abstraction \+ prompt pack \+ JSON validation  
* `supabase/` — migrations \+ seed scripts  
* `docs/` — canonical docs, runbooks, environment contract  
* `scripts/` — doctor, seed, test harnesses

## Build Loop Workflow (How We Execute Tickets)

For each ticket:

1. Create branch `ticket/<id>-<slug>`  
2. Implement  
3. Verify locally (lint/typecheck/tests)  
4. Open PR with checklist (env vars, migrations, dashboards)  
5. Merge when green

## Phase 0 — Foundations And Setup

### Ticket 0.1 — Repo Baseline Quality Gates (Completed)

Goal: Establish repeatable, explicit quality gates for local \+ CI.

Status: Completed and merged.

Implemented:

* `pnpm lint` → `next lint`  
* `pnpm typecheck` → `tsc --noEmit`  
* `pnpm test` → `vitest run`  
* Minimal ESLint config for Next  
* Minimal Vitest config \+ smoke test

Notes:

* ESLint toolchain was pinned for compatibility (ensure versions remain aligned with your Next.js version).  
* Typecheck may depend on Next-generated `.next/types` in some setups; verify `pnpm typecheck` passes from a clean state.

### Ticket 0.2 — Environment Contract \+ Secrets Map

Goal: No guessing. Every environment variable and endpoint is explicit.

Deliverables:

* `docs/runbooks/environment-contract.md`  
* `.env.example` (no secrets)  
* `scripts/doctor.mjs` to validate required env vars and sanity-check endpoints

Verification:

* `pnpm doctor` returns green locally

### Ticket 0.3 — Vercel Provisioning (Staging \+ Production) (Completed)

Goal: Fresh Vercel setup with stable URLs early, so Twilio/Stripe webhooks don’t churn.

Status: Completed.

Confirmed Vercel URLs:

* Staging: `https://josh-2-0-staging.vercel.app`  
* Production: `https://josh-2-0-production.vercel.app`

  ### Ticket 0.4 — Environment Variables Skeleton (Staging \+ Production)

Goal: Standardize env var names and ensure each environment has a complete set.

Status: In progress (staging Supabase vars added).

Staging env vars added (Vercel Project: staging, scope: Production):

* `APP_ENV=staging`  
* `SUPABASE_URL`  
* `SUPABASE_ANON_KEY`  
* `SUPABASE_SERVICE_ROLE_KEY`

  ### Ticket 0.5 — Custom Domain Wiring (Production) (Completed)

Goal: Attach `www.callmejosh.ai` to production and make it the canonical customer URL.

Status: Completed.

### Ticket 0.6 — Doctor Script \+ Preflight Checklist

Goal: A single command that verifies environment variables \+ basic connectivity (without printing secrets).

Deliverables:

* `scripts/doctor.mjs`  
* `docs/runbooks/preflight.md`

Verification:

* `pnpm doctor` passes locally (and fails with a clear error if a required env var is missing)

## Phase 1 — Database Foundation

### Ticket 1.1 — Provision Fresh Supabase Projects (Staging \+ Production)

Goal: Start from zero with clean Supabase projects and a repeatable migration-first workflow.

Manual steps (staging first):

* Create a new Supabase staging project  
* Capture project URL, anon key, service role key  
* Configure database settings required for your stack (extensions, etc.)

Manual steps (production later, after staging E2E is solid):

* Create a new Supabase production project  
* Capture project URL, anon key, service role key

Deliverables:

* `docs/runbooks/supabase-new-project-setup.md`  
* `docs/runbooks/supabase-keys-and-rotation.md`

Verification:

* You can connect with the Supabase client in staging  
* No tables exist yet (fresh baseline)

### Ticket 1.2 — Canonical Schema Migrations (MVP)

Goal: Implement the complete schema needed for MVP.

Schema must include (minimum):

* `profiles` \+ profile attributes \+ preferences  
* `conversation_sessions` \+ step progress  
* `sms_messages` (inbound/outbound metadata)  
* `sms_outbound_jobs` (job queue)  
* `entitlements` (derived) \+ `entitlement_events` (ledger)  
* `regions` \+ `waitlist`  
* `linkups` \+ `linkup_members` \+ `linkup_invites`  
* `safety_incidents` \+ `user_blocks` \+ `keyword_rules`  
* `admin_users` \+ `audit_log`

Deliverables:

* `supabase/migrations/*`  
* Indexes and constraints (uniqueness on external IDs)

Verification:

* Migration apply clean  
* `pnpm db:lint` (if implemented)

### Ticket 1.3 — RLS \+ Roles \+ Admin Access Model

Goal: Secure the DB while keeping admin operations practical.

Approach:

* Member-facing tables protected via RLS  
* Server-side operations use service role  
* Admin dashboard requires admin auth and logs actions

Deliverables:

* RLS policies  
* `admin_users` seeded in staging  
* Audit log triggers/helpers

Verification:

* Member cannot read others’ data via anon key  
* Admin actions produce audit rows

## Phase 2 — Messaging Core (Twilio)

### Ticket 2.1 — Twilio Staging A2P/Campaign Fix Runbook

Goal: Resolve the staging campaign rejection and make staging Twilio functional.

Deliverables:

* `docs/runbooks/twilio-a2p-fix.md` checklist  
* Evidence checklist: brand, use-case description, sample messages, opt-in language, HELP/STOP compliance

Verification:

* Staging number can send outbound successfully

### Ticket 2.2 — Twilio Inbound Webhook (Intake)

Goal: Receive inbound SMS, validate, store, and enqueue.

Endpoint:

* `POST /api/twilio/inbound`

Requirements:

* Validate Twilio signature  
* STOP/HELP precedence routing  
* Idempotent insert keyed by Twilio Message SID  
* Store message metadata; store body encrypted-at-rest

Deliverables:

* Inbound handler \+ tests  
* DB insert function with idempotency

Verification:

* Twilio test webhook succeeds  
* Duplicate webhook does not duplicate rows

### Ticket 2.3 — Outbound Send Pipeline

Goal: All outbound messages are sent via jobs with retries.

Components:

* Job creator: inserts `sms_outbound_jobs`  
* Sender worker: pulls jobs, sends via Twilio, records `sms_messages` outbound row

Deliverables:

* `packages/messaging` send client  
* Job runner logic

Verification:

* Create job → message delivered  
* Retry behavior does not double-send

### Ticket 2.4 — Twilio Status Callback

Goal: Persist delivery outcomes.

Endpoint:

* `POST /api/twilio/status`

Requirements:

* Signature validation  
* Idempotent update keyed by Message SID  
* Update `sms_messages.status` \+ timestamps

Verification:

* Status events update the correct row

## Phase 3 — Scheduler And Runners

### Ticket 3.1 — Vercel Cron Runner (Staging)

Goal: Scheduled outbound runner works end-to-end.

Deliverables:

* Vercel Cron configured  
* Endpoint `/api/cron/outbound-runner` protected by `CRON_SECRET`

Verification:

* Cron triggers and sends queued jobs

### Ticket 3.2 — Backfill/Reconcile Runner

Goal: Handle missed callbacks and reconcile message statuses.

Deliverables:

* Reconcile job that queries recent outbound and ensures status updates

Verification:

* Simulated missing callback is corrected

## Phase 4 — Conversation System (Interview \+ Updates)

### Ticket 4.1 — Conversation Session Model \+ Router

Goal: Deterministic state machine for SMS conversations.

Rules:

* Resume across interruptions  
* One question per message  
* Deterministic parsing first; LLM fallback second

Deliverables:

* Session table usage  
* Router library in `packages/core`

Verification:

* Restart mid-interview resumes correctly

### Ticket 4.2 — Onboarding Interview Implementation

Goal: Implement the MVP interview and persist a structured profile.

Deliverables:

* Step catalog  
* JSON schema validators  
* Profile completeness scoring

Verification:

* New user completes interview  
* Profile stored and marked complete

### Ticket 4.3 — Profile Update Flow Triggered From Dashboard

Goal: Dashboard action starts an SMS flow to update selected fields.

Deliverables:

* Dashboard UI: choose fields to update  
* SMS flow: confirms intent and collects updates

Verification:

* Update selected fields only  
* Audit log entry created

### Ticket 4.4 — Prompt Pack \+ Guardrails

Goal: JOSH voice is consistent and output is safe.

Deliverables:

* Prompt library versioned in repo  
* Output validator (JSON only when expected)  
* Message composer constraints

Verification:

* Golden tests for representative flows

## Phase 5 — Regions \+ Waitlist

### Ticket 5.1 — Region Model \+ Assignment

Goal: Assign region deterministically.

Deliverables:

* Regions table  
* Mapping rules (zip/city) \+ admin tooling

Verification:

* User assigned to correct region

### Ticket 5.2 — Waitlist Operations

Goal: Waitlist capture and activation.

Deliverables:

* Waitlist entries  
* Admin tool to open region and batch notify

Verification:

* Region opens → waitlist batch SMS goes out

## Phase 6 — Billing \+ Entitlements

### Ticket 6.1 — Entitlements Core \+ Admin Override

Goal: One eligibility function, plus admin override for testing.

Deliverables:

* `evaluateEligibility(profile_id)` used everywhere  
* Entitlements derived table  
* Admin override mechanism for your account (staging \+ prod)

Verification:

* Admin can access all features regardless of Stripe

### Ticket 6.2 — Stripe Checkout \+ Webhooks

Goal: Production-safe billing integration.

Deliverables:

* Checkout session  
* Customer portal  
* Webhook handler with signature validation  
* Idempotent event processing

Verification:

* Purchase flow grants entitlements  
* Cancel removes entitlements per policy

## Phase 7 — Matching \+ LinkUps

### Ticket 7.1 — Matching Runs \+ Candidate Scoring

Goal: Deterministic match runs with explainability.

Deliverables:

* `match_runs`, `match_candidates`  
* Scoring implementation (weights versioned)

Verification:

* Match run creates candidate list with scores

### Ticket 7.2 — LinkUp Orchestration State Machine

Goal: Create LinkUps, invite in waves, lock on quorum.

Deliverables:

* LinkUp transitions in transactions  
* Invite reply parsing  
* Replacement wave rules

Verification:

* Quorum locks correctly  
* Duplicate replies are idempotent

### Ticket 7.3 — LinkUp Coordination Messages

Goal: After lock, coordinate time/location details via SMS and dashboard.

Deliverables:

* Coordination flow  
* Dashboard view for LinkUp details

Verification:

* Members see consistent details

## Phase 8 — Post-Event \+ Contact Exchange

### Ticket 8.1 — Post-Event Outcome Collection

Goal: Attendance \+ feedback captured safely.

Deliverables:

* Post-event runner  
* Outcome tables

Verification:

* Responses stored and associated to LinkUp

### Ticket 8.2 — Mutual Contact Exchange

Goal: Only mutual yes reveals contact info, with safety re-check.

Deliverables:

* Mutual consent flow  
* Safety gate before reveal

Verification:

* One-sided yes reveals nothing

## Phase 9 — Safety System

### Ticket 9.1 — STOP/HELP \+ Keyword Rules \+ Holds

Goal: Safety-first routing and auditable holds.

Deliverables:

* STOP/HELP handlers  
* Keyword detection rules  
* Holds prevent invites and contact exchange

Verification:

* Trigger word → hold created

### Ticket 9.2 — Block/Report Flows

Goal: User controls become hard filters and incidents.

Deliverables:

* Block/report commands  
* Admin review queue

Verification:

* Blocked pairs never match

## Phase 10 — Admin Dashboard (PWA)

### Ticket 10.1 — Admin Auth \+ RBAC

Goal: Secure admin access.

Deliverables:

* Admin auth system  
* Role-based access  
* Audit log

Verification:

* Only admins can access admin routes

### Ticket 10.2 — Admin Ops Views

Goal: Operational visibility and controls.

Views:

* Users and profiles  
* Messaging timeline and resend tools  
* LinkUps and state  
* Safety incidents and holds  
* Billing status  
* Regions and waitlist

Verification:

* Can resolve incidents and unblock flows

## Phase 11 — Observability \+ Ops

### Ticket 11.1 — Structured Logging \+ Correlation IDs

Goal: Every request and job is traceable.

Deliverables:

* Correlation ID middleware  
* JSON logs

### Ticket 11.2 — Error Tracking

Goal: Capture exceptions and alert.

Deliverables:

* Error tracking integration  
* Alert routing

### Ticket 11.3 — Metrics \+ Alerting

Goal: Operational metrics and SLO-ish alarms.

Metrics:

* Webhook error rates  
* Outbound job backlog  
* Delivery failure rates  
* Match run health

Deliverables:

* Metrics emitter  
* Dashboards  
* Alerts

## Phase 12 — Testing \+ E2E Harness

### Ticket 12.1 — Twilio Simulator Harness

Goal: Simulate inbound \+ status callbacks for deterministic tests.

Deliverables:

* `scripts/simulate-twilio.mjs`

### Ticket 12.2 — E2E Staging Validation

Goal: A full test script that proves MVP.

Scenarios:

* New user onboarding  
* Profile update  
* Match run \+ LinkUp invite  
* Quorum lock  
* Post-event feedback  
* Contact exchange  
* Safety trigger hold

Deliverables:

* `docs/testing/e2e-staging-checklist.md`

## Phase 13 — Production Provisioning \+ Deployment

### Ticket 13.1 — Production Supabase Provisioning

Goal: New prod project with migrations applied.

Deliverables:

* `docs/runbooks/prod-supabase-setup.md`

### Ticket 13.2 — Production Vercel Setup

Goal: New prod deployment with env vars.

Deliverables:

* `docs/runbooks/prod-vercel-setup.md`

### Ticket 13.3 — Production Twilio Wiring

Goal: Wire prod inbound and status callbacks.

Deliverables:

* `docs/runbooks/prod-twilio-setup.md`

### Ticket 13.4 — Production Stripe Wiring

Goal: Webhooks, products, prices.

Deliverables:

* `docs/runbooks/prod-stripe-setup.md`

### Ticket 13.5 — Launch Checklist \+ Cutover

Goal: Safe launch with monitoring.

Checklist:

* Run migrations  
* Confirm webhooks  
* Smoke test flows  
* Open first region  
* Monitor dashboards

Deliverables:

* `docs/runbooks/launch-checklist.md`

## Appendix — Admin Testing Access Clarification

You said you need to test everything as admin. In this plan:

* Your admin account has an override entitlement that grants full access regardless of Stripe status.  
* Everyone else is governed by Stripe-derived entitlements.

## Appendix — Fresh DB Notes (You Chose Full Reset)

You decided to delete all prior DBs and start completely fresh. This plan now assumes:

* Staging Supabase is a brand-new project with zero legacy tables.  
* All schema is created exclusively through migrations committed in the repo.  
* Production Supabase is created after staging passes E2E.

Operational rule:

* If a schema change is needed, it is always expressed as a migration (never “click ops” in the dashboard as the source of truth).