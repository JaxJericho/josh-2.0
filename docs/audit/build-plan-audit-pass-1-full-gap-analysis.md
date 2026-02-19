\# Build Plan Audit — Pass 1: Full Gap Analysis

\#\# Methodology

All 11 spec documents, the comprehensive build plan, all authoritative docs, and the codebase (packages, supabase functions, migrations, tests) were inspected. Each phase below is the \*\*old phase number\*\* from the build plan, with the \*\*new phase number\*\* (after the Phase 8 SMS Redesign insertion) noted in brackets.

\---

\#\# Phase 8 (old) → Phase 9 (new): Post-Event \+ Contact Exchange

\#\#\# Ticket 8.1 — Post-Event Outcome Collection

\*\*Question A (Accuracy):\*\*

\*\*FLAGGED.\*\* The ticket says "Post-event runner" and "Outcome tables." The outcome tables already exist (\`linkup\_outcomes\` schema is in migrations). The runner does NOT exist — no post-event engine, no handler for post-event SMS prompts, no post-event step catalog implementation. The ticket is accurate in intent but understates the work: it assumes the conversation system can already send multi-step SMS flows (attendance → do-again → feedback), but after the redesign, post-event flows must use the \*\*new conversation engine and in-process sequential delivery pattern\*\* from Phase 8\. The ticket doesn't acknowledge this dependency.

\*\*Question B (Depth):\*\*

\*\*FLAGGED — significantly below Phase 8 standard.\*\* Compare to Phase 8 tickets which specify: exact files to create/modify, exact message content, state token formats, edge cases, and concrete verification steps. This ticket says only "Post-event runner / Outcome tables / Responses stored and associated to LinkUp." It does not specify:

\- Which files to create (post-event engine, post-event messages, post-event step definitions)

\- How post-event SMS prompts conform to the conversation behavior spec (state tokens, session modes)

\- The post-event step catalog from Doc 8 (5 steps: \`POST\_EVENT\_ATTENDANCE\`, \`POST\_EVENT\_DO\_AGAIN\`, \`POST\_EVENT\_FEEDBACK\`, \`POST\_EVENT\_CONTACT\_EXCHANGE\_INTRO\`, \`POST\_EVENT\_CONTACT\_EXCHANGE\_CHOICES\`)

\- Timing: \`POST\_EVENT\_BUFFER\` (2hrs), \`COLLECTION\_WINDOW\` (7 days)

\- Idempotency keys per prompt type (Doc 8 specifies these)

\- How the post-event flow is triggered (Vercel Cron runner scanning for \`locked\` LinkUps past \`event\_time \+ buffer\`)

\- How dropout recovery works mid-post-event flow

\- What happens when a user is on safety hold during post-event

\- Verification steps beyond "responses stored"

\*\*Question C (Missing work):\*\*

\- \*\*Missing:\*\* A post-event conversation engine (analogous to \`profile-interview-engine.ts\` and \`onboarding-engine.ts\`) that integrates with the new conversation router

\- \*\*Missing:\*\* Post-event message templates conforming to the new conversation behavior spec / JOSH voice

\- \*\*Missing:\*\* State token format for post-event mode (e.g., \`"post\_event:attendance"\`, \`"post\_event:do\_again"\`)

\- \*\*Missing:\*\* Session mode \`post\_event\` in the conversation router (Doc 4 lists modes but doesn't include post-event; the router needs updating)

\- \*\*Missing:\*\* Cron job / runner that detects eligible LinkUps and initiates post-event flows

\- \*\*Missing:\*\* Integration with learning signals (Doc 10: do-again pulse and feedback feed learning)

\*\*Question D (Dependencies):\*\*

\*\*FLAGGED.\*\* This ticket has no stated dependency on the new Phase 8\. It MUST depend on:

\- Phase 8.2 (Conversation Router \+ Engine Scaffold) — post-event needs the engine pattern

\- Phase 8.3 (In-Process Sequential Delivery) — post-event sends multiple back-to-back prompts

\- Phase 8.5 (Conversation Behavior Spec) — post-event messages must follow JOSH voice rules

\*\*Question E (Redesign conflicts):\*\*

The old ticket assumed TwiML-based single responses. The new Phase 8 establishes in-process sequential delivery via Twilio REST API. Post-event flows that send attendance → do-again → feedback → contact exchange intro in sequence MUST use the new delivery pattern. No direct conflict, but the implementation approach changes significantly.

\---

\#\#\# Ticket 8.2 — Mutual Contact Exchange

\*\*Question A (Accuracy):\*\*

\*\*FLAGGED.\*\* The ticket says "Mutual consent flow / Safety gate before reveal." The schema exists (\`contact\_exchange\_choices\`, \`contact\_exchanges\`), but NO implementation exists: no mutual-yes detection, no reveal messaging, no choice collection handler. The ticket is accurate in intent but drastically underscoped.

\*\*Question B (Depth):\*\*

\*\*FLAGGED — significantly below Phase 8 standard.\*\* Missing:

\- Choice collection SMS flow (per-participant, per-target choices)

\- Mutual detection logic (Doc 8: check both directions, create exchange row atomically)

\- Reveal message content ("Hey {Name}, {OtherName} wants to stay in touch\! Here's their number: {phone}")

\- Timing: reveal only after both choices collected, within collection window

\- What happens when one user says yes and the other hasn't responded yet (wait, don't reveal)

\- What happens when a user changes yes→no before reveal (allowed per Doc 8\)

\- Safety re-check at reveal time (block/hold suppresses reveal immediately)

\- Dashboard fallback for viewing/completing exchange choices

\- Idempotency for reveal messaging (prevent double-send of phone numbers)

\- Verification beyond "one-sided yes reveals nothing"

\*\*Question C (Missing work):\*\*

\- \*\*Missing:\*\* Contact exchange choice collection handler (SMS parser for yes/no per target)

\- \*\*Missing:\*\* Mutual detection function (atomic check-and-create)

\- \*\*Missing:\*\* Reveal message sender with safety gate

\- \*\*Missing:\*\* Dashboard UI for contact exchange status and choices

\- \*\*Missing:\*\* Edge case: what if a participant blocked another participant between lock and post-event?

\- \*\*Missing:\*\* Edge case: what if the contact exchange window expires with one yes and one non-response?

\*\*Question D (Dependencies):\*\*

Same as 8.1 — must depend on new Phase 8 conversation engine and delivery pattern. Also depends on:

\- Phase 10 (Safety) for block/hold checks at reveal time

\- Phase 8.1 (post-event runner) since contact exchange is part of the post-event flow

\*\*Question E (Redesign conflicts):\*\*

Same as 8.1 — delivery mechanism changes.

\---

\#\# Phase 9 (old) → Phase 10 (new): Safety System

\#\#\# Ticket 9.1 — STOP/HELP \+ Keyword Rules \+ Holds

\*\*Question A (Accuracy):\*\*

\*\*PARTIALLY ACCURATE.\*\* STOP/HELP handling is already implemented in \`supabase/functions/twilio-inbound/index.ts\` — the inbound handler checks for STOP-like messages before routing. Safety tables exist (\`safety\_incidents\`, \`safety\_holds\`, \`user\_blocks\`, \`user\_reports\`, \`user\_strikes\`). Safety hold checking is implemented at key gates (matching, LinkUp lock). \*\*However\*\*, the following are NOT implemented:

\- Keyword detection (no keyword list, no normalized matching, no category mapping)

\- Rate limiting (no per-user message rate limits)

\- Strike escalation logic (tables exist but no application code)

\- Crisis routing (no self-harm keyword response, no crisis resource messaging)

\- Hold application from keyword triggers (hold checks exist at gates, but no code to CREATE holds from triggers)

The ticket says "STOP/HELP handlers" as a deliverable, but these are already built. The ticket should focus on what's actually missing.

\*\*Question B (Depth):\*\*

\*\*FLAGGED — significantly below Phase 8 standard.\*\* Doc 13 specifies extensive detail: 6 keyword categories, matching rules (normalized text, bounded keyword list with versioning), response rules per severity level, escalation ladder (low→medium→high→critical), rate limit thresholds (messages per minute, linkup attempts per day), crisis routing with country-specific resources, idempotency keys for incidents. The ticket reduces all of this to three bullet points.

Missing specifics:

\- Which files to create/modify

\- Keyword list schema and versioning approach

\- Severity computation rules

\- Rate limit thresholds (Doc 13: inbound per user per minute, outbound per user per minute, linkup initiation per day)

\- Crisis routing message content

\- Idempotency keys (Doc 13: \`incident:{message\_sid}\`, \`hold:{user\_id}:{hold\_type}:{reason\_code}\`)

\- Where in the inbound pipeline keyword detection runs (before or after intent classification)

\- How safety interacts with the new conversation engine from Phase 8

\*\*Question C (Missing work):\*\*

\- \*\*Missing:\*\* Keyword list management (versioned, admin-updatable)

\- \*\*Missing:\*\* Rate limiter implementation

\- \*\*Missing:\*\* Strike accumulation and decay logic

\- \*\*Missing:\*\* Crisis routing handler with resource messages

\- \*\*Missing:\*\* Safety event emission for observability (Doc 5: \`safety.keyword\_hit\`, \`safety.incident\_created\`, \`safety.hold\_applied\`)

\- \*\*Missing:\*\* Integration with post-event flow (safety during contact exchange)

\- \*\*Missing:\*\* How safety keywords interact with the new conversation router — does keyword detection happen in the edge function before the router, or inside the router? The new Phase 8 router must accommodate this.

\*\*Question D (Dependencies):\*\*

\*\*FLAGGED.\*\* The ticket should depend on Phase 8 because:

\- The conversation router is being rewritten in Phase 8.2 — safety keyword detection must be wired into the NEW router, not the old one

\- The new Phase 8 STOP/HELP handling may change how precedence routing works

\- Rate limiting during the interview/onboarding flow needs to consider the new session model

\*\*Question E (Redesign conflicts):\*\*

\*\*POTENTIAL CONFLICT.\*\* The existing STOP/HELP handling in \`twilio-inbound/index.ts\` runs in the Supabase edge function. If Phase 8 moves conversation handling into a new architecture, safety precedence routing must move with it (or be confirmed to remain in the same location). The ticket needs to specify where safety intercepts happen relative to the new router.

\---

\#\#\# Ticket 9.2 — Block/Report Flows

\*\*Question A (Accuracy):\*\*

\*\*PARTIALLY ACCURATE.\*\* Block and report tables exist (\`user\_blocks\`, \`user\_reports\`). Block exclusion is enforced in matching candidate selection. However, there is no SMS command parsing for "BLOCK" or "REPORT", no guided report flow, no admin review queue, and no incident creation from reports.

\*\*Question B (Depth):\*\*

\*\*FLAGGED.\*\* Missing:

\- SMS command parsing for block/report (how does a user trigger this? Doc 13 says "REPORT \[name/number\]" or guided prompts)

\- Target identification logic (Doc 13: fall back to "last LinkUp" context, ask one clarifier if unclear)

\- Reason category selection flow (one prompt with categories)

\- Incident creation from report

\- Hold application policy (when does a report trigger a hold?)

\- Dashboard report button implementation

\- Admin review queue views (separate from admin dashboard ticket?)

\- Confirmation messaging to reporter

\- Verification beyond "blocked pairs never match"

\*\*Question C (Missing work):\*\*

\- \*\*Missing:\*\* How block/report integrates with the conversation engine — does it need its own session mode, or is it handled as a special intent within the existing router?

\- \*\*Missing:\*\* What happens if a user tries to block someone they haven't been in a LinkUp with?

\*\*Question D (Dependencies):\*\*

Depends on Phase 8 conversation router for intent detection of BLOCK/REPORT intents. Also depends on Phase 11 (Admin Dashboard) for the review queue — or should the review queue be part of this ticket?

\*\*Question E (Redesign conflicts):\*\*

Block/report intent detection must work within the new intent taxonomy from the redesigned router (Phase 8.2). The current intent taxonomy in Doc 4 already includes handling for these, but the new router implementation may change how intents are classified.

\---

\#\# Phase 10 (old) → Phase 11 (new): Admin Dashboard (PWA)

\#\#\# Ticket 10.1 — Admin Auth \+ RBAC

\*\*Question A (Accuracy):\*\*

\*\*BROADLY ACCURATE\*\* but vague. There is an \`admin\_users\` table in the schema. No admin auth implementation exists in the codebase. The ticket correctly identifies the need.

\*\*Question B (Depth):\*\*

\*\*FLAGGED.\*\* Missing:

\- Auth mechanism specifics (Supabase Auth? Custom JWT? Magic link?)

\- Role definitions (Doc 5 mentions \`engineering\` role for replays; Doc 13 mentions admin roles for safety)

\- Which routes need protection (admin API routes, admin dashboard pages)

\- Session management

\- How admin auth differs from member auth (if any)

\- Audit log schema and what triggers audit entries

\- Verification beyond "only admins can access admin routes"

\*\*Question C (Missing work):\*\*

\- \*\*Missing:\*\* Admin session/auth middleware for Next.js

\- \*\*Missing:\*\* Role hierarchy definition (e.g., \`viewer\`, \`operator\`, \`engineering\`, \`super\_admin\`)

\*\*Question D (Dependencies):\*\*

No Phase 8 dependency needed. This is independent.

\*\*Question E (Redesign conflicts):\*\*

None.

\---

\#\#\# Ticket 10.2 — Admin Ops Views

\*\*Question A (Accuracy):\*\*

\*\*ACCURATE\*\* in listing the views needed, but extremely vague on implementation.

\*\*Question B (Depth):\*\*

\*\*FLAGGED — the most underspecified ticket for the amount of work involved.\*\* Six views listed, each is a significant feature:

1\. Users and profiles — needs profile detail view, interview progress, fingerprint visualization

2\. Messaging timeline and resend tools — needs SMS history per user, resend capability (Doc 5: admin replay tools)

3\. LinkUps and state — needs LinkUp list, state visualization, participant details

4\. Safety incidents and holds — needs incident queue filtered by severity/status, hold management, user history (Doc 13 triage workflow)

5\. Billing status — needs subscription state, entitlement overrides

6\. Regions and waitlist — needs region status management, waitlist batch notify

Missing:

\- Which admin views support the new conversation system (viewing onboarding progress, interview state, conversation history)

\- Incident triage workflow (Doc 13: assign → triage → resolve → document)

\- Admin replay tools for stuck outbound jobs and LinkUps (Doc 5\)

\- User suspension/unsuspension flow

\- Entitlement override UI (Doc 11: admin overrides)

\*\*Question C (Missing work):\*\*

\- \*\*Missing:\*\* Admin view for conversation/session state (new in Phase 8 — admin should be able to see a user's current session mode, state token, and onboarding/interview progress)

\- \*\*Missing:\*\* Admin tool to manually advance or reset a user's conversation state

\- \*\*Missing:\*\* Dashboard for new observability events from Phase 8

\*\*Question D (Dependencies):\*\*

Depends on Phase 10 (Safety, ticket 9.1/9.2) for safety views. Should note dependency on new Phase 8 for conversation state visibility.

\*\*Question E (Redesign conflicts):\*\*

The messaging timeline view must account for the new message delivery pattern (in-process sequential delivery, multi-message bursts). Admin needs to understand the new conversation model to effectively debug issues.

\---

\#\# Phase 11 (old) → Phase 12 (new): Observability \+ Ops

\#\#\# Ticket 11.1 — Structured Logging \+ Correlation IDs

\*\*Question A (Accuracy):\*\*

\*\*PARTIALLY IMPLEMENTED.\*\* The codebase already has a structured logging framework. Correlation IDs exist in some paths (twilio-inbound handler). The ticket is still needed for completeness, but should acknowledge existing work and focus on gaps.

\*\*Question B (Depth):\*\*

\*\*FLAGGED.\*\* Doc 5 specifies 30+ canonical log events across 7 categories (inbound SMS, outbound SMS, LLM, LinkUp, billing, safety, admin). The ticket says only "Correlation ID middleware / JSON logs." Missing:

\- Which canonical events to implement (Doc 5 provides the full list)

\- PII redaction rules (Doc 5: never log raw SMS bodies, never log full phone numbers)

\- Log destination configuration (Vercel logs baseline \+ external sink)

\- Required log keys (\`ts\`, \`level\`, \`event\`, \`env\`, \`correlation\_id\` \+ optional fields)

\- New events needed for Phase 8 redesign: \`onboarding.burst\_sent\`, \`interview.llm\_extraction\`, \`interview.regex\_parse\`, \`interview.step\_advanced\`, \`conversation.session\_mode\_changed\`

\*\*Question C (Missing work):\*\*

\- \*\*Missing:\*\* Log events for the new onboarding and interview flows from Phase 8

\- \*\*Missing:\*\* PII redaction utilities (Doc 5 requires them)

\- \*\*Missing:\*\* Log sink configuration for production

\*\*Question D (Dependencies):\*\*

Should note that Phase 8 introduces new log event categories that must be included.

\*\*Question E (Redesign conflicts):\*\*

The canonical log event list from Doc 5 was written before the Phase 8 redesign. New events for onboarding bursts, LLM extraction (now primary instead of fallback), and conversation session transitions need to be added.

\---

\#\#\# Ticket 11.2 — Error Tracking

\*\*Question A (Accuracy):\*\*

\*\*ACCURATE.\*\* No Sentry or error tracking exists in the codebase.

\*\*Question B (Depth):\*\*

\*\*FLAGGED.\*\* Doc 5 specifies: Sentry configuration for Next.js (client \+ server), severity levels (fatal/error/warning/info), 12 event categories with specific tags, PII rules (never send raw SMS body, never send full phone numbers), performance monitoring with span recording, sampling rates (100% staging, 10-25% production). The ticket says only "Error tracking integration / Alert routing."

\*\*Question C (Missing work):\*\*

\- \*\*Missing:\*\* Sentry event categories and tagging rules

\- \*\*Missing:\*\* PII scrubbing configuration

\- \*\*Missing:\*\* Performance trace configuration

\- \*\*Missing:\*\* Integration with new Phase 8 LLM calls (LLM invalid JSON responses should be captured)

\*\*Question D (Dependencies):\*\*

None specific to Phase 8, though error tracking should cover new Phase 8 code paths.

\*\*Question E (Redesign conflicts):\*\*

None directly, but the Sentry categories should include the new Phase 8 event types.

\---

\#\#\# Ticket 11.3 — Metrics \+ Alerting

\*\*Question A (Accuracy):\*\*

\*\*ACCURATE.\*\* No metrics adapter, dashboards, or alerting exists.

\*\*Question B (Depth):\*\*

\*\*FLAGGED.\*\* Doc 5 specifies: 17 counters, 6 histograms, 3 gauges, 4 dashboards (product health, reliability, safety, cost), alert thresholds (critical/high/medium), escalation procedures. The ticket says only "Metrics emitter / Dashboards / Alerts" with 4 example metrics.

Missing:

\- Full metrics catalog from Doc 5

\- Dashboard specifications

\- Alert threshold configuration

\- Cost tracking (Twilio, Stripe, Supabase, LLM)

\- New metrics for Phase 8: onboarding completion rate, interview completion rate, LLM extraction success rate, regex-vs-LLM parse ratio

\*\*Question C (Missing work):\*\*

\- \*\*Missing:\*\* Metrics for the new Phase 8 conversation system

\- \*\*Missing:\*\* Cost tracking for LLM calls (now primary in interview, significant cost impact)

\*\*Question D (Dependencies):\*\*

Should reference Phase 8 for new metric categories.

\*\*Question E (Redesign conflicts):\*\*

LLM cost tracking becomes much more important after Phase 8 makes LLM extraction primary instead of fallback. The metrics plan should account for this.

\---

\#\# Phase 12 (old) → Phase 13 (new): Testing \+ E2E Harness

\#\#\# Ticket 12.1 — Twilio Simulator Harness

\*\*Question A (Accuracy):\*\*

\*\*ACCURATE.\*\* No Twilio simulator exists. The codebase has unit tests but no end-to-end SMS simulation.

\*\*Question B (Depth):\*\*

\*\*FLAGGED.\*\* The ticket says only "scripts/simulate-twilio.mjs." Missing:

\- What the simulator actually does (sends fake inbound webhooks with Twilio signature? Captures outbound?)

\- Whether it simulates the new in-process sequential delivery pattern

\- Whether it can simulate multi-turn conversations (onboarding → interview full flow)

\- Whether it validates Twilio signature verification

\- Status callback simulation

\*\*Question C (Missing work):\*\*

\- \*\*Missing:\*\* The simulator must support the new Phase 8 conversation patterns: multi-message bursts, 8-second delays, session mode transitions

\- \*\*Missing:\*\* Simulator for post-event flow

\- \*\*Missing:\*\* Simulator for safety keyword triggers

\*\*Question D (Dependencies):\*\*

\*\*FLAGGED.\*\* Must depend on Phase 8 — the simulator needs to model the new conversation flow, not the old one.

\*\*Question E (Redesign conflicts):\*\*

The old TwiML-based response model is fundamentally different from the new in-process delivery model. A simulator built for the old model won't test the right things. The simulator must account for REST API sends with delays, not synchronous TwiML responses.

\---

\#\#\# Ticket 12.2 — E2E Staging Validation

\*\*Question A (Accuracy):\*\*

\*\*PARTIALLY ACCURATE.\*\* The scenarios listed are correct but incomplete. The list includes "New user onboarding" and "Profile update" but doesn't mention the new onboarding burst, adaptive interview, or LLM extraction — all new Phase 8 behaviors.

\*\*Question B (Depth):\*\*

\*\*FLAGGED.\*\* The ticket lists 7 scenarios with no detail on what "pass" means for each. Missing:

\- Step-by-step validation for onboarding flow (3-message burst → consent → interview start)

\- Validation that LLM extraction produces correct profile patches

\- Validation of signal coverage tracker and MVP completeness transition

\- Validation of conversation session mode transitions

\- Validation of dropout recovery (user stops mid-interview, returns later)

\*\*Question C (Missing work):\*\*

\- \*\*Missing:\*\* E2E scenario for the full onboarding → interview → complete\_mvp flow (the core Phase 8 experience)

\- \*\*Missing:\*\* E2E scenario for interview dropout recovery

\- \*\*Missing:\*\* E2E scenario for in-process sequential delivery (multi-message bursts)

\- \*\*Missing:\*\* E2E scenario for LLM extraction failure → regex fallback

\*\*Question D (Dependencies):\*\*

\*\*FLAGGED.\*\* Depends on Phase 8 for the new conversation flows that must be validated.

\*\*Question E (Redesign conflicts):\*\*

The scenarios need updating to reflect the new Phase 8 conversation architecture. "New user onboarding" is no longer just "answer interview questions" — it's "receive 3-message onboarding burst → consent → adaptive interview with LLM extraction."

\---

\#\# Phase 13 (old) → Phase 14 (new): Production Provisioning \+ Deployment

\#\#\# Ticket 13.1 — Production Supabase Provisioning

\*\*Question A:\*\* Accurate. No changes needed from redesign.

\*\*Question B:\*\* Adequate for scope (runbook deliverable).

\*\*Question C:\*\* Nothing missing.

\*\*Question D:\*\* No Phase 8 dependency.

\*\*Question E:\*\* No conflicts.

\#\#\# Ticket 13.2 — Production Vercel Setup

\*\*Question A:\*\* Accurate.

\*\*Question B:\*\* Adequate.

\*\*Question C:\*\* Should mention that Anthropic API key must be in production env vars (Phase 8 makes LLM calls primary, not just fallback). The build plan's original key decisions say "LLM provider: OpenAI first" but the codebase uses Anthropic — this discrepancy should be noted.

\*\*Question D:\*\* No direct Phase 8 dependency, but env vars for Anthropic must be provisioned.

\*\*Question E:\*\* No conflicts.

\#\#\# Ticket 13.3 — Production Twilio Wiring

\*\*Question A:\*\* Accurate.

\*\*Question B:\*\* Adequate.

\*\*Question C:\*\* Should verify that production Twilio supports the new in-process delivery pattern (REST API sends, not just TwiML responses). A2P compliance for the new message patterns (multi-message bursts) should be validated.

\*\*Question D:\*\* Phase 8 changes message delivery patterns, which may affect Twilio configuration.

\*\*Question E:\*\* The new delivery pattern (REST API sends with delays) may require different Twilio messaging service configuration than TwiML-only.

\#\#\# Ticket 13.4 — Production Stripe Wiring

\*\*Question A:\*\* Accurate. No changes needed from redesign.

\*\*Question B:\*\* Adequate.

\*\*Question C:\*\* Nothing missing.

\*\*Question D:\*\* No Phase 8 dependency.

\*\*Question E:\*\* No conflicts.

\#\#\# Ticket 13.5 — Launch Checklist \+ Cutover

\*\*Question A:\*\* Accurate but incomplete.

\*\*Question B:\*\* \*\*FLAGGED.\*\* The checklist should include:

\- Verify onboarding burst sends correctly in production

\- Verify LLM extraction works in production (Anthropic API connectivity)

\- Verify interview flow completes and produces \`complete\_mvp\` profiles

\- Verify in-process sequential delivery timing

\- Smoke test the full new user flow (sign up → onboarding → interview → active)

\*\*Question C (Missing work):\*\*

\- \*\*Missing:\*\* LLM provider connectivity verification

\- \*\*Missing:\*\* Smoke test for the new Phase 8 conversation flow specifically

\*\*Question D:\*\* Should reference Phase 8 as the core user experience that must be verified at launch.

\*\*Question E:\*\* No conflicts, but the launch checklist needs updating.

\---

\#\# Cross-Phase Gaps

\#\#\# Gap 1: No Session Mode for Post-Event Flow

The conversation router (Phase 8.2) defines session modes for \`onboarding\`, \`interviewing\`, and potentially \`linkup\_forming\`. There is no mention of a \`post\_event\` session mode. Post-event flows (Phase 9 new) send multi-step SMS sequences that need the same conversation engine infrastructure. Either Phase 8 needs to anticipate this mode, or Phase 9 needs to define it.

\#\#\# Gap 2: Matching Run Orchestration Is Unaccounted For

The compatibility scoring engine exists (\`packages/core/src/compatibility/\`), but there is \*\*no match run orchestration\*\* in the codebase. Phase 7 Ticket 7.1 says "Match runs \+ Candidate scoring" but there's no runner that: scans for eligible users, builds candidate pools, runs compatibility scoring, and produces ranked candidate lists for LinkUp orchestration. This was supposed to be done in Phase 7, but the codebase shows only the scoring functions — not the orchestration. This gap affects Phase 9 (Post-Event) and Phase 10 (Safety) because they depend on matching working correctly.

\#\#\# Gap 3: LLM Provider Discrepancy

The build plan says "LLM provider: OpenAI first." The codebase uses Anthropic (Claude 3.5 Haiku) exclusively via \`packages/llm/src/provider.ts\`. Phase 8 makes LLM primary. This discrepancy should be resolved — either update the build plan to reflect Anthropic, or explain why.

\#\#\# Gap 4: Post-Event → Learning Signal Pipeline Missing

Doc 10 (Learning and Adaptation) expects learning signals from post-event outcomes (attendance, do-again, feedback). Phase 9 (Post-Event, new numbering) collects these signals, but there is no ticket that wires post-event outcomes INTO the learning system. The learning system tables exist (\`learning\_signals\`, \`user\_derived\_state\`) but no ticket connects the dots.

\#\#\# Gap 5: \`packages/db/\` and \`packages/messaging/\` Never Created

The build plan's repo structure specifies \`packages/db/\` (typed DB client, migrations helpers) and \`packages/messaging/\` (Twilio helpers, idempotency, templates). Neither exists in the codebase. DB access happens directly via Supabase client in edge functions. Twilio sends happen via REST API in the onboarding engine. The build plan either needs to acknowledge these packages were descoped, or tickets need to exist to create them.

\#\#\# Gap 6: Conversation Mode Transitions After Phase 8

Phase 8 establishes the conversation router with mode transitions (onboarding → interviewing → idle). But when a user receives a LinkUp invite and replies, the router needs to enter \`awaiting\_invite\_reply\` mode. When a user receives a post-event prompt, the router needs to enter \`post\_event\` mode. These mode transitions aren't fully mapped out — each subsequent phase that adds SMS interactions needs to register its mode with the conversation router. There's no ticket that ensures this integration.

\#\#\# Gap 7: Dashboard Member Experience Gap

The build plan has no ticket for the \*\*member dashboard\*\* updates needed after Phase 8\. Phase 8 changes how profiles are built (adaptive interview with LLM extraction). The member dashboard should show interview progress, profile completeness, and allow profile updates. Ticket 4.3 (Profile Update Flow) exists in Phase 4 but may need revision for the new interview structure.

\---

\#\# Priority Flags (Top 8\)

\#\#\# 🔴 P1: Post-Event Tickets (8.1, 8.2) Are Critically Underspecified

\*\*Risk: These tickets will produce incomplete implementations that must be reworked.\*\*

Both tickets combined represent roughly 3-4 tickets worth of work at the Phase 8 standard. They need: a post-event engine, message templates, state token format, session mode registration, cron runner, mutual detection logic, reveal messaging, safety gates, idempotency keys, and dashboard UI. Recommend splitting into 4+ tickets at Phase 8 depth.

\#\#\# 🔴 P2: Post-Event and Safety Phases Have No Dependency on New Phase 8

\*\*Risk: Implementers will build against the old architecture and have to rework.\*\*

Phases 9 and 10 (new numbering) both involve SMS interactions that must use the new conversation engine, router, and delivery pattern from Phase 8\. Neither ticket mentions this dependency. Every phase that sends SMS must be reviewed against the Phase 8 architecture.

\#\#\# 🔴 P3: Match Run Orchestration Gap

\*\*Risk: LinkUp orchestration cannot source candidates without a match run runner.\*\*

The compatibility scorer exists but nothing orchestrates match runs. This should have been completed in Phase 7 but isn't in the codebase. It blocks LinkUp formation end-to-end.

\#\#\# 🟡 P4: Safety Ticket 9.1 Misrepresents Existing State

\*\*Risk: Wasted effort re-implementing STOP/HELP; missing effort on keyword detection, rate limiting, crisis routing.\*\*

STOP/HELP already works. The ticket should be refocused on the actually-missing pieces: keyword detection, rate limiting, strike escalation, and crisis routing. These are each substantial implementations.

\#\#\# 🟡 P5: Observability Tickets Are Far Below Spec Depth

\*\*Risk: Observability will be partial and miss the new Phase 8 event categories.\*\*

Doc 5 is one of the most detailed specs (507 lines). The three observability tickets combined have \~30 lines in the build plan. The gap between spec depth and ticket depth is the largest of any phase.

\#\#\# 🟡 P6: E2E Testing Scenarios Don't Reflect New Architecture

\*\*Risk: Tests validate the old flow, miss regressions in the new Phase 8 flow.\*\*

Ticket 12.2's scenarios need updating for: onboarding burst, LLM extraction, signal coverage, dropout recovery, and in-process sequential delivery. The Twilio simulator (12.1) also needs to support the new delivery pattern.

\#\#\# 🟡 P7: LLM Provider Discrepancy Is Unresolved

\*\*Risk: Confusion during implementation about which LLM provider to use.\*\*

Build plan says OpenAI. Codebase uses Anthropic. Phase 8 makes LLM primary. This needs an explicit decision recorded in the build plan.

\#\#\# 🟡 P8: Missing \`packages/db/\` and \`packages/messaging/\` Packages

\*\*Risk: Architectural debt — direct Supabase calls and inline Twilio logic will be harder to maintain.\*\*

The planned repo structure includes these packages but they were never created. Either create them as part of a ticket, or formally descope them and update the build plan.

\---

\#\# Summary Statistics

| Phase (new \#) | Phase Name | Tickets | Accuracy Issues | Depth Issues | Missing Work | Dependency Issues | Redesign Conflicts |

|---|---|---|---|---|---|---|---|

| 9 | Post-Event \+ Contact Exchange | 2 | 2 | 2 | 2 (significant) | 2 | 2 |

| 10 | Safety System | 2 | 2 | 2 | 2 (significant) | 2 | 1 |

| 11 | Admin Dashboard | 2 | 0 | 2 | 1 | 1 | 1 |

| 12 | Observability \+ Ops | 3 | 1 | 3 | 3 | 1 | 1 |

| 13 | Testing \+ E2E | 2 | 1 | 2 | 2 | 2 | 2 |

| 14 | Production Provisioning | 5 | 0 | 1 | 1 | 1 | 1 |

\*\*Total flagged findings: 41 across 16 tickets and 7 cross-phase gaps.\*\*

