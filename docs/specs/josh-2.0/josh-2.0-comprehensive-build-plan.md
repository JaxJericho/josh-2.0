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

- [x] ### ~~Ticket 0.1 — Repo Baseline Quality Gates (Completed)~~

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

### 

- [x] ### ~~Ticket 0.2 — Environment Contract \+ Secrets Map~~

Goal: No guessing. Every environment variable and endpoint is explicit.

Deliverables:

* `docs/runbooks/environment-contract.md`  
* `.env.example` (no secrets)  
* `scripts/doctor.mjs` to validate required env vars and sanity-check endpoints

Verification:

* `pnpm doctor` returns green locally

### 

- [x] ### ~~Ticket 0.3 — Vercel Provisioning (Staging \+ Production) (Completed)~~

Goal: Fresh Vercel setup with stable URLs early, so Twilio/Stripe webhooks don’t churn.

Status: Completed.

Confirmed Vercel URLs:

* Staging: `https://josh-2-0-staging.vercel.app`  
* Production: `https://josh-2-0-production.vercel.app`

  ### 

- [x] ### ~~Ticket 0.4 — Environment Variables Skeleton (Staging \+ Production)~~

Goal: Standardize env var names and ensure each environment has a complete set.

Status: In progress (staging Supabase vars added).

Staging env vars added (Vercel Project: staging, scope: Production):

* `APP_ENV=staging`  
* `SUPABASE_URL`  
* `SUPABASE_ANON_KEY`  
* `SUPABASE_SERVICE_ROLE_KEY`

- [x] ### ~~Ticket 0.5 — Custom Domain Wiring (Production) (Completed)~~

Goal: Attach `www.callmejosh.ai` to production and make it the canonical customer URL.

Status: Completed.

- [x] ### ~~Ticket 0.6 — Doctor Script \+ Preflight Checklist~~

Goal: A single command that verifies environment variables \+ basic connectivity (without printing secrets).

Deliverables:

* `scripts/doctor.mjs`  
* `docs/runbooks/preflight.md`

Verification:

* `pnpm doctor` passes locally (and fails with a clear error if a required env var is missing)

## Phase 1 — Database Foundation

- [ ] ### Ticket 1.1 — Provision Fresh Supabase Projects (Staging \+ Production)

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

### 

- [x] ### ~~Ticket 1.2 — Canonical Schema Migrations (MVP)~~

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

### 

- [x] ### ~~Ticket 1.3 — RLS \+ Roles \+ Admin Access Model~~

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

- [x] ### ~~Ticket 2.1 — Twilio Staging A2P/Campaign Fix Runbook~~

Goal: Resolve the staging campaign rejection and make staging Twilio functional.

Deliverables:

* `docs/runbooks/twilio-a2p-fix.md` checklist  
* Evidence checklist: brand, use-case description, sample messages, opt-in language, HELP/STOP compliance

Verification:

* Staging number can send outbound successfully

### 

- [x] ### ~~Ticket 2.2 — Twilio Inbound Webhook (Intake)~~

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

### 

- [x] ### ~~Ticket 2.3 — Outbound Send Pipeline~~

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

### 

- [x] ### ~~Ticket 2.4 — Twilio Status Callback~~

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

- [x] ### ~~Ticket 3.1 — Vercel Cron Runner (Staging)~~

Goal: Scheduled outbound runner works end-to-end.

Deliverables:

* Vercel Cron configured  
* Endpoint `/api/cron/outbound-runner` protected by `CRON_SECRET`

Verification:

* Cron triggers and sends queued jobs

### 

- [x] ### ~~Ticket 3.2 — Backfill/Reconcile Runner~~

Goal: Handle missed callbacks and reconcile message statuses.

Deliverables:

* Reconcile job that queries recent outbound and ensures status updates

Verification:

* Simulated missing callback is corrected

## Phase 4 — Conversation System (Interview \+ Updates)

- [x] ### ~~Ticket 4.1 — Conversation Session Model \+ Router~~

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

### 

- [x] ### ~~Ticket 4.2 — Onboarding Interview Implementation~~

Goal: Implement the MVP interview and persist a structured profile.

Deliverables:

* Step catalog  
* JSON schema validators  
* Profile completeness scoring

Verification:

* New user completes interview  
* Profile stored and marked complete

### 

- [ ] ### Ticket 4.3 — Profile Update Flow Triggered From Dashboard

Goal: Dashboard action starts an SMS flow to update selected fields.

Deliverables:

* Dashboard UI: choose fields to update  
* SMS flow: confirms intent and collects updates

Verification:

* Update selected fields only  
* Audit log entry created

### 

- [ ] ### Ticket 4.4 — Prompt Pack \+ Guardrails

Goal: JOSH voice is consistent and output is safe.

Deliverables:

* Prompt library versioned in repo  
* Output validator (JSON only when expected)  
* Message composer constraints

Verification:

* Golden tests for representative flows

- [ ] Ticket 4.5 — Compatibility Pipeline E2E Proof

Goal: Compatibility pipeline is deterministic, idempotent, and verifiable end-to-end in staging.

* Deliverables:  
* Deterministic staging seed script (non-migration)  
* E2E runner script for signals → scoring → persistence  
* Runbook documenting exact verification commands  
* Idempotency proof via replay

Verification:

* CLI seed \+ run twice  
* SQL row count unchanged on replay  
* Score \+ version verified in DB  
* All merge gates pass

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

## Phase 8 — SMS Conversation Redesign (Onboarding \+ Interview)

This phase replaces the existing hardcoded onboarding entry message and fixed-step interview with a two-part system: a verbatim onboarding sequence delivered with human-like timing, and a signal-aware, LLM-driven conversational interview that adapts to each user.

The existing infrastructure (inbound webhook, outbound pipeline, state machines, profile storage, signal extraction contracts) is unchanged. This phase operates exclusively on the conversation layer sitting on top of that infrastructure.

The original Phase 8 (Post-Event \+ Contact Exchange) and all subsequent phases shift forward by one.

---

### Ticket 8.1 — Deprecate intro\_01 \+ Onboarding State Tokens

Goal: Remove intro\_01 from the active interview flow and introduce the onboarding state tokens needed to support the new entry sequence.

Background:

The existing interview begins at intro\_01, which asks the user if they are ready to start. This function is now handled by the onboarding sequence designed in this phase. intro\_01 must be deprecated so it is never sent to users.

Requirements:

* Mark intro\_01 as deprecated in the step catalog (packages/core/src/interview/steps.ts) with a comment and a runtime guard that skips it and advances to activity\_01 if a session state token resolves to interview:intro\_01  
* Add the following new state tokens to the conversation session state machine:  
  * onboarding:awaiting\_opening\_response  
  * onboarding:awaiting\_explanation\_response  
  * onboarding:awaiting\_interview\_start  
* Update fromInterviewStateToken() and the router in conversation-router.ts to handle all three new tokens  
* Update the DB default and validation regex to accept the onboarding: prefix  
* Update docs/specs/josh-2.0/profile-interview-and-signal-extraction-spec.md:  
  * Mark intro\_01 as deprecated in the step catalog section  
  * Add a note that the onboarding sequence (Conversation Behavior Spec) replaces its function  
  * All technical contracts in the spec remain unchanged

Deliverables:

* Updated packages/core/src/interview/steps.ts (intro\_01 deprecated, runtime guard added)  
* Updated packages/core/src/interview/state.ts (new token handling)  
* Updated conversation-router.ts (new onboarding state routing)  
* Updated supabase/migrations (state token validation, if applicable)  
* Updated docs/specs/josh-2.0/profile-interview-and-signal-extraction-spec.md

---

### Ticket 8.2 — Onboarding Sequence: Verbatim Message Constants

Goal: Define all onboarding message content as versioned, verbatim string constants in a single canonical location.

Background:

All onboarding messages are static and verbatim. They must never be dynamically generated. They are defined once, referenced by name throughout the codebase, and updated only through deliberate version changes to this file.

Message constants to implement (exact content below):

ONBOARDING\_OPENING: "Call me JOSH. Nice to meet you, {firstName}. You're off the waitlist — time to find your people.\\n\\nQuick heads up: a profile photo is required before I can lock in your first LinkUp. You can add it anytime through your dashboard — now or later both work. Just know it needs to be there before any plan gets confirmed. Sound good?"

ONBOARDING\_EXPLANATION: "Perfect. I'll walk you through how this works — a few short messages, back to back. You only need to reply to this one and the last one. Ready?"

ONBOARDING\_MESSAGE\_1: "My full government name is Journey of Shared Hope, but JOSH fits better as a contact name in your phone. I exist because making real friends as an adult is genuinely hard — schedules are full, social circles are set, and even when you put yourself out there it rarely turns into anything. That shouldn't be the default."

ONBOARDING\_MESSAGE\_2: "Here's how I work. No complicated setup — just you and me in an ongoing conversation. I don't just learn what you like — I learn what it means to you. Why you like it, how it makes you feel, what a good version of it looks like. That's what actually makes the difference when I'm putting people together."

ONBOARDING\_MESSAGE\_3: "Plans here are called LinkUps. You can start one whenever you feel like doing something — I'll find compatible people and build it around something that fits your style. And if someone else starts a plan that suits you, I'll bring you in. Either way, it's a small group of people worth meeting. Just a good reason to be in the same place as people you're likely to click with."

ONBOARDING\_MESSAGE\_4: "That's the idea. Ready to get started?"

ONBOARDING\_LATER: "No problem. Reply Yes whenever you're ready and we'll pick up here."

Requirements:

* Create packages/core/src/onboarding/messages.ts containing all constants above  
* Constants are typed as readonly strings  
* firstName interpolation uses a simple template helper, not dynamic generation  
* Export a version identifier (ONBOARDING\_MESSAGES\_VERSION) for audit and debugging  
* No other file may hardcode any of these strings; all references use the named exports

Deliverables:

* packages/core/src/onboarding/messages.ts

Verification:

* TypeScript compilation passes with no implicit any  
* All string constants match the approved content exactly (character-for-character)  
* A unit test asserts that ONBOARDING\_MESSAGES\_VERSION is present and non-empty

---

### Ticket 8.3 — Onboarding Sequence: In-Process Sequential Delivery

Goal: Implement the onboarding message delivery function that sends the back-to-back burst (Messages 1, 2, 3, 4\) with an 8-second delay between each message, mimicking natural human typing and sending behavior.

Background:

