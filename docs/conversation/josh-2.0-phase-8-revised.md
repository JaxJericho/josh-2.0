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