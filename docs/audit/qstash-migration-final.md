# Phase 8B — Onboarding Delivery Architecture: QStash Migration

This phase replaces the onboarding message delivery mechanism implemented in Phase 8.3 with a deterministic sequential scheduler using QStash. The change is required because the sweep-style runner \+ staggered run\_at timestamps architecture is structurally incompatible with sub-minute, human-like pacing. Testing confirmed the failure modes described below. This phase resolves them completely.

## Scope And Vercel Cron Clarification

The scope of this phase is strictly limited to onboarding pacing. This means:

* The Vercel Cron trigger that drove the onboarding sweep runner is removed.  
* The general outbound job runner (sms\_outbound\_jobs sweep) and its Vercel Cron schedule continue unchanged — all non-onboarding flows (invites, reminders, OTP, post-event) are unaffected.

If a future decision is made to replace Vercel Cron entirely across all flows, that is a separate phase with its own scope and risk assessment. This phase does not make that change.

Additional constraints:

* No schema changes.  
* No migrations.  
* No changes to any flow outside of onboarding.

This phase must be completed before Phase 9\.

---

## Why The Phase 8.3 Implementation Fails

The Phase 8.3 implementation enqueues multiple sms\_outbound\_jobs with staggered run\_at timestamps and relies on a cron-driven sweep runner to deliver them in order. Three structural properties of this architecture make it incompatible with reliable sub-minute pacing:

* Coarse runner cadence collapses spacing. Any sweep-style runner operating on minute-ish boundaries will often find multiple jobs due in the same execution and send them together. The 8-second run\_at offsets are not respected.

* In-process delays are unreliable. setTimeout-based sleep under cold starts, timeouts, and retries does not produce deterministic timing.

* Overlapping triggers amplify race conditions. Cron, retries, and manual triggers can overlap. Even with idempotency guards, overlapping executions can re-enter onboarding send logic and produce burst sends or duplicate full sequences.

Observed symptoms: opening message and Message 2 arriving together; explanation messages arriving irregularly; duplicate full bursts appearing minutes later.

## Target Architecture

QStash replaces the enqueue-multiple-jobs pattern with a one-step-per-execution loop. The invariants are absolute:

* Never enqueue a burst of onboarding steps.  
* Never sleep in-process.  
* Never rely on cron sweep timing for sub-minute pacing.  
* Exactly one onboarding message is sent per scheduled execution.

Each QStash execution sends one message, advances state, and schedules exactly one next execution with the required delay — or stops if the sequence is complete. Pacing is deterministic because it emerges from sequential scheduling, not inferred timing.

---

### Ticket 8B.1 — QStash Integration And Configuration

Goal: Install and configure QStash as a scheduled execution provider, available to the onboarding engine without affecting any other part of the system.

Background:

QStash (Upstash) is an HTTP-based message queue that supports delayed delivery with retry semantics and signature validation. It is the correct tool for deterministic sub-minute scheduled execution in a Vercel serverless environment. This ticket establishes the integration layer — client, signature validation middleware, and environment configuration — before any onboarding logic is wired to it. If QStash is already partially installed in the repo, this ticket confirms and completes the integration to the standard below rather than duplicating work.

Requirements:

* Install @upstash/qstash in apps/web/ (or confirm existing installation)  
* Add the following environment variables to .env.example and the environment contract (docs/runbooks/environment-contract.md):  
  * QSTASH\_TOKEN — used to publish messages to QStash  
  * QSTASH\_CURRENT\_SIGNING\_KEY — used to validate inbound QStash requests  
  * QSTASH\_NEXT\_SIGNING\_KEY — used to validate inbound QStash requests during key rotation  
* Create (or update) apps/web/lib/qstash.ts:  
  * Export a configured QStash client (publishMessage, publishJSON helpers)  
  * Export a verifyQStashSignature(request: Request): Promise\<boolean\> function that validates QStash signature headers — returns false if invalid  
  * Client must be instantiated from environment variables, never hardcoded  
  * Export a scheduleOnboardingStep(payload, delayMs) helper that wraps publishJSON with the correct target URL and delay — this is the only function that may schedule onboarding steps  
* Create apps/web/app/api/onboarding/ directory (step handler added in 8B.2)  
* Add QStash key validation to pnpm doctor — fail with a clear error if QSTASH\_TOKEN or signing keys are absent  
* No changes to sms\_outbound\_jobs, the outbound runner, or any other existing system

Deliverables:

* @upstash/qstash confirmed in apps/web/package.json  
* apps/web/lib/qstash.ts (client, verifyQStashSignature, scheduleOnboardingStep)  
* Updated .env.example (three QStash vars)  
* Updated docs/runbooks/environment-contract.md  
* Updated scripts/doctor.mjs (QStash var validation)  
* Unit tests: verifyQStashSignature returns false for tampered or missing signature headers  
* Unit tests: scheduleOnboardingStep calls publishJSON with correct target URL, payload, and delay

Verification:

* pnpm doctor fails with a clear error when QSTASH\_TOKEN is absent  
* pnpm doctor passes when all three QStash vars are present  
* verifyQStashSignature returns false for a request with a tampered signature  
* verifyQStashSignature returns true for a correctly signed QStash request  
* No changes to any existing tests — this ticket is additive only

---

### Ticket 8B.2 — Onboarding Step Handler And Idempotency

Goal: Implement the single-step onboarding handler that QStash calls for each onboarding message — a self-contained, replay-safe execution unit that sends exactly one SMS, advances state, and schedules the next step — with step-scoped idempotency that makes every execution safe under retry, replay, and concurrent invocation.

Background:

The handler is the core of the QStash architecture. Each invocation is responsible for exactly one thing: sending one onboarding message. It must be safe under replay (QStash retries on non-2xx responses), safe under concurrent invocation (idempotency prevents double-sends), and safe under stale invocations (state token re-check prevents out-of-order sends).

Idempotency is not an afterthought — it is a first-class constraint of every step execution. The idempotency key is stable across retries, the check precedes the send, and the state advance and idempotency record are written atomically. This means any replay of any step, at any time, produces at most one SMS and leaves the system in a consistent state.

Requirements:

* Create apps/web/app/api/onboarding/step/route.ts (POST handler)

* Separate handler logic into apps/web/lib/onboarding-step-handler.ts for testability — the route file imports and calls it, does nothing else

* Accept the following JSON body (typed as OnboardingStepPayload):

```ts
type OnboardingStepPayload = {
  profile_id: string;
  session_id: string;
  step_id: OnboardingStepId;
  expected_state_token: string;
  idempotency_key: string; // format: onboarding:{profile_id}:{session_id}:{step_id}
}
```

*   
  Handler algorithm (must execute in this exact order, no exceptions):

  * Validate QStash signature via verifyQStashSignature — return 401 immediately if invalid (QStash will not retry 401\)  
  * Load the conversation session from the DB (source of truth — never trust the payload alone for state decisions)  
  * Eligibility checks — return 200 (not 4xx or 5xx) if any check fails. Returning 200 tells QStash the message was handled; non-2xx would cause a retry of a legitimately skipped step:  
    * Session exists and is active  
    * session.state\_token matches expected\_state\_token exactly (stale check)  
    * User is not on a safety hard\_hold  
    * Session is not paused (user replied "later")  
  * Idempotency check — query sms\_messages for a row with this idempotency\_key and a non-null Twilio SID. If found: log onboarding.step\_skipped (reason: already\_sent) and return 200 immediately. Do not send, do not advance state.  
  * Send exactly one SMS via packages/messaging/sender using the message constant for this step\_id. The sender writes to sms\_messages before sending (as per packages/messaging/ contract) — this is the idempotency record. Do not create a redundant table.  
  * Advance state atomically in a DB transaction:  
    * Write the next state\_token to conversation\_sessions  
    * Confirm sms\_messages row for this idempotency\_key exists (written in step 5\) — roll back and return 500 if absent (triggers QStash retry)  
  * Schedule the next step via scheduleOnboardingStep() with the configured delay — or stop if the sequence is complete  
  * Return 200  
* Step IDs, message constants, and delays:

```ts
// OnboardingStepId enum
type OnboardingStepId =
  | "onboarding_message_1"   // ONBOARDING_MESSAGE_1, delay from prior step: 0ms
  | "onboarding_message_2"   // ONBOARDING_MESSAGE_2, delay: 8_000ms
  | "onboarding_message_3"   // ONBOARDING_MESSAGE_3, delay: 8_000ms
  | "onboarding_message_4";  // ONBOARDING_MESSAGE_4, delay: 0ms

const ONBOARDING_STEP_DELAY_MS: Record<OnboardingStepId, number> = {
  onboarding_message_1: 0,
  onboarding_message_2: 8_000,
  onboarding_message_3: 8_000,
  onboarding_message_4: 0,
};
```

*   
  Note: opening and explanation messages are not scheduled via QStash — they are sent directly in response to user actions (waitlist activation and affirmative reply respectively).