The existing interview reply mechanism uses synchronous TwiML responses — one message per inbound SMS. The onboarding burst requires sending multiple messages without waiting for a reply. This cannot use TwiML responses or the Vercel Cron outbound runner.

The solution is in-process sequential delivery within a single edge function execution: send a message via Twilio REST API, await an 8-second delay, send the next message. Total execution time is approximately 24 seconds, well within Vercel limits.

Delivery sequence:

Step 1 (triggered by waitlist activation): Send ONBOARDING\_OPENING via Twilio REST API Set state\_token: onboarding:awaiting\_opening\_response Await inbound reply

Step 2 (triggered by user reply to opening): Interpret intent broadly — any positive, neutral, or ambiguous reply advances the flow Only an explicit "Later" or "No" pauses and sends ONBOARDING\_LATER Send ONBOARDING\_EXPLANATION via Twilio REST API Set state\_token: onboarding:awaiting\_explanation\_response Await inbound reply

Step 3 (triggered by user reply to explanation): Interpret intent broadly — any positive, neutral, or ambiguous reply advances the flow Send ONBOARDING\_MESSAGE\_1 via Twilio REST API Await 8 seconds Send ONBOARDING\_MESSAGE\_2 via Twilio REST API Await 8 seconds Send ONBOARDING\_MESSAGE\_3 via Twilio REST API Send ONBOARDING\_MESSAGE\_4 via Twilio REST API (no delay before this) Set state\_token: onboarding:awaiting\_interview\_start Await inbound reply

Step 4 (triggered by user reply to Message 4): Interpret intent broadly Set mode: interviewing, state\_token: interview:activity\_01 Hand off to interview engine

Requirements:

* Create packages/core/src/onboarding/onboarding-engine.ts  
* Implement sendOnboardingBurst() using Twilio REST API client (not TwiML)  
* Use await new Promise(resolve \=\> setTimeout(resolve, 8000)) for delays  
* All outbound sends must write to sms\_messages (outbound) for audit, keyed by Twilio MessageSid — idempotency rule applies  
* Intent interpretation for onboarding replies uses broad positive/negative detection (no LLM required): any reply not matching a "no/later/stop" token advances the flow  
* "Later" or "No" at any point in the onboarding sets state\_token: onboarding:awaiting\_opening\_response and sends ONBOARDING\_LATER (does not spam; reminder rules from the interview dropout spec apply)  
* All state transitions write domain events to the audit log

Deliverables:

* packages/core/src/onboarding/onboarding-engine.ts  
* Updated conversation-router.ts (routes onboarding state tokens to onboarding engine)  
* Updated supabase/functions/twilio-inbound/index.ts (hooks onboarding trigger)  
* Updated waitlist-operations.ts (fires onboarding trigger on region activation)  
* Unit tests for intent detection (positive/negative/later paths)  
* Integration test: full onboarding burst fires in correct sequence with correct delays

Verification:

* New user activated from waitlist receives ONBOARDING\_OPENING as first SMS  
* User replies "yes" → receives ONBOARDING\_EXPLANATION  
* User replies "yes" → receives Messages 1, 2, 3, 4 with \~8 second gaps between 1/2/3  
* Message 4 arrives immediately after Message 3 (no delay)  
* User replies "yes" → session transitions to mode: interviewing, state\_token: interview:activity\_01  
* User replies "later" at any point → receives ONBOARDING\_LATER, flow pauses  
* Duplicate Twilio SID on any outbound does not double-send  
* All sends are recorded in sms\_messages

---

### Ticket 8.4 — LLM Interview Engine: Signal Coverage Tracker

Goal: Replace the sequential array-based step progression with a signal coverage tracker that drives adaptive question selection based on which compatibility signals have been captured with sufficient confidence.

Background:

The existing interview advances through a fixed array of step IDs in order. This must be replaced with a system that knows what signals are still missing and selects the most appropriate question to fill those gaps — allowing the interview to be shorter for users who give rich answers and more thorough for users who give sparse ones.

Signal coverage targets (all must reach complete\_mvp threshold):

* At least 8 of 12 fingerprint factors with confidence \>= 0.55  
* At least 3 activity patterns with confidence \>= 0.60  
* Group size preference captured  
* Time preference captured  
* Boundaries asked (can be empty)

Requirements:

* Create packages/core/src/interview/signal-coverage.ts  
* Implement getSignalCoverageStatus(profile) → returns:  
  * covered: string\[\] (factor keys at or above threshold)  
  * uncovered: string\[\] (factor keys below threshold or missing)  
  * mvpComplete: boolean  
  * nextSignalTarget: string | null (highest-priority uncovered signal)  
* Implement selectNextQuestion(profile, conversationHistory) → returns the most contextually appropriate question for the next uncovered signal  
* Question selection must consider what has already been said — if a user mentioned skydiving and rafting, adventure\_comfort and novelty\_seeking can be inferred without asking; selectNextQuestion must not ask for signals already inferable from context  
* Maintain stable question IDs (activity\_01, motive\_01, etc.) for DB writes and audit — the question ID written to the DB represents the signal target, not a fixed prompt  
* The existing profile-writer.ts step ID branches must be refactored to map signal targets to extraction logic rather than hardcoded step ID strings  
* Update buildInterviewTransitionPlan() in state.ts to use selectNextQuestion() instead of nextInterviewQuestionStep()

Deliverables:

* packages/core/src/interview/signal-coverage.ts  
* Updated packages/core/src/interview/state.ts  
* Refactored packages/core/src/profile/profile-writer.ts (signal-target mapping)  
* Unit tests: coverage status for empty, partial, and complete\_mvp profiles  
* Unit tests: selectNextQuestion skips already-covered signals

---

### Ticket 8.5 — LLM Interview Engine: Adaptive Conversation \+ Inference

Goal: Wire the LLM into the interview flow for signal extraction and cross-signal inference, replacing the current deterministic regex parsers.

Background:

Signal extraction is currently deterministic regex/pattern matching. The LLM was specced but never implemented. This ticket implements LLM-based extraction that:

* Extracts structured signals from free-form user answers  
* Infers signals from context (e.g. "I go skydiving every summer" → high adventure\_comfort, high novelty\_seeking, inferred without a direct question)  
* Returns valid JSON matching the InterviewExtractOutput schema  
* Feeds extracted signals into the signal coverage tracker from Ticket 8.4

Requirements:

* Create packages/llm/src/interview-extractor.ts  
* Implement extractInterviewSignals(input: InterviewExtractInput): Promise\<InterviewExtractOutput\>  
* System prompt must instruct the LLM to:  
  * Return only valid JSON matching the InterviewExtractOutput schema  
  * Extract signals from the user's answer to the current question  
  * Infer additional signals from anything said earlier in the conversation  
  * Never swing any single fingerprint factor strongly from one message  
  * Leave fields empty rather than guessing when confidence is low  
  * Flag needsFollowUp only when a motive weight is too flat (no motive \>= 0.55) or a mismatch risk is high — not for every ambiguous answer  
* LLM provider must use the abstraction layer in packages/llm/ (not called directly)  
* All LLM calls must have a timeout (5 seconds) and retry once on transient failure  
* If LLM fails after retry, fall back to the existing regex parser for that step and log the failure with correlation ID  
* JSON schema validation must run on every LLM response before it is applied to the profile — invalid responses are discarded and fallback is used  
* Rate limiting: maximum 1 LLM extraction call per inbound message per user

Deliverables:

* packages/llm/src/interview-extractor.ts  
* packages/llm/src/prompts/interview-extraction-system-prompt.ts (versioned)  
* Updated packages/core/src/interview/state.ts (calls LLM extractor instead of regex parsers)  
* JSON schema validator for InterviewExtractOutput  
* Unit tests: valid extraction, invalid JSON fallback, timeout fallback  
* Golden tests: representative user answers produce expected signal patches

Verification:

* "I love skydiving and white water rafting" → extracts adventure\_comfort \>= 0.75, novelty\_seeking \>= 0.70 with confidence \>= 0.60  
* "Coffee with new friends sounds like a calm reset" → extracts restorative and connection motive weights, quiet/indoor constraints  
* LLM timeout → fallback regex runs → interview continues without error  
* Invalid LLM JSON → fallback regex runs → interview continues without error  
* Profile is never updated with unvalidated LLM output

---

### Ticket 8.6 — Interview Completion \+ Dropout Recovery

Goal: Implement the interview wrap message (interview → active transition) and the dropout recovery flow (nudge \+ resume).

Background:

The existing wrap message is a hardcoded string: "Got it. That's enough to start matching. You can update anything anytime by texting me." This must be replaced with an approved message that sets expectations for LinkUps and reinforces what was captured. The dropout recovery flow exists in the spec but was never implemented with defined message content.

Wrap message (verbatim, sent when mvpComplete \= true):

INTERVIEW\_WRAP: "That's everything. Your profile is set. I now have a real sense of your style — the kinds of plans you'd enjoy, how you like to connect, and what a good match looks like for you. Whenever you're ready to do something, just text me naturally. Something like 'I’m free Saturday morning' or 'I want to go skiing this weekend' and I'll take it from there."

Dropout recovery messages (verbatim):

INTERVIEW\_DROPOUT\_NUDGE (sent once at 24 hours of inactivity, not before): "Hey {firstName} — you were mid-way through your JOSH profile. No pressure, but whenever you want to pick back up, just reply anything and we'll continue from where you left off."

INTERVIEW\_DROPOUT\_RESUME (sent when user replies after dropout): "Welcome back. Picking up from where we left off." \[followed immediately by the next uncovered signal question\]

Requirements:

* Add INTERVIEW\_WRAP, INTERVIEW\_DROPOUT\_NUDGE, INTERVIEW\_DROPOUT\_RESUME to packages/core/src/onboarding/messages.ts (or a new packages/core/src/interview/messages.ts — keep onboarding and interview constants in separate files)  
* Update buildInterviewTransitionPlan() to send INTERVIEW\_WRAP when mvpComplete \= true  
* Implement dropout detection: if conversation\_sessions.updated\_at is more than 24 hours ago and mode \= interviewing, enqueue INTERVIEW\_DROPOUT\_NUDGE via sms\_outbound\_jobs  
* Dropout nudge must fire exactly once per dropout event — track with a dropout\_nudge\_sent\_at timestamp on conversation\_sessions  
* On user reply after dropout: send INTERVIEW\_DROPOUT\_RESUME, then immediately call selectNextQuestion() and send the next question  
* Resume reads state\_token to find the exact uncovered signal — no re-asking of completed steps  
* Dropout nudge respects STOP opt-out state