* Log the following events on every handler execution:

  * onboarding.step\_handler\_invoked (step\_id, session\_id, correlation\_id)  
  * onboarding.step\_sent (step\_id, idempotency\_key) — on successful send  
  * onboarding.step\_skipped (step\_id, reason) — on eligibility failure or idempotency hit  
  * onboarding.step\_next\_scheduled (step\_id, next\_step\_id, delay\_ms) — when next step is queued

Deliverables:

* apps/web/app/api/onboarding/step/route.ts  
* apps/web/lib/onboarding-step-handler.ts  
* packages/core/src/onboarding/step-ids.ts (OnboardingStepId type, ONBOARDING\_STEP\_DELAY\_MS constants)  
* Unit tests: each eligibility check returns 200 and skips send when failed  
* Unit tests: idempotency check returns 200 without re-sending on duplicate key  
* Unit tests: safety hard\_hold returns 200, step\_skipped logged  
* Unit tests: state token mismatch (stale invocation) returns 200, step\_skipped logged with reason=stale  
* Unit tests: step 6 transaction rollback on missing sms\_messages row returns 500 (QStash retry triggered correctly)  
* Integration test: same payload submitted twice → exactly one sms\_messages row, one Twilio send, state advanced once

Verification:

* Handler called with valid payload and clean state → one SMS sent, state advanced, next step scheduled  
* Handler called with same idempotency\_key a second time → returns 200, no SMS sent, sms\_messages has exactly one row for that key  
* Handler called with expected\_state\_token that does not match current session → returns 200, no SMS sent, step\_skipped logged with reason=stale  
* Handler called for user on hard\_hold → returns 200, no SMS sent, step\_skipped logged with reason=safety\_hold  
* QStash retries handler after simulated 500 on first attempt → second attempt succeeds, exactly one SMS delivered total

---

### Ticket 8B.3 — Onboarding Trigger And Reply Handler Rewire

Goal: Replace the Phase 8.3 multi-job enqueue pattern with QStash sequential scheduling at the reply-gated entry points, and introduce the onboarding:awaiting\_burst state token to protect the burst window from unintended inbound routing.

Background:

The existing onboarding flow has two reply-gated steps (opening and explanation) and one burst (Messages 1–4). Phase 8.3 triggered the burst by enqueuing multiple sms\_outbound\_jobs with staggered run\_at. This ticket rewires those entry points to publish a single QStash message instead. The reply-gating logic, intent detection, and "later" handling do not change — only the delivery mechanism.

The awaiting\_burst state token is a necessary addition. Without it, an inbound message received during the burst window would be routed to the interview engine, causing a premature session mode transition. The token holds inbound routing in place while the burst delivers.

Requirements:

* Remove multi-job enqueue from the onboarding engine:  
  * In packages/core/src/onboarding/onboarding-engine.ts, remove all code that enqueues sms\_outbound\_jobs for burst steps (Messages 1–4)  
  * The opening message (ONBOARDING\_OPENING) continues to send directly via packages/messaging/sender on waitlist activation — no change  
* Rewire the opening reply handler (state\_token: onboarding:awaiting\_opening\_response):  
  * Affirmative reply: send ONBOARDING\_EXPLANATION directly via packages/messaging/sender, set state\_token: onboarding:awaiting\_explanation\_response  
  * No QStash scheduling at this step — explanation is reply-gated, not time-gated  
  * Negative reply ("later", "no"): send ONBOARDING\_LATER, set state\_token: onboarding:awaiting\_opening\_response — no QStash scheduling  
* Rewire the explanation reply handler (state\_token: onboarding:awaiting\_explanation\_response):  
  * Affirmative reply: call scheduleOnboardingStep() for onboarding\_message\_1 with delay=0, then set state\_token: onboarding:awaiting\_burst  
  * Do NOT enqueue sms\_outbound\_jobs for any burst steps — the QStash sequential loop handles all subsequent scheduling from this point  
  * Negative reply: send ONBOARDING\_LATER, set state\_token: onboarding:awaiting\_opening\_response — no QStash scheduling  
* Add onboarding:awaiting\_burst to the state token registry and router:  
  * In packages/core/src/interview/state.ts: add to the valid token set  
  * In conversation-router.ts: while state\_token is onboarding:awaiting\_burst, hold inbound messages — do not route to interview engine or any other handler  
  * STOP/HELP continues to take precedence over the hold and interrupts the burst — when STOP is received during awaiting\_burst, the next QStash handler invocation will detect the opt-out in its eligibility check and terminate the sequence without sending  
* Confirm the Message 4 reply handler (state\_token: onboarding:awaiting\_interview\_start) is unaffected by this change — affirmative reply transitions to mode=interviewing, no modification needed  
* Intent interpretation is unchanged throughout: any positive, neutral, or ambiguous reply advances; only an explicit negative pauses

Deliverables:

* Updated packages/core/src/onboarding/onboarding-engine.ts (burst enqueue removed, scheduleOnboardingStep call added at explanation affirmative reply)  
* Updated packages/core/src/interview/state.ts (onboarding:awaiting\_burst added to token registry)  
* Updated conversation-router.ts (awaiting\_burst: hold inbound, STOP/HELP through)  
* Unit tests: explanation affirmative reply calls scheduleOnboardingStep exactly once with step\_id=onboarding\_message\_1  
* Unit tests: explanation affirmative reply creates zero sms\_outbound\_jobs rows  
* Unit tests: inbound message during awaiting\_burst is held, not routed to interview engine  
* Unit tests: STOP received during awaiting\_burst is routed to STOP handler, not held

Verification:

* User replies affirmatively to explanation → exactly one scheduleOnboardingStep call, zero sms\_outbound\_jobs rows created for burst steps  
* state\_token set to onboarding:awaiting\_burst immediately after the call  
* Second inbound message during burst → not routed to interview engine, held  
* STOP during burst → STOP handler fires; next QStash step invocation detects opt-out and returns 200 without sending  
* User replies "later" to explanation → ONBOARDING\_LATER sent, no QStash publish, state\_token: onboarding:awaiting\_opening\_response

---

### Ticket 8B.4 — Staging Harness Compatibility

Goal: Update the staging test harness (pnpm staging:onboarding:e2e) to work correctly with the QStash delivery model in both real and stub modes, without breaking any existing harness capability.

Background:

The existing harness seeds sms\_outbound\_jobs and triggers the sweep runner to test onboarding end-to-end. The QStash model does not use sms\_outbound\_jobs for burst steps. The harness must be updated to use the correct new entry point. It must also support a stub mode for local development and CI that bypasses real QStash network calls while still exercising the full step handler logic.

Requirements:

* Update the harness to initiate onboarding via the waitlist activation trigger (the same code path production uses) — the harness must not know or care about the internal delivery mechanism  
* Support two execution modes via HARNESS\_QSTASH\_MODE env var:  
  * stub — replaces scheduleOnboardingStep with a direct synchronous call to /api/onboarding/step; suitable for local development and CI; no real QStash network calls  
  * real — publishes to QStash with real QSTASH\_TOKEN and observes actual delayed delivery; suitable for full staging E2E validation  
* Stub mode must assert:  
  * Correct state\_token after each step  
  * Correct sms\_messages row created for each step (idempotency\_key present, Twilio SID non-null)  
  * Zero sms\_outbound\_jobs rows created for burst steps  
  * Full sequence completes: Messages 1, 2, 3, 4 in order  
* Real mode must assert:  
  * Correct ordering: Message 1 delivered before Message 2 before Message 3  
  * Timing: Message 2 arrives no earlier than 6 seconds after Message 1 (8s target, 2s tolerance); Message 3 no earlier than 6 seconds after Message 2  
  * Poll sms\_messages for each step row with a 60-second timeout per step before failing the assertion  
* Existing harness capabilities that must be preserved in both modes:  
  * Reset onboarding state to a clean baseline (clear session, reset profile state, delete sms\_messages rows for the test user)  
  * Simulate an inbound affirmative reply at each reply-gated step  
  * Verify idempotency: submit the same step payload twice, assert exactly one sms\_messages row  
* Remove all harness code that seeds sms\_outbound\_jobs for onboarding burst steps — this mechanism is no longer correct and seeding it would produce false positives in tests

Deliverables:

* Updated scripts/staging-onboarding-e2e.mjs (stub \+ real mode support)  
* Updated .env.example (HARNESS\_QSTASH\_MODE documented)  
* Updated docs/runbooks/environment-contract.md (HARNESS\_QSTASH\_MODE added)  
* Updated docs/testing/e2e-staging-checklist.md — Scenario 1 (New User Onboarding Burst) rewritten to reflect QStash delivery and timing assertions

Verification:

* pnpm staging:onboarding:e2e with HARNESS\_QSTASH\_MODE=stub completes without assertion failures  
* pnpm staging:onboarding:e2e with HARNESS\_QSTASH\_MODE=real completes with timing assertions passing (≥6 second gap between Messages 1/2 and 2/3)  
* Harness reset followed by immediate re-run produces identical results (no state bleed between runs)  
* Idempotency assertion: step payload submitted twice → exactly one sms\_messages row, no duplicate Twilio send