Deliverables:

* packages/core/src/interview/messages.ts (interview message constants)  
* Updated packages/core/src/interview/state.ts (wrap transition, dropout resume)  
* Updated supabase/functions/\_shared/engines/profile-interview-engine.ts  
* Dropout detection runner (cron job or scheduled function)  
* Unit tests: wrap fires only when mvpComplete \= true  
* Unit tests: dropout nudge fires once, not twice  
* Unit tests: resume advances to correct next question

Verification:

* User completes all required signals → receives INTERVIEW\_WRAP → session mode: idle, profile state: complete\_mvp  
* User goes quiet for 24 hours mid-interview → receives INTERVIEW\_DROPOUT\_NUDGE exactly once  
* User replies after dropout → receives INTERVIEW\_DROPOUT\_RESUME \+ next question  
* Resume does not re-ask questions whose signals are already above threshold  
* Wrap is never sent before mvpComplete \= true

---

### Ticket 8.7 — Prompt Pack \+ Guardrails

Goal: Consolidate all LLM system prompts, message constants, and output validators into a versioned prompt pack with enforced guardrails. Establish golden tests that prove JOSH voice is consistent and output is safe across all conversation flows.

Requirements:

* Create docs/conversation/conversation-behavior-spec.md — the governing document for JOSH's conversation layer, referenced by the interview engine. This document defines:  
  * JOSH's voice principles (warm, direct, never clinical, adult friend register)  
  * One-question-per-message rule  
  * Max one clarifier rule  
  * Acknowledgment guidance (dynamic, sparse, never evaluative)  
  * Gear-shift transition behavior (natural topic changes, not phase counters)  
  * Signal inference rules (cross-signal reasoning from context)  
  * Prohibited language patterns (no jargon, no therapy framing, no guarantees, no personality scoring language, no feature-explaining)  
* All LLM system prompts must reference the voice principles in this document  
* Create packages/llm/src/output-validator.ts:  
  * Validates all LLM JSON responses against their expected schema before use  
  * Detects and rejects responses containing prohibited patterns  
  * Logs violations with correlation ID  
* Prompt versioning: each system prompt exports a PROMPT\_VERSION string logged with every LLM call for debugging and regression detection  
* Golden tests covering:  
  * Onboarding: correct message sequence and timing  
  * Interview: a rich-answer user reaches mvpComplete in fewer steps than a sparse-answer user  
  * Interview: prohibited language patterns never appear in JOSH outbound messages  
  * Inference: stated activities produce correct inferred fingerprint signals  
  * Clarifier: fires at most once per ambiguous answer  
  * Wrap: fires only on mvpComplete, content matches verbatim constant

Deliverables:

* docs/conversation/conversation-behavior-spec.md  
* packages/llm/src/output-validator.ts  
* Updated packages/llm/src/prompts/ (all prompts versioned)  
* tests/conversation/golden-tests.ts

Verification:

* pnpm test passes all golden tests  
* A simulated interview with rich answers reaches complete\_mvp in 6–8 exchanges  
* A simulated interview with sparse answers reaches complete\_mvp in 10–13 exchanges  
* No outbound message in any test contains prohibited language  
* Output validator rejects malformed or schema-invalid LLM responses

## 

## Build Plan Introduction Update

The following decisions supersede the original key calls in the build plan introduction:

* LLM provider: Anthropic (Claude 3.5 Haiku via packages/llm/src/provider.ts). The original plan said "OpenAI first" — this is incorrect and has been corrected throughout.  
* Phase 8 is now SMS Conversation Redesign (onboarding sequence \+ adaptive LLM-driven interview). The original Phase 8 (Post-Event \+ Contact Exchange) shifts to Phase 10\.  
* A new Phase 9 (Foundational Packages) is inserted before Post-Event to create packages/db/ and packages/messaging/, which all subsequent phases depend on.  
* All phases after Phase 8 are renumbered accordingly.

---

## Phase 9 — Foundational Packages

The build plan's repo structure specifies packages/db/ and packages/messaging/ as canonical shared packages. Neither was created during Phases 0–7. DB access currently happens via direct Supabase client calls scattered across edge functions. Twilio sends happen via inline REST API calls in the onboarding engine. This phase creates both packages properly so all subsequent phases can depend on clean, typed, tested abstractions instead of duplicating logic.

---

### Ticket 9.1 — packages/db/: Typed DB Client And Migrations Helpers

Goal: Create a typed, tested database client package that wraps the Supabase client and consolidates all DB access patterns used across the codebase.

Background:

Direct Supabase client calls are currently scattered across supabase/functions/\_shared/ and packages/core/. This creates duplication, inconsistent error handling, and no single place to enforce RLS-aware query patterns. packages/db/ becomes the only place that imports the Supabase client directly. All other packages import from packages/db/.

Requirements:

* Create packages/db/ with the following structure:  
  * src/client.ts — Supabase client factory (service role \+ anon variants)  
  * src/queries/ — one file per domain entity (users.ts, profiles.ts, conversation-sessions.ts, sms-messages.ts, sms-outbound-jobs.ts, linkups.ts, invites.ts, safety.ts, regions.ts, learning.ts)  
  * src/migrations/ — migration helpers and schema version utilities  
  * src/types.ts — re-exports of all generated Supabase types  
  * src/index.ts — barrel export  
* Each query file must:  
  * Export typed query functions (not raw Supabase queries)  
  * Handle errors uniformly — throw a typed DbError with context  
  * Never expose raw Supabase client outside the package  
  * Include JSDoc for all exported functions  
* Migrate all existing direct Supabase calls in edge functions to use packages/db/ query functions — no direct supabase client imports should remain outside this package  
* Add packages/db/ to the monorepo workspace in package.json/pnpm-workspace.yaml  
* TypeScript strict mode enabled  
* All query functions must have unit tests with Supabase mock

Deliverables:

* packages/db/ (full package as described above)  
* Updated imports in supabase/functions/\_shared/ (all direct Supabase calls replaced)  
* Updated imports in packages/core/ (all direct Supabase calls replaced)  
* Unit tests for all query functions

Verification:

* pnpm typecheck passes with no errors in packages/db/  
* pnpm test passes all packages/db/ unit tests  
* grep \-r "createClient" \--include="\*.ts" . returns results only within packages/db/  
* A query function called with invalid input throws a typed DbError, not an unhandled Supabase error

---

### Ticket 9.2 — packages/messaging/: Twilio Helpers And Message Templates

Goal: Create a typed, tested messaging package that wraps the Twilio REST API client, enforces idempotency, and centralizes all system-generated SMS templates.

Background:

Twilio REST API calls currently live inline in the onboarding engine. The outbound job runner has its own Twilio client instantiation. Message templates are scattered across steps.ts, messages.ts, and inline strings. packages/messaging/ becomes the single source of truth for all outbound SMS behavior. No other package calls Twilio directly.

Requirements:

* Create packages/messaging/ with the following structure:  
  * src/client.ts — Twilio REST API client factory  
  * src/sender.ts — send function with idempotency enforcement  
  * src/templates/ — one file per message category:  
    * onboarding.ts (imports from packages/core/src/onboarding/messages.ts)  
    * interview.ts (interview wrap, dropout nudge, dropout resume)  
    * linkup.ts (invite, lock confirmation, reminder, coordination)  
    * post-event.ts (attendance, do-again, feedback, contact exchange)  
    * safety.ts (crisis resources, hold notification, block confirmation)  
    * system.ts (OTP, help response, unknown intent response)  
  * src/types.ts — SendSmsRequest, SendSmsResult, MessageTemplate types  
  * src/index.ts — barrel export  
* sender.ts must:  
  * Accept a correlationId and purpose field on every send  
  * Write to sms\_messages (outbound) before sending (not after)  
  * Enforce idempotency: if a row with the same idempotency\_key exists and has a Twilio SID, do not send again — return the existing result  
  * Record the Twilio MessageSid after send  
  * Retry once on transient Twilio failures (5xx, network timeout)  
  * Never retry on 4xx (bad request, invalid number) — log and fail  
* All message template functions must:  
  * Accept typed parameters (no untyped string interpolation)  
  * Return a string ready to send (no further formatting needed)  
  * Be tested with snapshot tests to catch accidental content changes  
* Migrate all existing Twilio calls in the codebase to use packages/messaging/sender  
* Add packages/messaging/ to the monorepo workspace  
* TypeScript strict mode enabled

Deliverables:

* packages/messaging/ (full package as described above)  
* Updated imports in supabase/functions/\_shared/engines/ (all Twilio calls replaced)  
* Updated imports in packages/core/src/onboarding/onboarding-engine.ts  
* Snapshot tests for all message templates  
* Unit tests for sender idempotency behavior

Verification:

* grep \-r "twilio" \--include="\*.ts" \-i . returns results only within packages/messaging/ and packages/core/src/onboarding/messages.ts (constants only, no client calls)  
* Sending the same message twice with the same idempotency\_key results in one Twilio API call and one sms\_messages row  
* A Twilio 5xx on first attempt is retried once; a 4xx is not retried  
* pnpm test passes all packages/messaging/ tests including snapshot tests

---

## Phase 10 — Post-Event \+ Contact Exchange

This phase implements the post-event SMS flow that follows every completed LinkUp: attendance collection, do-again preference, feedback, and mutual contact exchange. All SMS interactions in this phase use the conversation engine and delivery patterns established in Phase 8\. This phase depends on Phase 9 (packages/db/ and packages/messaging/) being complete.

Dependencies: Phase 8 (conversation engine, session modes, delivery pattern), Phase 9 (packages/db/, packages/messaging/), Phase 11 (Safety — contact exchange reveal must check safety holds and blocks).

---

### Ticket 10.1 — Post-Event Session Mode \+ Conversation Router Integration

Goal: Register the post\_event session mode with the conversation router and define the state token format for all post-event conversation steps.

Background:

The conversation router established in Phase 8 handles session modes (onboarding, interviewing, idle, linkup\_forming, awaiting\_invite\_reply). Post-event flows send multi-step SMS sequences to participants after a LinkUp completes. These flows need their own session mode so the router directs inbound replies to the post-event engine rather than the interview engine or the LinkUp handler. This ticket establishes the infrastructure before any post-event messages are sent.

Requirements:

* Add post\_event to the conversation\_mode enum in:  
  * supabase/migrations (new migration adding post\_event to the enum)  
  * packages/core/src/interview/state.ts (mode type union)  
  * conversation-router.ts (route post\_event mode to post-event engine)  