---

### Ticket 8B.5 — Cleanup, Guardrails, And Operational Runbook

Goal: Remove all remnants of the Phase 8.3 delivery mechanism, add automated guardrails that prevent accidental reintroduction of the old pattern, and produce a runbook for operating and debugging the QStash onboarding scheduler.

Background:

Three things must happen to close out this migration cleanly. First, the setTimeout-based delay code from Phase 8.3 must be removed — leaving it in place creates confusion about the delivery model and risks reactivation. Second, automated guardrail tests must assert the invariants of the new architecture so that future changes that accidentally violate them fail CI immediately rather than in production. Third, an operational runbook must document how to debug, replay, and safely disable the QStash onboarding scheduler in staging — without this, a stuck session or failed delivery has no documented recovery path.

Requirements:

* Remove in-process delay code:

  * Remove all setTimeout-based delay calls from:  
    * packages/core/src/onboarding/onboarding-engine.ts  
    * Any other file containing onboarding-specific timing delays  
  * grep \-r "setTimeout" \--include="\*.ts" packages/core/src/onboarding/ must return zero results after this ticket  
  * Remove any temporary flags, feature switches, or dead code paths added in Phase 8.3 for the old delivery mechanism  
  * Update the module-level JSDoc in onboarding-engine.ts to describe the QStash sequential scheduling architecture, not the deprecated model  
* Add guardrail tests (in tests/guardrails/onboarding-architecture.test.ts):

  * No multi-step enqueue: assert that the onboarding engine never creates more than one sms\_outbound\_jobs row during the burst window — if it does, the test fails with a clear message ("burst enqueue detected — use QStash scheduling")  
  * No in-process sleep: static analysis assertion that no setTimeout or equivalent call exists in packages/core/src/onboarding/ — if found, test fails with a clear message ("in-process sleep detected — use QStash delay parameter")  
  * These tests must run as part of pnpm test and block CI on failure  
* Create docs/runbooks/qstash-onboarding-scheduler.md covering:

  * Architecture overview: one-step-per-execution loop, state token as source of truth, idempotency key format  
  * Required environment variables and where to find them (Upstash dashboard)  
  * How to manually replay a stuck onboarding step:  
    * POST to /api/onboarding/step with the correct payload  
    * What to check if the step was already sent (idempotency — it is safe to replay)  
    * How to reset state\_token in the DB to allow re-initiation  
  * How to disable onboarding scheduling in staging safely:  
    * Rotate or nullify QSTASH\_TOKEN — new QStash publishes will fail  
    * Existing in-flight QStash messages will still deliver to the handler unless the handler returns 401 (signature key rotation also needed)  
    * Recommended: set a ONBOARDING\_SCHEDULING\_DISABLED flag checked in scheduleOnboardingStep that returns early without publishing  
  * How to verify correct delivery timing: query sms\_messages ordered by created\_at for the test user, check timestamps between burst steps

Deliverables:

* Updated packages/core/src/onboarding/onboarding-engine.ts (setTimeout removed, JSDoc updated)  
* Confirmation: grep returns zero results for setTimeout in onboarding/  
* tests/guardrails/onboarding-architecture.test.ts (two guardrail tests)  
* docs/runbooks/qstash-onboarding-scheduler.md

Verification:

* grep \-r "setTimeout" \--include="\*.ts" packages/core/src/onboarding/ returns zero results  
* pnpm typecheck passes after all removals  
* pnpm test passes, including both guardrail tests  
* Introducing a deliberate sms\_outbound\_jobs burst enqueue in a test branch causes the guardrail test to fail with the correct message  
* Introducing a deliberate setTimeout in onboarding-engine.ts causes the guardrail test to fail with the correct message  
* Manual replay procedure in the runbook executed against staging produces one SMS without duplicates

---

## Phase Acceptance Criteria

This phase is complete when all of the following are true:

1. Opening message sends alone, delivered at waitlist activation.  
2. No second message is sent until an affirmative inbound reply is recorded.  
3. After affirmative reply to explanation, Messages 1, 2, 3 arrive with consistent \~8-second spacing. Message 4 arrives immediately after Message 3\.  
4. No duplicate messages under QStash retries, overlapping triggers, or manual replay.  
5. No burst sends — at most one onboarding message is delivered per scheduled execution.  
6. pnpm staging:onboarding:e2e (both stub and real mode) passes.  
7. Both guardrail tests pass in CI.  
8. The operational runbook is complete and the manual replay procedure has been verified in staging.