* Define and register the following state tokens:  
  * post\_event:attendance — awaiting attendance confirmation  
  * post\_event:do\_again — awaiting do-again preference  
  * post\_event:feedback — awaiting optional feedback  
  * post\_event:contact\_intro — contact exchange intro sent, awaiting reply  
  * post\_event:contact\_choices — collecting per-participant contact choices  
* Create supabase/functions/\_shared/engines/post-event-engine.ts (scaffold only — message handling implemented in Tickets 10.2 and 10.3)  
* Update fromInterviewStateToken() in state.ts (or create a parallel fromSessionStateToken() function) to handle the post\_event: prefix  
* Update the DB state\_token validation regex to accept the post\_event: prefix  
* Add a dropout\_nudge\_sent\_at column to conversation\_sessions if not already present (used for post-event dropout tracking alongside interview dropout)  
* Safety hold check: if a user's session mode is post\_event and a safety hold is applied, the post-event engine must suspend the flow — add this check to the post-event engine scaffold  
* STOP/HELP precedence continues to bypass the post-event engine exactly as it bypasses all other engines — no changes needed, confirm in verification

Deliverables:

* supabase/migrations/YYYYMMDD\_add\_post\_event\_session\_mode.sql  
* Updated packages/core/src/interview/state.ts (or new state utility)  
* Updated conversation-router.ts  
* Scaffolded supabase/functions/\_shared/engines/post-event-engine.ts  
* Unit tests: post\_event:attendance token routes to post-event engine  
* Unit tests: STOP mid-post-event flow bypasses engine correctly

Verification:

* A conversation session with mode=post\_event and state\_token=post\_event:attendance routes to the post-event engine, not the interview engine  
* STOP received during post\_event mode is handled by STOP precedence handler and does not reach the post-event engine  
* Migration applies cleanly on a fresh staging DB  
* pnpm typecheck passes with no errors after mode addition

---

### Ticket 10.2 — Post-Event Runner \+ Attendance Collection

Goal: Implement the cron-based runner that detects LinkUps eligible for post-event follow-up and initiates the attendance collection SMS flow.

Background:

After a LinkUp's event\_time has passed (plus a 2-hour buffer), JOSH reaches out to all participants to confirm attendance. This is triggered by a scheduled runner that scans for locked LinkUps past their event window, not by a user action. The runner must be idempotent — if it runs multiple times, it must not send duplicate messages.

Requirements:

* Create supabase/functions/post-event-runner/index.ts (Vercel Cron or Supabase scheduled function — match the pattern used by the existing outbound runner)  
* Runner logic:  
  * Query linkups where state=locked AND event\_time \+ 2 hours \<= now() AND post\_event\_initiated\_at IS NULL  
  * For each eligible LinkUp, set post\_event\_initiated\_at \= now() atomically (use a DB transaction with a check to prevent double-initiation)  
  * For each participant in the LinkUp (linkup\_members), send the attendance message via packages/messaging/  
  * Set each participant's conversation\_sessions.mode \= post\_event  
  * Set each participant's conversation\_sessions.state\_token \= post\_event:attendance  
  * Write a post\_event\_events row for each initiation (idempotency key: post\_event:{linkup\_id}:{user\_id})  
* Add post\_event\_initiated\_at timestamptz to linkups table (new migration)  
* Add post\_event\_events table to track per-participant post-event step completion:  
  * id, linkup\_id, user\_id, step (attendance/do\_again/feedback/contact\_intro/ contact\_choices), response, responded\_at, created\_at  
* Attendance message content (verbatim, from packages/messaging/templates/post-event.ts): "Hey {firstName} — hope {activityName} went well. Did you make it? Reply Yes or No."  
* Response handling in post-event-engine.ts:  
  * Yes → record attendance=true in post\_event\_events, advance to do\_again step, set state\_token=post\_event:do\_again, send do\_again message (Ticket 10.3)  
  * No → record attendance=false, set mode=idle, state\_token=idle (no further post-event prompts for non-attenders)  
  * No response after 24 hours → record attendance=unknown, set mode=idle (runner handles this via a separate pass — do not spam)  
* Idempotency: runner must not re-initiate for a LinkUp that already has post\_event\_initiated\_at set — atomic update with WHERE post\_event\_initiated\_at IS NULL  
* Log event: post\_event.runner\_scan (count of eligible linkups, count initiated)  
* Log event: post\_event.attendance\_sent (linkup\_id, user\_id, correlation\_id)

Deliverables:

* supabase/migrations/YYYYMMDD\_add\_post\_event\_tables.sql (post\_event\_initiated\_at, post\_event\_events)  
* supabase/functions/post-event-runner/index.ts  
* Updated supabase/functions/\_shared/engines/post-event-engine.ts (attendance handler)  
* packages/messaging/templates/post-event.ts (attendance message template)  
* Unit tests: runner skips already-initiated LinkUps  
* Unit tests: attendance Yes advances to do\_again, No sets idle  
* Integration test: runner finds eligible LinkUp, sends attendance message, sets correct session state

Verification:

* A locked LinkUp with event\_time 3 hours ago and post\_event\_initiated\_at=null is picked up by the runner and initiates the post-event flow for all participants  
* A locked LinkUp with event\_time 3 hours ago and post\_event\_initiated\_at set is skipped by the runner (idempotency confirmed)  
* User replies Yes → post\_event\_events row has attendance=true, session advances to post\_event:do\_again  
* User replies No → post\_event\_events row has attendance=false, session returns to idle, no further post-event messages are sent  
* STOP received during attendance step → flow suspended, no further sends

---

### Ticket 10.3 — Do-Again \+ Feedback Collection \+ Learning Signal Write

Goal: Implement the do-again preference and optional feedback collection steps, and wire post-event outcomes into the learning signal pipeline.

Background:

After a participant confirms attendance, JOSH asks two more things: whether they would want to hang out with these people again, and optionally what would have made it better. The do-again signal is the most valuable learning input the system collects. Responses must be written to the learning system tables so matching can improve over time. Users who go quiet mid-post-event flow need a single dropout nudge after 24 hours.

Requirements:

* Do-again message content (verbatim): "Glad you made it. Would you want to hang out with this group again? Reply A) Yes, B) Maybe, C) Probably not."  
* Do-again response handling:  
  * A (Yes) → record do\_again=yes, advance to feedback step  
  * B (Maybe) → record do\_again=maybe, advance to feedback step  
  * C (Probably not) → record do\_again=no, advance to feedback step  
  * Unrecognized reply → one clarifier: "Just reply A, B, or C." — if still unrecognized, store do\_again=unknown and advance to feedback  
* Feedback message content (verbatim): "Anything that would have made it better? Reply or just skip this one."  
* Feedback response handling:  
  * Any text reply → store in post\_event\_events.response for this step, advance to contact\_intro step (Ticket 10.4)  
  * "Skip" or equivalent → store feedback=skipped, advance to contact\_intro step  
  * No response after 48 hours → store feedback=no\_response, advance to contact\_intro step (do not block contact exchange on missing feedback)  
* Dropout recovery for do\_again and feedback steps:  
  * If state\_token is post\_event:do\_again or post\_event:feedback and updated\_at \> 24 hours ago, send one nudge: "Still there, {firstName}? No pressure — just reply when you can."  
  * Track with dropout\_nudge\_sent\_at on conversation\_sessions  
  * Send nudge at most once per post-event flow per user  
* Learning signal writes (after do\_again response collected):  
  * Write to learning\_signals table:  
    * signal\_type: do\_again\_pulse  
    * user\_id: participant  
    * linkup\_id: the LinkUp  
    * value: yes=1.0 / maybe=0.5 / no=0.0 / unknown=null  
    * created\_at: now()  
  * Write to learning\_signals table for each pairing in the group:  
    * signal\_type: pair\_do\_again  
    * user\_id: participant  
    * counterpart\_user\_id: each other participant  
    * value: same as above  
    * created\_at: now()  
  * Do NOT update fingerprint factors directly from a single do\_again signal — learning signal writes are inputs to the learning system, not direct profile updates (the learning system processes them separately)  
* Log event: post\_event.do\_again\_collected (linkup\_id, user\_id, value)  
* Log event: post\_event.feedback\_collected (linkup\_id, user\_id, has\_text)  
* Log event: post\_event.learning\_signal\_written (signal\_type, linkup\_id, user\_id)

Deliverables:

* Updated supabase/functions/\_shared/engines/post-event-engine.ts (do\_again and feedback handlers)  
* packages/messaging/templates/post-event.ts updated (do\_again, feedback, nudge message templates)  
* Learning signal write function in packages/db/src/queries/learning.ts  
* Unit tests: do\_again A/B/C mapping, clarifier on unrecognized reply  
* Unit tests: feedback skip handling  
* Unit tests: learning signal written with correct value per do\_again response  
* Unit tests: dropout nudge fires once, not twice

Verification:

* User replies A to do\_again → post\_event\_events row has do\_again=yes, learning\_signals row created with value=1.0, session advances to post\_event:feedback  
* User goes quiet after do\_again message for 25 hours → receives one nudge  
* User goes quiet for another 25 hours after nudge → no second nudge sent  
* Two users in same LinkUp who both said Yes to do\_again → two pair\_do\_again learning signal rows created (one per direction)

---

### Ticket 10.4 — Mutual Contact Exchange

Goal: Implement contact exchange choice collection, mutual detection, reveal messaging with safety gate, and dashboard UI for exchange status.

Background:

After feedback is collected, JOSH gives participants the option to share their phone number with any or all other participants in the LinkUp. Exchange is mutual: if both A and B say yes to each other, both receive the other's number. A one-sided yes reveals nothing. Users can change their choice before reveal. The safety system must be checked at reveal time — a block or hold applied between the LinkUp and reveal suppresses the exchange.

Requirements:

* Contact intro message content (verbatim): "Want to stay in touch with anyone from {activityName}? You can share your number with anyone who shares theirs back. Reply Yes to share with everyone, No to keep private, or name someone specific."  
* Contact intro response handling:  
  * Yes (or all) → mark choice=yes for all other participants  
  * No → mark choice=no for all participants, set mode=idle  
  * Name or partial name match → mark choice=yes for matched participant(s) only, send one clarifier if match is ambiguous: "Did you mean {Name}? Reply Yes or No."  
  * No response after 7 days → mark choice=no\_response, treat as no for all  
* Choice collection:  
  * Write to contact\_exchange\_choices table:  
    * (chooser\_user\_id, target\_user\_id, linkup\_id, choice, chosen\_at)  
  * Allow choice to be updated (yes → no) before reveal — update existing row, do not create duplicate  
  * Reveal triggers immediately when both directions have a yes choice (do not wait for the 7-day window if both have already chosen)  
* Mutual detection (atomic):  
  * On every choice write, check if the reverse direction also has choice=yes  
  * If mutual: create a contact\_exchanges row atomically (idempotency key: exchange:{user\_a\_id}:{user\_b\_id}:{linkup\_id} where user\_a\_id \< user\_b\_id lexicographically to prevent duplicates)  
  * If exchange row already exists: do not re-send reveal (idempotency)  
* Safety gate at reveal time:  
  * Before sending reveal message, check:  
    * user\_blocks: is either user blocking the other?  
    * safety\_holds: does either user have an active hard\_hold?  
  * If either check is true: suppress reveal, do not create exchange row, log safety.contact\_exchange\_suppressed  
* Reveal message content (verbatim, sent to each party): "Good news — {OtherFirstName} wants to stay in touch too. Here's their number: {phoneE164Formatted}. Reply STOP anytime."  
* Dashboard UI (member-facing):  
  * Show contact exchange status per LinkUp: pending / mutual / not exchanged  
  * Allow user to update their choice (yes/no) from the dashboard within the 7-day window  
  * Endpoint: GET /api/member/linkups/{id}/contact-exchange  
  * Endpoint: PATCH /api/member/linkups/{id}/contact-exchange  
* Idempotency: reveal message must not be sent twice for the same exchange — enforce via exchange row existence check before send  
* Log event: post\_event.contact\_choice\_recorded (linkup\_id, chooser, choice)  
* Log event: post\_event.mutual\_detected (linkup\_id, user\_a, user\_b)  
* Log event: post\_event.reveal\_sent (linkup\_id, user\_a, user\_b)  
* Log event: safety.contact\_exchange\_suppressed (linkup\_id, user\_a, user\_b, reason)

Deliverables:

* contact\_exchange\_choices and contact\_exchanges tables confirmed in schema (add migration if not present)  
* Updated supabase/functions/\_shared/engines/post-event-engine.ts (contact intro and choice handlers)  
* Mutual detection function in packages/db/src/queries/contact-exchange.ts  
* packages/messaging/templates/post-event.ts updated (contact intro, reveal templates)  
* apps/web/app/api/member/linkups/\[id\]/contact-exchange/route.ts (GET \+ PATCH)  
* Member dashboard page updated to show contact exchange status per LinkUp  
* Unit tests: mutual detection fires on second yes, not on first  
* Unit tests: safety block suppresses reveal  
* Unit tests: choice update (yes → no) before reveal prevents exchange  
* Unit tests: idempotency — two mutual detections do not double-send reveal

Verification:

* User A says yes, User B has not replied → no reveal sent  
* User B says yes → reveal sent to both A and B, exchange row created  
* Exchange runner called again for same pair → no second reveal sent  
* User A says yes, User B says yes, but A has a safety hold → reveal suppressed, no exchange row created  
* User A says yes, then changes to no before B replies → when B says yes, no reveal sent  
* Contact exchange status page loads for member and shows correct state

---

## Phase 11 — Safety System

This phase implements the keyword detection, rate limiting, strike escalation, and crisis routing that were not completed in earlier phases. STOP/HELP handling is already implemented in twilio-inbound/index.ts and is NOT reimplemented here. All safety intercepts run in the inbound pipeline before the conversation router, matching the existing precedence pattern.

---

### Ticket 11.1 — Keyword Detection, Rate Limiting, And Crisis Routing

Goal: Implement versioned keyword detection with severity classification, per-user rate limiting, strike accumulation with escalation, and crisis routing with region-appropriate resources.

Background:

The safety tables exist (safety\_incidents, safety\_holds, user\_blocks, user\_reports, user\_strikes). The inbound handler already checks for STOP/HELP. What is missing is everything between "message received" and "STOP/HELP matched": the keyword scanner that detects harmful content, the rate limiter that catches abuse patterns, the logic that escalates strikes into holds, and the crisis handler that responds to self-harm signals. These must run in the twilio-inbound handler before the conversation router is called, matching the existing safety precedence pattern.

Requirements:

* Create packages/core/src/safety/keyword-detector.ts:  
  * Accepts normalized message text  
  * Loads keyword rules from keyword\_rules table (cached per process, TTL 5 minutes)  
  * Returns: { matched: boolean, category: string | null, severity: string | null }  
  * Categories: crisis, harassment, abuse, hate\_speech, spam, self\_harm  
  * Severity levels: low, medium, high, critical  
  * Matching: normalized text (lowercase, collapsed whitespace, stripped punctuation) against bounded keyword list — no regex injection risk  
  * keyword\_rules table must support admin-updatable rules without code deploy: columns: id, keyword, category, severity, active, created\_at, updated\_at  
* Create packages/core/src/safety/rate-limiter.ts:  
  * Per-user inbound rate limit: max 10 messages per minute  
  * Per-user LinkUp initiation rate limit: max 3 per day  
  * Uses a sliding window counter in the DB (or Supabase pg\_stat if available)  
  * Returns: { exceeded: boolean, limit\_type: string | null }  
* Create packages/core/src/safety/strike-escalator.ts:  
  * On safety\_incident creation, compute total active strikes for user  
  * Strike thresholds (from Doc 13):  
    * 1–2 strikes: warning message only, no hold  
    * 3 strikes: soft\_hold applied (duration: 7 days)  
    * 4+ strikes: hard\_hold applied (requires admin removal)  
  * Strikes decay after 90 days (set expires\_at on user\_strikes rows)  
  * Hold application must be idempotent (key: hold:{user\_id}:{hold\_type}:{reason\_code})  
* Crisis routing handler in supabase/functions/twilio-inbound/index.ts:  
  * If keyword\_detector returns category=crisis or category=self\_harm:  
    * Create safety\_incident with severity=critical  
    * Apply soft\_hold immediately (do not wait for strike count)  
    * Send crisis response message (do NOT route to conversation engine)  
    * Crisis message content (verbatim): "I'm concerned about you. If you're in crisis, please reach out to the 988 Suicide and Crisis Lifeline by calling or texting 988\. They're available 24/7. You can also text HOME to 741741 for the Crisis Text Line."  
    * Log event: safety.crisis\_detected (user\_id, correlation\_id)  
    * Do not log message body — log only that a crisis keyword was matched  
* Integrate keyword detection and rate limiting into twilio-inbound/index.ts:  
  * Run after STOP/HELP check, before conversation router  
  * If rate limit exceeded: send "You're sending messages faster than I can keep up. Try again in a minute." — do not route to conversation engine  
  * If keyword matched (non-crisis): create incident, apply strike escalation, send appropriate response per severity, then decide whether to continue routing based on hold state  
* Safety must interrupt Phase 8 conversation flows:  
  * If a user receives a hard\_hold during onboarding or interview, the conversation engine must check hold state before sending the next message  
  * Add a safety hold gate to onboarding-engine.ts and post-event-engine.ts: before sending any outbound, call getActiveHold(userId) — if hard\_hold exists, suppress send and log safety.outbound\_suppressed  
* Admin-updatable keyword list: keyword\_rules table already in schema — confirm it exists, add migration if missing, seed with initial keyword set covering the 6 categories above

Deliverables:

* packages/core/src/safety/keyword-detector.ts  
* packages/core/src/safety/rate-limiter.ts  
* packages/core/src/safety/strike-escalator.ts  
* Updated supabase/functions/twilio-inbound/index.ts (keyword \+ rate limit integration, crisis handler)  
* Updated packages/core/src/onboarding/onboarding-engine.ts (hold gate)  
* Updated supabase/functions/\_shared/engines/post-event-engine.ts (hold gate)  
* supabase/migrations/YYYYMMDD\_keyword\_rules\_seed.sql (initial keyword list)  
* Unit tests: keyword detection matches correctly, misses on non-keywords  
* Unit tests: rate limiter returns exceeded after threshold  
* Unit tests: strike escalator applies correct hold at 3 and 4+ strikes  
* Unit tests: crisis handler sends correct message and does not route further

Verification:

* Message containing a crisis keyword → crisis message sent, no conversation engine routing, soft\_hold applied, safety\_incident row created  
* User sends 11 messages in one minute → 11th message gets rate limit response, no conversation engine routing  
* User accumulates 3 strikes → soft\_hold applied, can receive messages but cannot initiate LinkUps  
* User accumulates 4 strikes → hard\_hold applied, receives restricted messaging response only  
* User on hard\_hold mid-interview → next outbound message from interview engine is suppressed, outbound\_suppressed event logged  
* keyword\_rules table row added via Supabase dashboard → detected in next keyword scan (within 5-minute cache TTL)

---

### Ticket 11.2 — Block And Report Flows

Goal: Implement SMS-triggered block and report commands, guided report reason collection, incident creation from reports, and admin review queue.

Background:

Block and report tables exist (user\_blocks, user\_reports) and block exclusion is enforced in matching. What is missing is the ability for a user to trigger a block or report via SMS, the guided flow to collect a report reason, incident creation, and admin visibility into reports.

Requirements:

* Add BLOCK and REPORT to the intent taxonomy in conversation-router.ts:  
  * BLOCK intent: detected when message matches "block", "block \[name\]", "i want to block \[name\]" — local parse before LLM  
  * REPORT intent: detected when message matches "report", "report \[name\]", "i want to report \[name\]" — local parse before LLM  
* Target identification logic:  
  * If a name or partial name is in the command, attempt to match against the user's most recent LinkUp participants  
  * If match is ambiguous or missing: send one clarifier — "Who would you like to block/report? Reply with their name or 'last group' for your most recent LinkUp group."  
  * If still unclear after one clarifier: ask user to contact support  
* Block flow:  
  * Create user\_blocks row (blocker\_user\_id, blocked\_user\_id, created\_at)  
  * Confirmation message (verbatim): "Done. {Name} won't be included in any future plans with you."  
  * Block is immediate — no hold applied to the blocked user from this action alone  
* Report flow:  
  * Send reason category prompt: "What's this about? Reply A) Inappropriate behavior, B) Made me uncomfortable, C) No-show or canceled last minute, D) Other."  
  * Collect reason (one clarifier if unrecognized, then proceed with Other)  
  * Create user\_reports row and safety\_incident row  
  * Apply strike to reported user (low severity, severity=low)  
  * Confirmation message (verbatim): "Got it. We'll look into it. Thanks for letting us know."  
  * Admin review queue: safety\_incidents filtered by source=user\_report, status=open — visible in admin dashboard (Ticket 12.2)  
* If user tries to block/report someone they have never been in a LinkUp with:  
  * Response: "I can only help you block or report someone from a past LinkUp. If you need other help, text HELP."  
* Log event: safety.block\_created (blocker, blocked, correlation\_id)  
* Log event: safety.report\_created (reporter, reported, reason, correlation\_id)

Deliverables:

* Updated conversation-router.ts (BLOCK and REPORT intent handling)  
* handleBlock() and handleReport() handler functions in the router handler registry  
* packages/messaging/templates/safety.ts (block confirmation, report prompts, report confirmation)  
* Unit tests: BLOCK/REPORT intent detection, target matching, clarifier logic  
* Unit tests: report creates safety\_incident \+ strike on reported user  
* Unit tests: block excludes from future match candidates

Verification:

* User texts "block Sarah" → target matched to recent LinkUp participant → user\_blocks row created → confirmation sent  
* User texts "report" with no name → clarifier sent → user replies "last group" → report applies to all participants in most recent LinkUp  
* User texts "block someone I've never met" → no match found → clarifier sent → no match after clarifier → support message sent, no block created  
* Blocked pair no longer appears as match candidates for each other  
* Report creates safety\_incident with source=user\_report visible in admin queue

---

## Phase 12 — Admin Dashboard (PWA)

---

### Ticket 12.1 — Admin Auth \+ RBAC

Goal: Implement secure admin authentication with role-based access control, session management, and audit logging for all admin actions.

Background:

The admin\_users table exists in the schema. No admin auth implementation exists. Member auth uses Supabase Auth magic links. Admin auth must be separate — admins require stricter session controls and role enforcement.

Requirements:

* Admin auth mechanism: Supabase Auth email \+ password (separate from member magic link flow) with role stored in admin\_users table  
* Admin roles (create an admin\_role enum in the DB):  
  * viewer — read-only access to all admin views  
  * operator — can manage holds, resolve incidents, send admin messages  
  * engineering — operator permissions \+ replay tools, log access  
  * super\_admin — all permissions \+ role management  
* Middleware: create apps/web/middleware.ts (or update existing) to protect all /admin/\* routes — redirect to /admin/login if no valid admin session  
* Admin session stored in Supabase Auth session (not member session)  
* Route-level role enforcement: create an requireAdminRole(role) helper that returns 403 if the authenticated admin does not have the required role  
* Audit log: every admin action (hold applied, user suspended, LinkUp canceled, entitlement override) must write an audit\_log row:  
  * (admin\_user\_id, action, entity\_type, entity\_id, before\_state, after\_state, correlation\_id, created\_at)  
  * audit\_log table confirmed in schema — add migration if missing  
* Create apps/web/app/admin/login/page.tsx (email \+ password form)  
* Create apps/web/app/admin/layout.tsx (authenticated admin layout with role-aware nav)

Deliverables:

* supabase/migrations/YYYYMMDD\_admin\_role\_enum.sql  
* apps/web/app/admin/login/page.tsx  
* apps/web/app/admin/layout.tsx  
* apps/web/lib/admin-auth.ts (session helpers, requireAdminRole)  
* Updated apps/web/middleware.ts  
* Unit tests: requireAdminRole returns 403 for insufficient role  
* Unit tests: audit\_log row created on hold application

Verification:

* Unauthenticated request to /admin/users → redirected to /admin/login  
* viewer role user attempts to apply a hold → receives 403  
* operator role user applies a hold → hold created, audit\_log row written  
* Admin session expires after 8 hours and is not auto-renewed

---

### Ticket 12.2 — Admin Ops Views

Goal: Implement all operational admin views with the depth needed to debug, manage, and support users across all system functions including the new Phase 8 conversation flows.

Background:

This is the primary admin interface for day-to-day operations. It must cover six domains: users/profiles, messaging, LinkUps, safety, billing/regions, and the new conversation system from Phase 8\.

Requirements:

* Users and profiles view (/admin/users):  
  * Searchable list of users by name, phone, state, region  
  * User detail page: registration info, state, subscription, region, safety holds  
  * Profile detail: fingerprint factors with confidence, activity patterns, completeness state (empty/partial/complete\_mvp/complete\_full), last interview step  
  * Interview progress: which signals are covered, which are missing, confidence per factor  
  * Action: manually advance or reset conversation state (super\_admin only)  
  * Action: suspend/unsuspend user with required reason (operator+)  
* Messaging timeline view (/admin/users/{id}/messages):  
  * Full SMS history (inbound \+ outbound) per user in chronological order  
  * Session mode and state\_token at time of each message  
  * Delivery status per outbound message (queued/sent/delivered/failed)  
  * Action: resend a failed outbound message (operator+, engineering+)  
  * Action: replay a stuck outbound job (engineering+)  
  * PII note: display phone numbers masked by default, reveal on explicit action with audit\_log entry  
* LinkUps view (/admin/linkups):  
  * List of LinkUps with state, region, activity, participant count  
  * LinkUp detail: participants, invite wave history, lock/expiry timeline  
  * Action: cancel a LinkUp with required reason (operator+)  
* Safety view (/admin/safety):  
  * Incident queue: open incidents filtered by severity and source  
  * Incident triage: assign → review → resolve → document workflow  
  * Hold management: view active holds, remove soft\_hold (operator+), remove hard\_hold (super\_admin only)  
  * User report queue: incidents with source=user\_report  
  * Strike history per user  
* Billing and regions view (/admin/billing):  
  * Subscription state per user, entitlement override toggle (operator+)  
  * Region list with state (open/waitlisted/closed) and waitlist count  
  * Action: open a region and trigger batch waitlist notification (operator+)  
* Conversation state view (/admin/users/{id}/conversation):  
  * Current session mode and state\_token  
  * Onboarding progress (which step, whether burst was sent)  
  * Interview signal coverage (which of 12 factors are covered, confidence)  
  * Action: reset conversation state to idle (engineering+)  
  * Action: manually set state\_token (engineering+, with audit log)

Deliverables:

* apps/web/app/admin/ page components for all six view areas  
* apps/web/app/api/admin/ route handlers for all data fetching and actions  
* All admin actions write audit\_log rows  
* Role enforcement on all action routes

Verification:

* operator can view all dashboards and apply holds, cannot access engineering tools  
* engineering can replay stuck jobs and manually set state tokens  
* super\_admin can remove hard\_holds and manage roles  
* Messaging timeline shows correct session mode at time of each message  
* Conversation state view shows correct signal coverage for a user mid-interview

---

## Phase 13 — Observability \+ Ops

All three tickets in this phase are rewritten to match Doc 5 (Observability and Monitoring Stack) depth. Partial logging infrastructure exists — these tickets complete it and extend it to cover the new Phase 8 conversation flows.

---

### Ticket 13.1 — Structured Logging \+ Canonical Event Catalog

Goal: Complete the structured logging implementation, establish the full canonical event catalog from Doc 5, add PII redaction utilities, and extend the catalog with new Phase 8 conversation events.

Background:

A structured logging framework exists in parts of the codebase. Correlation IDs are propagated in the Twilio inbound handler. The canonical log event catalog from Doc 5 (30+ events across 7 categories) is not fully implemented. PII redaction rules are not enforced. This ticket completes the implementation and extends it for Phase 8\.

Requirements:

* Create packages/core/src/observability/logger.ts:  
  * JSON-formatted log output (not console.log strings)  
  * Required fields per log entry: ts (ISO), level, event, env, correlation\_id  
  * Optional fields: user\_id (hashed), linkup\_id, step\_id, duration\_ms, error\_code, error\_message  
  * PII rules (must be enforced in logger, not at call site):  
    * Never log raw SMS message body  
    * Never log full phone number (log only last 4 digits: \*\*\*\*1234)  
    * Never log full name (log first name only)  
    * Never log email  
  * Log levels: debug (local only), info, warn, error, fatal  
  * Export a createLogger(context) factory that binds correlation\_id and env to all subsequent log calls  
* Implement the following canonical events from Doc 5 (minimum — add all from Doc 5):  
  * Inbound SMS: sms.inbound\_received, sms.inbound\_duplicate, sms.stop\_received, sms.help\_received  
  * Outbound SMS: sms.outbound\_queued, sms.outbound\_sent, sms.outbound\_failed, sms.outbound\_delivered, sms.status\_callback\_received  
  * Conversation: conversation.session\_mode\_changed, conversation.state\_token\_set, conversation.intent\_classified, conversation.clarifier\_sent  
  * Onboarding (new for Phase 8): onboarding.burst\_initiated, onboarding.message\_sent (per message), onboarding.burst\_complete, onboarding.paused (user replied Later)  
  * Interview (new for Phase 8): interview.started, interview.step\_advanced, interview.llm\_extraction\_called, interview.llm\_extraction\_success, interview.llm\_extraction\_failed, interview.regex\_fallback\_used, interview.signal\_covered (per factor), interview.complete\_mvp\_reached, interview.dropout\_detected, interview.dropout\_nudge\_sent, interview.resumed  
  * LinkUp: linkup.created, linkup.invite\_sent, linkup.invite\_accepted, linkup.invite\_declined, linkup.locked, linkup.expired, linkup.canceled  
  * Post-event: post\_event.runner\_scan, post\_event.attendance\_sent, post\_event.do\_again\_collected, post\_event.feedback\_collected, post\_event.contact\_choice\_recorded, post\_event.mutual\_detected, post\_event.reveal\_sent  
  * Safety: safety.keyword\_hit, safety.incident\_created, safety.hold\_applied, safety.hold\_removed, safety.crisis\_detected, safety.block\_created, safety.report\_created, safety.contact\_exchange\_suppressed, safety.outbound\_suppressed  
  * Billing: billing.subscription\_activated, billing.subscription\_canceled, billing.payment\_failed, billing.entitlement\_changed  
* Log sink: Vercel function logs (baseline). For production, configure external sink (Logtail or equivalent) — document as a runbook, not a code requirement  
* Update all engines and handlers to use the canonical logger

Deliverables:

* packages/core/src/observability/logger.ts  
* packages/core/src/observability/events.ts (typed event constants)  
* Updated supabase/functions/ (all log calls use canonical logger)  
* Updated packages/core/src/ (all log calls use canonical logger)  
* Unit tests: PII redaction (phone, body, email never appear in log output)  
* Unit tests: canonical event fields present on every log entry

Verification:

* Send an SMS → sms.inbound\_received log entry appears with correct fields, no raw body, no full phone number  
* Complete interview → interview.complete\_mvp\_reached log entry appears  
* LLM extraction fails → interview.llm\_extraction\_failed \+ interview.regex\_fallback\_used logged in sequence  
* grep for raw phone numbers in log output returns zero results

---

### Ticket 13.2 — Error Tracking (Sentry)

Goal: Implement Sentry error tracking for all application surfaces with PII scrubbing, performance tracing, and integration with Phase 8 LLM call paths.

Background:

No Sentry or equivalent error tracking exists in the codebase. Doc 5 specifies Sentry configuration for Next.js (client \+ server), severity levels, 12 event categories with specific tags, PII scrubbing rules, performance monitoring with span recording, and sampling rates.

Requirements:

* Install and configure @sentry/nextjs in apps/web/  
* Configure Sentry in next.config.js via withSentryConfig  
* Create apps/web/sentry.client.config.ts and apps/web/sentry.server.config.ts  
* PII scrubbing (must be configured in Sentry, not just in code):  
  * Scrub SMS body from all events  
  * Scrub full phone numbers (allow last 4 digits only)  
  * Scrub email addresses  
  * Scrub full names from breadcrumbs  
* Event tagging — tag all Sentry events with:  
  * env (staging/production)  
  * correlation\_id  
  * user\_id (hashed, not raw)  
  * event\_category (one of: sms, interview, linkup, post\_event, safety, billing, llm, admin)  
* Severity levels: fatal (system down), error (request failed), warning (degraded behavior), info (notable event)  
* Performance tracing:  
  * Instrument twilio-inbound handler with a Sentry span  
  * Instrument LLM extraction calls with a Sentry span (from Phase 8\)  
  * Instrument LinkUp lock transaction with a Sentry span  
  * Sampling: 100% in staging, 20% in production  
* LLM-specific: capture Sentry error when LLM returns invalid JSON (before fallback fires) — tag with event\_category=llm, include prompt hash (not full prompt) for debugging  
* Alert routing: configure Sentry alerts for:  
  * fatal severity → immediate notification (PagerDuty or email)  
  * error rate spike (\>5 errors/minute) → notification  
  * LLM extraction failure rate \>20% → warning notification

Deliverables:

* apps/web/sentry.client.config.ts  
* apps/web/sentry.server.config.ts  
* Updated apps/web/next.config.js  
* Sentry span instrumentation in twilio-inbound, LLM extractor, LinkUp lock  
* docs/runbooks/sentry-setup.md (DSN configuration, alert routing setup)  
* Unit tests: PII scrubbing removes phone and body from captured events

Verification:

* Trigger a deliberate error in staging → Sentry event appears with correct tags, no raw phone number, no SMS body  
* LLM returns invalid JSON → Sentry error captured with event\_category=llm  
* Sentry dashboard shows performance trace for interview flow  
* Fatal error alert fires within 2 minutes of event

---

### Ticket 13.3 — Metrics \+ Alerting

Goal: Implement the full metrics catalog from Doc 5, configure dashboards for product health and reliability, and add LLM cost tracking for the Phase 8 conversation system.

Background:

No metrics adapter, dashboards, or alerting exists. Doc 5 specifies 17 counters, 6 histograms, 3 gauges, 4 dashboards (product health, reliability, safety, cost), and alert thresholds. Phase 8 makes LLM extraction primary — LLM cost tracking becomes operationally significant.

Requirements:

* Create packages/core/src/observability/metrics.ts:  
  * Metrics adapter interface (supports Datadog, Prometheus, or Vercel Analytics as backend — implement one, keep interface stable for future swap)  
  * Export increment(counter, tags), histogram(name, value, tags), gauge(name, value, tags) functions  
* Implement the following counters (from Doc 5, extended for Phase 8):  
  * sms.inbound\_received (by region, by intent)  
  * sms.outbound\_sent (by purpose: interview/invite/post\_event/safety/otp)  
  * sms.outbound\_failed (by error\_code)  
  * onboarding.burst\_initiated, onboarding.burst\_complete, onboarding.paused  
  * interview.started, interview.complete\_mvp, interview.dropout  
  * interview.llm\_extraction\_success, interview.llm\_extraction\_failed, interview.regex\_fallback (ratio metric: llm vs regex parse rate)  
  * linkup.created, linkup.locked, linkup.expired, linkup.canceled  
  * post\_event.attendance\_yes, post\_event.attendance\_no  
  * post\_event.do\_again\_yes, post\_event.do\_again\_maybe, post\_event.do\_again\_no  
  * post\_event.contact\_exchange\_mutual  
  * safety.incident\_created (by severity, by category)  
  * safety.hold\_applied (by hold\_type)  
  * billing.subscription\_activated, billing.subscription\_canceled  
* Implement the following histograms:  
  * interview.session\_duration\_seconds (from start to complete\_mvp)  
  * interview.exchanges\_to\_mvp (number of back-and-forth turns)  
  * llm.extraction\_latency\_ms  
  * linkup.time\_to\_lock\_seconds  
  * sms.delivery\_latency\_ms (time from send to delivered callback)  
  * post\_event.response\_time\_seconds (time from message send to user reply)  
* Implement the following gauges:  
  * sms.outbound\_job\_queue\_depth  
  * interview.sessions\_active (sessions with mode=interviewing)  
  * safety.open\_incidents  
* LLM cost tracking:  
  * Log Anthropic API token usage per extraction call (input\_tokens, output\_tokens)  
  * Emit llm.cost\_estimate\_usd gauge (computed from token counts × current price)  
  * Alert if daily LLM cost estimate exceeds configurable threshold  
* Configure dashboards (docs only — actual dashboard config in monitoring tool):  
  * Product health: registration → onboarding → interview → active funnel, LinkUp lock rate, do-again rate, contact exchange rate  
  * Reliability: SMS delivery rate, outbound job queue depth, LLM success rate, error rates by category  
  * Safety: incident rate by severity, hold rate, crisis detection rate  
  * Cost: Twilio message volume, LLM token usage, estimated monthly cost  
* Alert thresholds:  
  * sms.outbound\_failed \> 5% of sent in any 5-minute window → critical  
  * interview.llm\_extraction\_failed \> 20% in any 10-minute window → high  
  * sms.outbound\_job\_queue\_depth \> 100 → high  
  * safety.open\_incidents with severity=critical \> 0 → critical (immediate)  
  * llm.cost\_estimate\_usd daily \> configured threshold → warning

Deliverables:

* packages/core/src/observability/metrics.ts  
* Metrics instrumentation in all engines (onboarding, interview, post-event, linkup, safety)  
* docs/runbooks/dashboards.md (dashboard specifications)  
* docs/runbooks/alert-thresholds.md (alert configuration)  
* Unit tests: all metric emitters called with correct tags on key events

Verification:

* Complete an interview → interview.complete\_mvp counter incremented, interview.session\_duration\_seconds histogram recorded  
* LLM extraction call → llm.extraction\_latency\_ms recorded  
* LLM extraction fails → interview.llm\_extraction\_failed incremented, interview.regex\_fallback incremented  
* Outbound job queue depth metric reflects actual queue depth in DB

---

## Phase 14 — Testing \+ E2E Harness

---

### Ticket 14.1 — Twilio Simulator Harness

Goal: Build a Twilio simulator that supports the new Phase 8 conversation architecture — multi-message bursts with timing, session mode transitions, and LLM extraction — enabling deterministic E2E tests without real SMS sends.

Background:

No Twilio simulator exists. The existing test suite uses unit tests with mocks. An E2E simulator is needed to validate the full conversation flow including the new in-process sequential delivery pattern from Phase 8\. The simulator must model REST API sends with delays (not TwiML responses) and must be able to simulate a full multi-turn conversation including onboarding, interview, and post-event flows.

Requirements:

* Create scripts/simulate-twilio.mjs with the following capabilities:  
  * Simulate inbound SMS: POST to /api/twilio/inbound with a valid Twilio signature (use test credentials to sign)  
  * Capture outbound SMS: intercept calls to packages/messaging/sender and record sent messages without actually calling Twilio  
  * Simulate delivery callbacks: POST to /api/twilio/status for each captured outbound message  
  * Simulate timing: record timestamps of each send to validate 8-second delays in onboarding burst (assert actual delay within ±2 seconds)  
  * Support multi-turn simulation: run a sequence of inbound messages and assertions in order, with configurable delay between turns  
  * Support LLM stubbing: intercept packages/llm/src/interview-extractor.ts and return configurable extraction responses (rich-answer mode vs sparse-answer mode)  
* Create scripts/sim-scenarios/ directory with the following scenario files:  
  * onboarding-full.mjs — waitlist activation through interview start  
  * interview-rich.mjs — user gives rich answers, reaches complete\_mvp in 6-8 turns  
  * interview-sparse.mjs — user gives sparse answers, reaches complete\_mvp in 10-13 turns  
  * interview-dropout.mjs — user stops mid-interview, nudge sent, resumes  
  * llm-fallback.mjs — LLM fails, regex fallback runs, interview continues  
  * post-event-full.mjs — attendance through contact exchange  
  * safety-keyword.mjs — keyword triggers hold, interview suspended  
* Each scenario file defines:  
  * Setup: user state, region state, any pre-existing profile data  
  * Turns: array of { inbound: string, assertOutbound: string | RegExp, assertSessionMode: string, assertStateToken: string }  
  * Teardown: expected final state assertions

Deliverables:

* scripts/simulate-twilio.mjs  
* scripts/sim-scenarios/ (all scenario files above)  
* package.json script: pnpm sim:scenario \<scenario-name\>  
* README section: how to run a simulation scenario locally

Verification:

* pnpm sim:scenario onboarding-full completes without assertion failures  
* pnpm sim:scenario interview-rich shows complete\_mvp reached in ≤8 turns  
* pnpm sim:scenario interview-sparse shows complete\_mvp reached in ≤13 turns  
* pnpm sim:scenario llm-fallback shows interview continues after LLM failure  
* Onboarding burst timing: 8-second delays recorded within ±2 seconds

---

### Ticket 14.2 — E2E Staging Validation

Goal: Execute and document a complete end-to-end validation of the MVP on staging, covering all critical user flows with explicit pass/fail criteria.

Background:

The original E2E checklist did not account for the new Phase 8 conversation architecture. The updated checklist must validate the full new user experience from waitlist activation through profile completion, as well as all other critical flows.

Requirements:

* Create docs/testing/e2e-staging-checklist.md with the following scenarios, each with explicit pass criteria:

   Scenario 1 — New User Onboarding Burst:

  * Trigger waitlist activation for a test user  
  * Assert: opening message received within 30 seconds of activation  
  * Reply with a positive response  
  * Assert: explanation message received  
  * Reply with a positive response  
  * Assert: Message 1 received, then Message 2 received \~8 seconds later, then Message 3 received \~8 seconds after that, then Message 4 immediately  
  * Reply with a positive response  
  * Assert: session mode=interviewing, state\_token starts with interview:  
* Scenario 2 — Adaptive Interview (Rich Answers):

  * Continue from Scenario 1  
  * Provide detailed, specific answers to each interview question  
  * Assert: complete\_mvp reached in 12 or fewer total exchanges (from interview start to wrap message)  
  * Assert: profiles.state=complete\_mvp in DB  
  * Assert: at least 8 fingerprint factors have confidence \>= 0.55  
* Scenario 3 — Interview Dropout And Resume:

  * Start interview, answer 2-3 questions, stop replying  
  * Wait 24 hours (or advance clock in staging)  
  * Assert: one dropout nudge received (and only one)  
  * Reply with any text  
  * Assert: resume message received, followed immediately by next question  
  * Assert: questions already answered are not repeated  
* Scenario 4 — LLM Extraction Failure Fallback:

  * Temporarily disable Anthropic API key in staging env  
  * Continue interview  
  * Assert: interview continues (regex fallback fires)  
  * Assert: interview.llm\_extraction\_failed and interview.regex\_fallback\_used log events appear  
  * Restore API key  
* Scenario 5 — LinkUp Formation End-to-End:

  * Two users with complete\_mvp profiles in same region  
  * User A initiates a LinkUp via SMS  
  * Assert: User B receives invite  
  * User B accepts  
  * Assert: LinkUp locked, both users receive confirmation with dashboard link  
* Scenario 6 — Post-Event Full Flow:

  * Advance a locked LinkUp past event\_time \+ 2 hours  
  * Trigger post-event runner  
  * Assert: both participants receive attendance message  
  * Reply Yes for both  
  * Assert: do\_again message received  
  * Reply A (Yes) for both  
  * Assert: feedback message received, skip it  
  * Assert: contact exchange intro received  
  * Reply Yes for both  
  * Assert: reveal message received by both with correct phone numbers  
* Scenario 7 — Safety Keyword Hold:

  * Send a message containing a crisis keyword  
  * Assert: crisis response message received (correct verbatim content)  
  * Assert: safety\_incident row created with severity=critical  
  * Assert: soft\_hold applied  
  * Assert: no conversation engine routing occurred (session state unchanged)  
* Scenario 8 — Contact Exchange Safety Suppression:

  * Two users in post-event contact\_choices step who have both said Yes  
  * Apply a hard\_hold to one user before reveal fires  
  * Assert: reveal message NOT sent to either user  
  * Assert: safety.contact\_exchange\_suppressed log event appears  
* Scenario 9 — Block/Report Flow:

  * User texts "report \[name\]"  
  * Assert: reason category prompt received  
  * Reply with A  
  * Assert: confirmation message received  
  * Assert: safety\_incident row created with source=user\_report  
* Each scenario must document:

  * Preconditions (DB state required before running)  
  * Step-by-step actions with expected outcome per step  
  * Pass criteria (explicit DB state assertions, message content assertions)  
  * How to reset staging state after the scenario

Deliverables:

* docs/testing/e2e-staging-checklist.md (all 9 scenarios)  
* Evidence of all 9 scenarios passing in staging before production launch

Verification:

* All 9 scenarios pass with no assertion failures  
* Failures produce clear, actionable error messages (not generic timeouts)  
* Staging state can be cleanly reset between scenario runs

---

## Phase 15 — Production Provisioning \+ Deployment

Note: All references to OpenAI in the original tickets are replaced with Anthropic throughout this phase.

---

### Ticket 15.1 — Production Supabase Provisioning

Goal: Provision a new production Supabase project with all migrations applied and RLS policies validated.

Deliverables:

* New production Supabase project created  
* All migrations applied in order with no errors  
* docs/runbooks/prod-supabase-setup.md (step-by-step provisioning guide, including extension requirements, RLS policy validation steps, and seed data checklist)

Verification:

* pnpm db:migrate runs cleanly against production  
* RLS check: member cannot read another member's profile via anon key  
* Admin service role can perform all required operations

---

### Ticket 15.2 — Production Vercel Setup

Goal: Configure the production Vercel deployment with all required environment variables including Anthropic API credentials.

Required environment variables (production):

* APP\_ENV=production  
* SUPABASE\_URL, SUPABASE\_ANON\_KEY, SUPABASE\_SERVICE\_ROLE\_KEY  
* TWILIO\_ACCOUNT\_SID, TWILIO\_AUTH\_TOKEN, TWILIO\_MESSAGING\_SERVICE\_SID  
* ANTHROPIC\_API\_KEY (required — Phase 8 LLM extraction is primary, not fallback)  
* STRIPE\_SECRET\_KEY, STRIPE\_WEBHOOK\_SECRET  
* CRON\_SECRET  
* SENTRY\_DSN

Deliverables:

* All env vars set in Vercel production project  
* docs/runbooks/prod-vercel-setup.md (env var checklist, deployment verification steps, rollback procedure)

Verification:

* pnpm doctor passes against production env vars  
* Vercel deployment succeeds with no build errors  
* ANTHROPIC\_API\_KEY connectivity verified (test extraction call returns valid JSON)

---

### Ticket 15.3 — Production Twilio Wiring

Goal: Wire production Twilio number to inbound webhook and status callback, and validate A2P compliance for the new multi-message burst delivery pattern.

Requirements:

* Configure production inbound webhook URL: https://callmejosh.ai/api/twilio/inbound  
* Configure production status callback URL: https://callmejosh.ai/api/twilio/status  
* Verify A2P 10DLC registration covers the new message patterns:  
  * Multi-message onboarding bursts (3 consecutive messages without user reply)  
  * Verify sample messages submitted to A2P include examples of burst pattern  
* Confirm Twilio REST API sends (not TwiML only) are supported on the production Messaging Service  
* Verify signature validation works with production Auth Token

Deliverables:

* docs/runbooks/prod-twilio-setup.md (webhook configuration steps, A2P compliance checklist for burst messages, signature validation test)

Verification:

* Twilio test webhook to production URL returns 200  
* Status callback to production URL returns 200 and updates sms\_messages  
* Send a real SMS via production number and confirm delivery  
* A2P compliance review confirms burst pattern is covered

---

### Ticket 15.4 — Production Stripe Wiring

Goal: Configure production Stripe webhooks, products, and prices.

Deliverables:

* Production Stripe webhook endpoint configured  
* Products and prices created in production Stripe dashboard  
* docs/runbooks/prod-stripe-setup.md

Verification:

* Test checkout session completes and grants entitlements in production  
* Stripe webhook signature validation passes  
* Subscription cancel removes entitlements per policy

---

### Ticket 15.5 — Launch Checklist \+ Cutover

Goal: Execute a structured pre-launch verification of all critical systems before opening the first region to waitlisted users.

Requirements:

* Create docs/runbooks/launch-checklist.md covering:

   Infrastructure:

  * All migrations applied, schema validated  
  * All env vars present and tested (including ANTHROPIC\_API\_KEY)  
  * Sentry receiving events from production  
  * Metrics adapter connected and emitting  
* Conversation System (Phase 8 — highest priority verification):

  * Trigger waitlist activation for one admin test user  
  * Verify onboarding burst received with correct timing (\~8 seconds between messages)  
  * Complete interview as test user, verify complete\_mvp reached  
  * Verify profiles.state=complete\_mvp in production DB  
  * Verify LLM extraction working (check interview.llm\_extraction\_success log events)  
  * Verify regex fallback works (temporarily disable API key, run one turn, confirm interview continues)  
* LinkUp Flow:

  * Two admin test accounts initiate and lock a LinkUp end-to-end  
  * Verify lock confirmation messages received  
  * Verify dashboard shows correct state  
* Safety:

  * Send a test crisis keyword from admin test number  
  * Verify crisis message received and hold applied  
  * Remove hold from admin dashboard  
* Post-Event:

  * Manually trigger post-event runner for a test LinkUp  
  * Verify attendance message received  
  * Complete full post-event flow to contact exchange  
* Go/No-Go Decision:

  * All checklist items must pass before opening any region  
  * One designated person signs off on each section  
  * Rollback procedure documented and tested (can revert deployment, can disable Twilio webhook to halt SMS processing)  
* Open First Region:

  * Run migrations  
  * Confirm all webhooks active  
  * Open Seattle region in admin dashboard  
  * Monitor dashboards for first 30 minutes:  
    * SMS delivery rate  
    * Onboarding burst completion rate  
    * LLM extraction success rate  
    * Error rate in Sentry

Deliverables:

* docs/runbooks/launch-checklist.md  
* Evidence of all checklist items passing in production before region open

Verification:

* Launch checklist signed off by designated person per section  
* First 10 real users complete onboarding burst without errors  
* No fatal Sentry events in first 30 minutes after region open

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

8. Web App (Next.js on Vercel)  
   * Marketing site  
   * Member dashboard (PWA)  
   * Admin dashboard (PWA)  
   * API routes for Twilio/Stripe webhooks and cron runners  
9. Data Layer (Supabase)  
   * Postgres schema \+ migrations  
   * RLS where appropriate  
   * Edge Functions optional (we will decide per endpoint; the plan works with Vercel API routes as primary)  
10. Messaging (Twilio)  
    * Inbound webhook → message intake  
    * Outbound send pipeline → Twilio Messaging Service  
    * Status callbacks → delivery receipts  
11. Billing (Stripe)  
    * Checkout \+ portal  
    * Webhooks derive entitlements and subscription state  
12. Scheduler  
    * Vercel Cron → protected runner endpoint  
13. LLM Layer  
    * Deterministic parsing first  
    * LLM fallback for classification/extraction  
    * Strict JSON schemas \+ validators  
14. Observability  
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

6. Create branch `ticket/<id>-<slug>`  
7. Implement  
8. Verify locally (lint/typecheck/tests)  
9. Open PR with checklist (env vars, migrations, dashboards)  
10. Merge when green