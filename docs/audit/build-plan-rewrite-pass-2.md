# Build Plan Audit — Pass 2: Rewritten Phases

---

## Build Plan Introduction Update

Replace the existing "Key Calls" bullet for LLM provider and update surrounding context:

> **LLM provider: Anthropic (Claude 3.5 Haiku).** The codebase uses Anthropic exclusively via `packages/llm/src/provider.ts`. All interview extraction, intent classification, and future LLM calls use the Anthropic Messages API. There is no OpenAI dependency and none is planned.

Additional introduction changes:

* Phase 8 is now **SMS Conversation Redesign (Onboarding + Interview)** — approved and locked.
* A new **Phase 9 (Foundational Packages)** has been inserted to create `packages/db/` and `packages/messaging/` before the phases that depend on them.
* The original Phase 8 (Post-Event + Contact Exchange) is now **Phase 10**, split into 5 tickets at Phase 8 depth.
* All subsequent phases are renumbered: Safety → 11, Admin Dashboard → 12, Observability → 13, Testing → 14, Production → 15.
* The LLM Layer architecture description should read: "LLM-driven extraction primary (Anthropic Claude 3.5 Haiku); deterministic regex fallback for resilience. Strict JSON schemas + validators."

---

## Phase 9 — Foundational Packages (`packages/db/` + `packages/messaging/`)

This phase creates two foundational internal packages that the build plan's repo structure specifies but that were never implemented. All subsequent phases depend on these packages for typed DB access and reliable messaging. After this phase, no code outside these packages should call Supabase or Twilio directly.

---

### Ticket 9.1 — `packages/db/` Typed Database Client

**Goal:** Create a typed, RLS-aware database client package that wraps Supabase and becomes the single entry point for all DB access across the monorepo.

**Background:**

The build plan's repo structure specifies `packages/db/` for typed DB client, migrations helpers, and SQL utilities. Currently, every edge function and engine creates its own Supabase client instance with inline type assertions. This leads to inconsistent error handling, no centralized connection configuration, and type-unsafe query patterns. All subsequent phases (Post-Event, Safety, Admin, Observability) need reliable, typed DB access. This package must exist before those phases begin.

**Requirements:**

* Create `packages/db/package.json` with `typescript`, `@supabase/supabase-js` as dependencies, `tsconfig.json` with strict mode enabled
* Create `packages/db/src/client.ts`:
  * Export `createServiceClient()` — returns a typed Supabase client using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (for server-side operations)
  * Export `createAnonClient()` — returns a typed Supabase client using `SUPABASE_URL` + `SUPABASE_ANON_KEY` (for RLS-scoped member operations)
  * Both functions accept optional config overrides (e.g., custom fetch, timeout)
  * Client instances are lazily initialized singletons per environment context (not re-created per call)
* Create `packages/db/src/types.ts`:
  * Export generated database types from `supabase gen types typescript` output
  * Include a `Database` type that maps to all public tables and their row/insert/update shapes
  * Export helper types: `Tables<T>`, `Enums<T>`, `TablesInsert<T>`, `TablesUpdate<T>`
* Create `packages/db/src/queries/` directory with typed query helpers:
  * `packages/db/src/queries/profiles.ts` — `getProfileById()`, `updateProfile()`, `getProfilesByRegion()`
  * `packages/db/src/queries/conversations.ts` — `getConversationSession()`, `upsertConversationSession()`
  * `packages/db/src/queries/sms.ts` — `insertInboundMessage()`, `insertOutboundMessage()`, `getMessageBySid()`
  * `packages/db/src/queries/safety.ts` — `getActiveHolds()`, `getBlocksBetween()`, `insertSafetyIncident()`
  * `packages/db/src/queries/linkups.ts` — `getLinkupById()`, `getLinkupParticipants()`, `getOutcomesByLinkup()`
  * `packages/db/src/queries/learning.ts` — `insertLearningSignal()`, `getUserDerivedState()`
  * Each query function returns typed results and throws typed errors
  * All write operations accept an `idempotencyKey` parameter where applicable and handle `ON CONFLICT` gracefully
* Create `packages/db/src/errors.ts`:
  * Export `DbError` base class with `code`, `message`, `cause`
  * Export `DuplicateError` (for idempotency conflicts), `NotFoundError`, `ConstraintError`
* Create `packages/db/src/index.ts` — barrel export of all public API
* Add `packages/db/` to the pnpm workspace (`pnpm-workspace.yaml`)
* Add unit tests in `packages/db/src/__tests__/`:
  * `client.test.ts` — singleton behavior, env var validation
  * `queries/*.test.ts` — typed query construction (can use mock/stub Supabase client)

**Deliverables:**

* `packages/db/package.json`
* `packages/db/tsconfig.json`
* `packages/db/src/client.ts`
* `packages/db/src/types.ts` (generated)
* `packages/db/src/queries/profiles.ts`
* `packages/db/src/queries/conversations.ts`
* `packages/db/src/queries/sms.ts`
* `packages/db/src/queries/safety.ts`
* `packages/db/src/queries/linkups.ts`
* `packages/db/src/queries/learning.ts`
* `packages/db/src/errors.ts`
* `packages/db/src/index.ts`
* `packages/db/src/__tests__/` (unit tests)
* Updated `pnpm-workspace.yaml`

**Verification:**

* `pnpm typecheck` passes with strict mode across the full monorepo
* `pnpm test` passes all unit tests in `packages/db/`
* Importing `@josh/db` from any other package resolves correctly
* `createServiceClient()` throws a clear error if `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing
* All query helpers return correctly typed results (TypeScript compiler catches type mismatches)
* `insertInboundMessage()` with a duplicate `twilio_message_sid` returns the existing row without error (idempotent)

---

### Ticket 9.2 — `packages/messaging/` Twilio Client + Message Templates

**Goal:** Create a messaging package that wraps Twilio REST API sends, enforces idempotency, and centralizes all system-generated SMS templates.

**Background:**

The build plan's repo structure specifies `packages/messaging/` for Twilio helpers, idempotency enforcement, and message templates. Currently, Twilio sends are called directly in `packages/core/src/onboarding/onboarding-engine.ts` and `supabase/functions/twilio-inbound/index.ts` with inline message strings. Post-Event (Phase 10), Safety (Phase 11), and all future SMS flows need a single messaging interface that prevents double-sends, centralizes templates, and logs all outbound activity. This package must exist before those phases begin.

**Requirements:**

* Create `packages/messaging/package.json` with `twilio` SDK as dependency, `tsconfig.json` with strict mode
* Create `packages/messaging/src/client.ts`:
  * Export `sendSms(params: SendSmsParams): Promise<SendSmsResult>` — sends a single SMS via Twilio REST API
  * `SendSmsParams`: `{ to: string, body: string, idempotencyKey: string, correlationId: string, purpose: string }`
  * Before sending: check `sms_outbound_jobs` for existing row with matching `idempotencyKey` — if found and `status != 'failed'`, return existing result without re-sending
  * After sending: write to `sms_messages` (outbound) keyed by Twilio `MessageSid`
  * After sending: write to `sms_outbound_jobs` with `idempotencyKey`, `status: 'sent'`, `twilio_message_sid`
  * On Twilio API failure: write to `sms_outbound_jobs` with `status: 'failed'`, `error`, `attempt_count`
  * Retry policy: 1 retry on transient Twilio errors (5xx, timeout), no retry on 4xx
* Create `packages/messaging/src/burst.ts`:
  * Export `sendBurst(params: BurstParams): Promise<BurstResult>` — sends multiple messages in sequence with configurable delay
  * `BurstParams`: `{ to: string, messages: Array<{ body: string, idempotencyKey: string, purpose: string }>, delayMs: number, correlationId: string }`
  * Uses `sendSms()` for each message with `await new Promise(resolve => setTimeout(resolve, delayMs))` between them
  * If any message in the burst fails, logs the failure and continues with remaining messages (partial burst is better than no burst)
  * Returns array of per-message results with success/failure status
* Create `packages/messaging/src/templates/` directory:
  * `packages/messaging/src/templates/onboarding.ts` — re-export onboarding message constants from `packages/core/src/onboarding/messages.ts` (single source of truth stays in core; messaging provides the send interface)
  * `packages/messaging/src/templates/interview.ts` — re-export interview message constants from `packages/core/src/interview/messages.ts`
  * `packages/messaging/src/templates/post-event.ts` — define all post-event message templates:
    * `POST_EVENT_ATTENDANCE`: `"Quick check: Did you make it to {activity}? Reply 1) Attended 2) Couldn't make it 3) Not sure."`
    * `POST_EVENT_DO_AGAIN`: `"Would you do something like that again? Reply Y/N."`
    * `POST_EVENT_FEEDBACK`: `"Anything you want JOSH to remember for next time? (Optional. Reply SKIP to skip.)"`
    * `POST_EVENT_CONTACT_INTRO`: `"Want to swap numbers with anyone from that LinkUp? You can choose any/all/none. Mutual yes only."`
    * `POST_EVENT_CONTACT_CHOICES`: `"Reply with numbers you'd like to exchange with (e.g., 1,3). Reply NONE for no one.\n\n{participantList}"`
    * `POST_EVENT_REVEAL`: `"You both said yes. Here's {otherFirstName}'s number: {otherPhone}. If you want to stop contact, reply BLOCK {otherFirstName}."`
    * `POST_EVENT_NO_MUTUAL`: `"No mutual exchanges this time. No worries — I'll keep finding people worth meeting."`
    * `POST_EVENT_WINDOW_EXPIRED`: `"The exchange window for that LinkUp has closed. Catch you on the next one."`
    * `POST_EVENT_MESSAGES_VERSION`: version string for audit
  * `packages/messaging/src/templates/safety.ts` — define safety response templates:
    * `SAFETY_HOLD_NOTICE`: `"Your account is temporarily paused while we review a safety concern. Reply HELP for support."`
    * `SAFETY_CRISIS_RESPONSE`: `"I hear you. If you or someone you know is in crisis, please reach out to the 988 Suicide & Crisis Lifeline — call or text 988. You can also text HOME to 741741 for the Crisis Text Line."`
    * `SAFETY_BLOCK_CONFIRMED`: `"Done. {blockedName} has been blocked. They won't appear in future plans and can't contact you through JOSH."`
    * `SAFETY_REPORT_RECEIVED`: `"Thanks for letting me know. I've flagged this for review. You won't be matched with this person while it's being reviewed."`
    * `SAFETY_MESSAGES_VERSION`: version string for audit
  * `packages/messaging/src/templates/linkup.ts` — define LinkUp coordination templates:
    * `LINKUP_REMINDER`: `"Reminder: {activity} is today at {time}. {venueInfo}"`
    * `LINKUP_CANCEL_NOTICE`: `"Heads up: {activity} on {date} has been canceled. I'll find another plan soon."`
    * `LINKUP_MESSAGES_VERSION`: version string for audit
  * All templates use `{placeholder}` syntax interpolated by a shared `interpolate(template, vars)` helper
* Create `packages/messaging/src/interpolate.ts`:
  * Export `interpolate(template: string, vars: Record<string, string>): string`
  * Throws if any `{placeholder}` in the template has no matching key in `vars`
  * Throws if result contains un-interpolated `{...}` patterns
* Create `packages/messaging/src/index.ts` — barrel export
* Add `packages/messaging/` to `pnpm-workspace.yaml`
* Unit tests in `packages/messaging/src/__tests__/`:
  * `client.test.ts` — idempotency check, Twilio mock, retry behavior
  * `burst.test.ts` — delay timing, partial failure handling
  * `interpolate.test.ts` — happy path, missing var throws, un-interpolated pattern throws
  * `templates/*.test.ts` — all templates present and version strings non-empty

**Deliverables:**

* `packages/messaging/package.json`
* `packages/messaging/tsconfig.json`
* `packages/messaging/src/client.ts`
* `packages/messaging/src/burst.ts`
* `packages/messaging/src/interpolate.ts`
* `packages/messaging/src/templates/onboarding.ts`
* `packages/messaging/src/templates/interview.ts`
* `packages/messaging/src/templates/post-event.ts`
* `packages/messaging/src/templates/safety.ts`
* `packages/messaging/src/templates/linkup.ts`
* `packages/messaging/src/index.ts`
* `packages/messaging/src/__tests__/` (unit tests)
* Updated `pnpm-workspace.yaml`

**Verification:**

* `pnpm typecheck` passes with strict mode across the full monorepo
* `pnpm test` passes all unit tests in `packages/messaging/`
* `sendSms()` with a duplicate `idempotencyKey` does not call Twilio a second time
* `sendBurst()` with 4 messages and `delayMs: 8000` completes in approximately 24 seconds (3 delays × 8s)
* `interpolate("Hello {name}", { name: "Alex" })` returns `"Hello Alex"`
* `interpolate("Hello {name}", {})` throws an error mentioning the missing variable
* All post-event, safety, and LinkUp templates have non-empty `*_MESSAGES_VERSION` exports
* Importing `@josh/messaging` from any other package resolves correctly

---

### Ticket 9.3 — Migrate Existing Code to Use `packages/db/` and `packages/messaging/`

**Goal:** Refactor all existing direct Supabase client calls and Twilio REST API calls to use the new packages, ensuring no code outside these packages calls Supabase or Twilio directly.

**Background:**

With `packages/db/` and `packages/messaging/` created in Tickets 9.1 and 9.2, all existing code that directly instantiates Supabase clients or calls Twilio must be migrated. This ensures consistent error handling, idempotency enforcement, and type safety across the entire codebase. The migration must not change any external behavior — only internal wiring.

**Requirements:**

* Update `packages/core/src/onboarding/onboarding-engine.ts`:
  * Replace direct `createClient()` calls with imports from `@josh/db`
  * Replace direct Twilio REST API calls with `sendSms()` and `sendBurst()` from `@josh/messaging`
* Update `supabase/functions/twilio-inbound/index.ts`:
  * Replace inline Supabase client creation with `@josh/db` imports
  * Replace inline SMS sends with `@josh/messaging` client
* Update `packages/core/src/compatibility/compatibility-score-writer.ts`:
  * Replace direct Supabase queries with `@josh/db` query helpers
* Update `packages/core/src/compatibility/compatibility-signal-writer.ts`:
  * Replace direct Supabase queries with `@josh/db` query helpers
* Update `scripts/run-matching-job.mjs`:
  * Replace direct Supabase client usage with `@josh/db` imports (or document that scripts are allowed to use direct access as an exception, with a code comment explaining why)
* Update any other files that directly import `@supabase/supabase-js` or call Twilio — search the codebase for `createClient` imports from Supabase and `twilio` imports
* Add a lint rule or code comment convention: `// @josh/db required — no direct Supabase imports outside packages/db/`
* Ensure all existing tests still pass after migration

**Deliverables:**

* Updated `packages/core/src/onboarding/onboarding-engine.ts`
* Updated `supabase/functions/twilio-inbound/index.ts`
* Updated `packages/core/src/compatibility/compatibility-score-writer.ts`
* Updated `packages/core/src/compatibility/compatibility-signal-writer.ts`
* Updated any other files with direct Supabase/Twilio imports
* All existing tests passing

**Verification:**

* `pnpm lint` passes
* `pnpm typecheck` passes
* `pnpm test` passes (all existing tests unchanged in behavior)
* `grep -r "createClient" --include="*.ts" --include="*.tsx" packages/ apps/ supabase/` returns only results inside `packages/db/` (exception: `scripts/` if documented)
* No direct `import twilio from 'twilio'` or `import { Twilio } from 'twilio'` outside `packages/messaging/`
* Full onboarding flow still works in staging (manual smoke test)

---

## Phase 10 — Post-Event + Contact Exchange

This phase implements the complete post-event flow: attendance confirmation, do-again pulse, feedback collection, and mutual contact exchange. It depends on Phase 8 (SMS Conversation Redesign) for the conversation engine pattern and in-process sequential delivery, Phase 9 (Foundational Packages) for `@josh/db` and `@josh/messaging`, and Phase 11 (Safety) for block/hold checks at reveal time.

**Phase dependencies:**
* Phase 8.3 (In-Process Sequential Delivery) — post-event sends multi-step SMS sequences
* Phase 8.7 (Conversation Behavior Spec) — post-event messages must follow JOSH voice
* Phase 9 (Foundational Packages) — all DB and messaging calls use `@josh/db` and `@josh/messaging`
* Phase 11.1 (Safety Keywords + Holds) — block/hold checks at reveal time (can be developed in parallel; contact exchange reveal gate is the integration point)

---

### Ticket 10.1 — Post-Event Session Mode + Conversation Router Integration

**Goal:** Register the `post_event` session mode in the conversation router and define all post-event state tokens, enabling the post-event flow to operate within the Phase 8 conversation engine architecture.

**Background:**

The Phase 8 conversation router defines session modes for `onboarding`, `interviewing`, and `idle`. Post-event flows send multi-step SMS sequences that need the same conversation engine infrastructure — state tokens for each step, mode-based routing, and session persistence. Without this ticket, the post-event engine has no way to track where each user is in the post-event flow or route inbound replies to the correct handler. This ticket establishes the infrastructure before any post-event messages are sent.

Cross-phase gap addressed: **Gap 1 (No Session Mode for Post-Event Flow)** and **Gap 6 (Conversation Mode Transitions)**.

**Requirements:**

* Add session mode `post_event` to the conversation session mode enum:
  * Update the mode enum in `packages/core/src/interview/state.ts` (or the canonical mode definition location) to include `post_event`
  * Update the conversation router in `conversation-router.ts` to route `post_event` mode to a new post-event handler
* Define the following state tokens and add them to the state token validation:
  * `post_event:attendance` — awaiting attendance reply
  * `post_event:do_again` — awaiting do-again reply
  * `post_event:feedback` — awaiting feedback reply
  * `post_event:contact_intro` — awaiting acknowledgment of contact exchange intro
  * `post_event:contact_choices` — awaiting contact exchange choice reply
  * `post_event:complete` — post-event flow complete for this user/LinkUp
* Update `fromInterviewStateToken()` (or the canonical state token parser) to handle the `post_event:` prefix
* Update the DB state token validation regex (if one exists in migrations) to accept the `post_event:` prefix
* Create `packages/core/src/post-event/post-event-router.ts`:
  * Export `routePostEventReply(session, inboundMessage): Promise<PostEventRouteResult>`
  * Reads `state_token` to determine which post-event step the user is on
  * Delegates to the appropriate handler (attendance, do-again, feedback, contact choices)
  * Returns the next state token and any outbound messages to send
* Update `conversation-router.ts` to call `routePostEventReply()` when `mode === 'post_event'`
* Add a `post_event_linkup_id` field to `conversation_sessions` (or use the existing `context` jsonb field) to track which LinkUp this post-event flow is for — a user can only be in one post-event flow at a time
* Handle mode transition: when the post-event flow completes (state token reaches `post_event:complete`), transition the session back to `idle` mode

**Deliverables:**

* Updated mode enum (wherever canonically defined)
* Updated `conversation-router.ts` (post_event mode routing)
* Updated state token parser/validator
* Updated DB migration (if state token regex constraint exists)
* `packages/core/src/post-event/post-event-router.ts`
* Unit tests: state token parsing for all `post_event:*` tokens
* Unit tests: router dispatches to post-event handler when `mode === 'post_event'`
* Unit tests: mode transitions back to `idle` on `post_event:complete`

**Verification:**

* `pnpm typecheck` passes with all new tokens and mode
* A conversation session with `mode: 'post_event'` and `state_token: 'post_event:attendance'` routes to the post-event handler
* A conversation session with `state_token: 'post_event:complete'` transitions to `mode: 'idle'`
* State token `post_event:attendance` passes DB validation
* State token `post_event:invalid_step` fails DB validation (if regex constraint exists)
* The router does not interfere with existing onboarding/interview routing

---

### Ticket 10.2 — Post-Event Runner + Attendance Collection

**Goal:** Implement the cron-based runner that detects LinkUps eligible for post-event follow-up and initiates attendance collection via SMS.

**Background:**

After a LinkUp occurs, JOSH sends a post-event follow-up sequence to each participant. The runner detects locked LinkUps that have passed their `event_time` plus a 2-hour buffer, initiates the post-event flow for each participant, and sends the attendance confirmation prompt. This is the entry point to the entire post-event flow. The runner must be idempotent — running it multiple times for the same LinkUp must not send duplicate messages or create duplicate outcome rows.

**Requirements:**

* Create `apps/web/app/api/cron/post-event-runner/route.ts`:
  * Protected by `CRON_SECRET` (same pattern as existing `outbound-runner`)
  * Query: select all LinkUps where `state = 'locked'` AND `event_time + interval '2 hours' < now()` AND no `linkup_outcomes` rows exist for this LinkUp (indicating post-event hasn't started)
  * For each eligible LinkUp, for each participant in `linkup_participants` where `status = 'confirmed'`:
    * Check user is not on a safety hold that blocks messaging (query `safety_holds` via `@josh/db`)
    * Check user has not opted out (STOP)
    * Create `linkup_outcomes` row with `linkup_id`, `user_id`, `status: 'pending'` — idempotent by unique constraint on `(linkup_id, user_id)`
    * Set conversation session: `mode: 'post_event'`, `state_token: 'post_event:attendance'`, `post_event_linkup_id: linkup_id`
    * Send attendance prompt via `@josh/messaging`:
      * Body: `POST_EVENT_ATTENDANCE` template interpolated with `{ activity: linkup.activity_label }`
      * Idempotency key: `post_event_attendance:{linkup_id}:{user_id}`
      * Purpose: `post_event_attendance`
  * After processing all participants, update LinkUp state to `completed` (if not already)
  * Log: `post_event.runner.started`, `post_event.runner.linkup_processed`, `post_event.runner.completed` with correlation ID
* Create `packages/core/src/post-event/attendance-handler.ts`:
  * Export `handleAttendanceReply(session, inboundMessage, linkupId): Promise<AttendanceResult>`
  * Parse reply: `1` or `attended` → `attended`, `2` or `couldn't` or `no` → `no_show`, `3` or `unsure` → `unsure`
  * If unparseable: send one clarifier (`"Reply 1, 2, or 3: 1) Attended 2) Couldn't make it 3) Not sure."`), set `clarifier_pending` flag, re-parse on next message. If still unparseable after clarifier, record `unsure` and advance.
  * Update `linkup_outcomes` row: set `attendance_response`, `attendance_responded_at`
  * Advance state token to `post_event:do_again`
  * Return next outbound message (the do-again prompt from Ticket 10.3)
* Wire `attendance-handler.ts` into `post-event-router.ts` for `state_token: 'post_event:attendance'`
* Add Vercel Cron schedule: every 15 minutes (configurable via `vercel.json`)

**Deliverables:**

* `apps/web/app/api/cron/post-event-runner/route.ts`
* `packages/core/src/post-event/attendance-handler.ts`
* Updated `packages/core/src/post-event/post-event-router.ts` (wires attendance handler)
* Updated `vercel.json` (cron schedule)
* Unit tests for attendance reply parsing (all variants: `1`, `attended`, `2`, `no`, `3`, `unsure`, unparseable)
* Unit tests for runner eligibility query (only locked LinkUps past buffer)
* Unit tests for idempotency (re-running runner doesn't duplicate outcomes or messages)

**Verification:**

* A locked LinkUp with `event_time` 3 hours ago is detected by the runner
* A locked LinkUp with `event_time` 1 hour ago is NOT detected (still in buffer)
* Each participant receives exactly one attendance prompt (idempotent by `post_event_attendance:{linkup_id}:{user_id}`)
* Re-running the runner for the same LinkUp sends no additional messages
* User replying `1` → `linkup_outcomes.attendance_response = 'attended'`, state advances to `post_event:do_again`
* User replying `attended` → same result
* User replying `asdfgh` → receives clarifier → replies `2` → `attendance_response = 'no_show'`
* User on safety hold → no prompt sent, skipped with log entry
* User who has STOP-opted out → no prompt sent, skipped with log entry

---

### Ticket 10.3 — Do-Again + Feedback Collection + Learning Signal Pipeline

**Goal:** After attendance is confirmed, collect the do-again preference and optional feedback, then write learning signals to the learning system tables.

**Background:**

The do-again pulse and feedback are lightweight post-event signals that feed the learning and adaptation system (Doc 10). Do-again responses adjust activity weight overrides and reliability scores. Feedback text is stored for future analysis. This ticket also implements the pipeline that connects post-event outcomes to the learning system — addressing **Gap 4 (Post-Event → Learning Signal Pipeline)**. Dropout recovery for users who go quiet mid-post-event is also handled here.

**Requirements:**

* Create `packages/core/src/post-event/do-again-handler.ts`:
  * Export `handleDoAgainReply(session, inboundMessage, linkupId): Promise<DoAgainResult>`
  * Parse reply: `Y`, `yes`, `yeah`, `yep`, `sure` → `true`; `N`, `no`, `nah`, `nope` → `false`
  * If unparseable: send one clarifier (`"Just Y or N — would you do something like that again?"`), set `clarifier_pending`, re-parse next message. If still unparseable, record `null` (skipped) and advance.
  * Update `linkup_outcomes` row: set `do_again`, `do_again_responded_at`
  * Advance state token to `post_event:feedback`
  * Send feedback prompt: `POST_EVENT_FEEDBACK` template
  * Idempotency key for feedback prompt: `post_event_feedback:{linkup_id}:{user_id}`
* Create `packages/core/src/post-event/feedback-handler.ts`:
  * Export `handleFeedbackReply(session, inboundMessage, linkupId): Promise<FeedbackResult>`
  * If reply matches `SKIP` (case-insensitive): record `feedback: null`, advance
  * Otherwise: store reply text as `feedback` (max 500 characters, truncate with log if longer)
  * Update `linkup_outcomes` row: set `feedback`, `feedback_responded_at`
  * Advance state token to `post_event:contact_intro` (if contact exchange is applicable) or `post_event:complete` (if LinkUp had only 2 participants or contact exchange is not applicable)
* Create `packages/core/src/post-event/learning-signal-writer.ts`:
  * Export `writePostEventLearningSignals(linkupId, userId, outcome: LinkupOutcome): Promise<void>`
  * Called after each outcome field is recorded (attendance, do-again)
  * Write to `learning_signals` table via `@josh/db`:
    * Attendance signal: `signal_type: 'linkup_attendance_attended'` (or `_no_show` or `_unsure`), `subject_id: linkupId`, `user_id`, `idempotency_key: 'ls:attended:{linkupId}:{userId}'`
    * Do-again signal: `signal_type: 'linkup_do_again_yes'` (or `_no`), `subject_id: linkupId`, `user_id`, `idempotency_key: 'ls:do_again:{linkupId}:{userId}'`
  * All writes are idempotent by `idempotency_key` unique constraint
  * Feedback text is stored in `linkup_outcomes` only (not in `learning_signals`) — learning jobs process it separately
* Implement post-event dropout recovery:
  * If a user does not reply to a post-event prompt within 48 hours, the step is skipped and the flow advances to the next step automatically
  * Detection: add post-event timeout check to the post-event runner cron (or a separate cron)
  * Query: `conversation_sessions` where `mode = 'post_event'` AND `updated_at < now() - interval '48 hours'`
  * On timeout: record the current step as `null`/skipped in `linkup_outcomes`, advance to next step, send next prompt (or complete if at last step)
  * Do NOT send a dropout nudge for post-event (unlike interview dropout — post-event is lighter-touch)
  * Log: `post_event.step_timeout` with user_id, linkup_id, step_name
* Wire `do-again-handler.ts` and `feedback-handler.ts` into `post-event-router.ts`

**Deliverables:**

* `packages/core/src/post-event/do-again-handler.ts`
* `packages/core/src/post-event/feedback-handler.ts`
* `packages/core/src/post-event/learning-signal-writer.ts`
* Updated `packages/core/src/post-event/post-event-router.ts` (wires do-again and feedback handlers)
* Updated `apps/web/app/api/cron/post-event-runner/route.ts` (adds timeout detection)
* Unit tests: do-again parsing (all Y/N variants, unparseable, clarifier)
* Unit tests: feedback handling (text, SKIP, truncation)
* Unit tests: learning signal writes (correct signal types, idempotency)
* Unit tests: dropout timeout (step skipped, flow advances)

**Verification:**

* User replies `Y` to do-again → `linkup_outcomes.do_again = true`, `learning_signals` row with `signal_type = 'linkup_do_again_yes'` and `idempotency_key = 'ls:do_again:{linkupId}:{userId}'`
* User replies `N` → same flow with `false` and `linkup_do_again_no`
* User replies `SKIP` to feedback → `feedback = null`, state advances to contact intro
* User replies `This was great, loved the coffee spot` → `feedback` stored (trimmed), state advances
* User replies with 600-character feedback → truncated to 500, logged
* Duplicate learning signal write (same idempotency key) → no duplicate row, no error
* User goes silent for 48+ hours at `post_event:do_again` → step skipped, `do_again = null`, state advances to `post_event:feedback`, next prompt sent
* Learning signal for attendance `attended` → correct `signal_type` and `idempotency_key` format

---

### Ticket 10.4 — Mutual Contact Exchange

**Goal:** Implement contact exchange choice collection, mutual detection, reveal messaging with safety gate, and dashboard UI for exchange status.

**Background:**

Contact exchange is the highest-stakes part of the post-event flow — it involves revealing personal phone numbers. Mutual consent is required: both users must say "yes" before either number is shared. Safety checks (blocks, holds) must be re-verified at reveal time, not just at choice time. The reveal message is idempotent — sending it twice for the same pair must not be possible. Users can change their choice from "yes" to "no" until the reveal has occurred; after reveal, the only recourse is the "block" command. This ticket covers all edge cases from the gap analysis.

**Requirements:**

* Create `packages/core/src/post-event/contact-exchange-handler.ts`:
  * Export `handleContactIntroReply(session, inboundMessage, linkupId): Promise<ContactIntroResult>`
    * Any positive or acknowledgment reply advances to choice collection
    * Send `POST_EVENT_CONTACT_CHOICES` template interpolated with participant list (numbered: `"1. Alex\n2. Jordan\n3. Sam"`)
    * Idempotency key: `post_event_contact_choices:{linkup_id}:{user_id}`
    * Set state token: `post_event:contact_choices`
  * Export `handleContactChoicesReply(session, inboundMessage, linkupId): Promise<ContactChoicesResult>`
    * Parse reply:
      * `NONE` → no choices, advance to `post_event:complete`
      * `ALL` → yes for all other participants
      * Comma-separated numbers (e.g., `1,3`) → yes for those participants, no for others
      * Single number (e.g., `2`) → yes for that participant only
    * For each participant: upsert `contact_exchange_choices` row with `(linkup_id, chooser_user_id, target_user_id, choice: true/false)`
    * Idempotency: `contact_exchange_choices` has unique constraint on `(linkup_id, chooser_user_id, target_user_id)`; upsert on conflict updates `choice` and `updated_at`
    * After recording choices: call `detectAndRevealMutualExchanges(linkupId, userId)` (see below)
    * Advance state token to `post_event:complete`
    * If unparseable: one clarifier with participant list again, then advance with no choices on second failure
* Create `packages/core/src/post-event/mutual-detection.ts`:
  * Export `detectAndRevealMutualExchanges(linkupId, triggerUserId): Promise<MutualDetectionResult>`
  * For each target where the trigger user said "yes":
    * Check if the target has also said "yes" for the trigger user: query `contact_exchange_choices` where `(linkup_id, chooser_user_id = target, target_user_id = triggerUser, choice = true)`
    * If mutual yes detected:
      * **Safety gate:** Check `user_blocks` for blocks in either direction between the two users via `@josh/db`. Check `safety_holds` for active holds on either user that block contact exchange (`contact_hold` or `global_hold`).
      * If safety gate fails: log `contact_exchange.reveal_suppressed` with reason, do NOT create exchange row, do NOT send reveal
      * If safety gate passes:
        * Check if `contact_exchanges` row already exists for this pair and LinkUp (unique on `(linkup_id, user_a_id, user_b_id)` with canonical ordering `user_a_id < user_b_id`) — if exists, skip (already revealed)
        * Create `contact_exchanges` row atomically (insert with `ON CONFLICT DO NOTHING`)
        * Send reveal message to BOTH users via `@josh/messaging`:
          * Body: `POST_EVENT_REVEAL` template interpolated with `{ otherFirstName, otherPhone }`
          * Idempotency key: `contact_reveal:{linkup_id}:{user_a_id}:{user_b_id}:{to_user_id}` (one key per recipient)
          * Purpose: `contact_exchange_reveal`
        * Write learning signal: `signal_type: 'contact_exchange_mutual_yes'`, `idempotency_key: 'ls:exchange_yes:{exchange_id}:{user_id}'` for each user
  * For each target where the trigger user said "no" or the target hasn't responded:
    * No action (wait for other user to respond, or window to expire)
* Handle edge cases:
  * **One-sided yes:** User A says yes for User B, but B hasn't responded yet → no reveal, no action. When B eventually responds with yes → mutual detection triggers reveal.
  * **Changed choice before reveal:** User A said yes, then sends another message changing to no → update `contact_exchange_choices` row (upsert). If `contact_exchanges` row does NOT exist yet, the change takes effect. If it does exist (already revealed), the change is logged but no action taken.
  * **Window expiry:** If `POST_EVENT_COLLECTION_WINDOW` (7 days from post-event start) expires and one user said yes but the other never responded → send `POST_EVENT_NO_MUTUAL` to the user who said yes. No exchange created. Detection: post-event runner cron checks for expired windows.
  * **Block/hold at reveal time:** If a block was created between choice time and reveal time → reveal suppressed, logged, no exchange row created.
  * **User blocked another user between lock and post-event:** Block check at reveal time catches this. No reveal sent.
* Dashboard UI for contact exchange status:
  * Add to member dashboard: a section showing past LinkUps with exchange status per participant:
    * "Waiting for response" — choice made, waiting for mutual
    * "Exchanged" — mutual yes, number revealed
    * "No exchange" — one or both said no, or window expired
  * Create `apps/web/app/dashboard/exchanges/page.tsx` (or add to existing LinkUp detail view)
  * Fetch data via `@josh/db` query: join `contact_exchange_choices` and `contact_exchanges` for the user's LinkUps

**Deliverables:**

* `packages/core/src/post-event/contact-exchange-handler.ts`
* `packages/core/src/post-event/mutual-detection.ts`
* Updated `packages/core/src/post-event/post-event-router.ts` (wires contact handlers)
* Updated post-event runner (window expiry detection)
* `apps/web/app/dashboard/exchanges/page.tsx` (or equivalent dashboard component)
* Unit tests: choice parsing (NONE, ALL, single number, comma-separated, unparseable)
* Unit tests: mutual detection (both yes → reveal, one yes → no reveal, both no → no reveal)
* Unit tests: safety gate (block suppresses reveal, hold suppresses reveal)
* Unit tests: idempotency (duplicate reveal message not sent, duplicate exchange row not created)
* Unit tests: changed choice before reveal (updates choice, no reveal if changed to no)
* Unit tests: window expiry (sends no-mutual message, no exchange created)

**Verification:**

* User A says yes for User B, User B says yes for User A → both receive reveal message with each other's phone number
* User A says yes for User B, User B says no → no reveal, A eventually receives `POST_EVENT_NO_MUTUAL` when window expires
* User A says yes for User B, User B never responds → no reveal, A receives `POST_EVENT_NO_MUTUAL` at window expiry
* User A says yes for User B, then changes to no before B responds → no reveal even if B says yes later
* User A and B have mutual yes, but A blocked B after choosing → reveal suppressed, logged as `contact_exchange.reveal_suppressed`
* User A and B have mutual yes, A is on `contact_hold` → reveal suppressed
* Reveal message for pair (A, B) sent once → re-running detection does NOT send a second reveal (idempotent by `contact_reveal:{linkup_id}:{a_id}:{b_id}:{to_user_id}`)
* `contact_exchanges` row has canonical ordering (`user_a_id < user_b_id`)
* Dashboard shows correct exchange status for each participant
* `learning_signals` row written for each user in a mutual exchange with correct `idempotency_key`

---

### Ticket 10.5 — Post-Event Integration Tests + Edge Case Harness

**Goal:** Create integration tests that exercise the full post-event flow end-to-end, including all edge cases, timing, and cross-system integration.

**Background:**

The post-event flow spans multiple handlers, touches safety, learning signals, contact exchange, and the conversation router. Individual unit tests cover handler logic, but integration tests are needed to verify the full flow works correctly when components are wired together. This ticket creates a test harness that simulates the complete post-event lifecycle.

**Requirements:**

* Create `tests/integration/post-event-flow.test.ts`:
  * **Scenario 1 — Happy path (full flow):**
    * Setup: locked LinkUp with 3 participants, event_time 3 hours ago
    * Runner detects LinkUp, sends attendance prompt to all 3
    * Participant 1 replies `1` (attended), receives do-again prompt, replies `Y`, receives feedback prompt, replies `Great time`, receives contact intro, replies `ok`, receives choice list, replies `1,2` (all others), state completes
    * Participant 2 replies `1`, `Y`, `SKIP`, `ok`, `1` (just participant 1), state completes
    * Participant 3 replies `2` (no_show), `N`, `SKIP`, `ok`, `NONE`, state completes
    * Mutual detection: P1↔P2 mutual yes → reveal sent to both. P1→P3 no mutual (P3 said none). P2→P3 no mutual.
    * Verify: `linkup_outcomes` has 3 rows, `contact_exchange_choices` has correct rows, `contact_exchanges` has 1 row (P1↔P2), `learning_signals` has correct entries
  * **Scenario 2 — Dropout mid-flow:**
    * Participant replies to attendance, then goes silent
    * 48 hours pass (simulated)
    * Timeout detection advances past do-again and feedback
    * Contact exchange still offered (participant can still choose)
  * **Scenario 3 — Safety hold during reveal:**
    * P1 and P2 mutual yes, but P1 has active `contact_hold`
    * Reveal suppressed for both, logged
  * **Scenario 4 — Block between choice and reveal:**
    * P1 says yes for P2, P2 blocks P1, P2 says yes for P1
    * Reveal suppressed due to block
  * **Scenario 5 — Window expiry:**
    * P1 says yes for P2, 7-day window expires, P2 never responded
    * P1 receives `POST_EVENT_NO_MUTUAL`
  * **Scenario 6 — Idempotency:**
    * Runner runs twice for the same LinkUp → no duplicate messages or rows
    * Mutual detection runs twice for the same pair → no duplicate reveal
* Tests use mock `@josh/messaging` (no real Twilio calls) and test DB (or mocked `@josh/db`)

**Deliverables:**

* `tests/integration/post-event-flow.test.ts`
* Test fixtures: mock LinkUp data, mock participant data, mock safety data
* All 6 scenarios passing

**Verification:**

* `pnpm test tests/integration/post-event-flow.test.ts` passes all scenarios
* Scenario 1 produces exactly the expected number of DB rows
* Scenario 6 proves idempotency (row counts unchanged on replay)
* No test sends real SMS (all mocked)

---

## Phase 11 — Safety System

This phase implements the missing safety infrastructure: keyword detection, rate limiting, strike escalation, crisis routing, block/report flows, and integration with the Phase 8 conversation router. STOP/HELP precedence handling is already implemented in `supabase/functions/twilio-inbound/index.ts` and is NOT reimplemented here.

**Phase dependencies:**
* Phase 8 (SMS Conversation Redesign) — safety must integrate with the new conversation router
* Phase 9 (Foundational Packages) — all DB and messaging calls use `@josh/db` and `@josh/messaging`

---

### Ticket 11.1 — Keyword Detection + Rate Limiting + Strike Escalation

**Goal:** Implement keyword-based safety detection with a versioned keyword list, per-user rate limiting, strike accumulation with decay, and crisis routing with resource messaging.

**Background:**

STOP/HELP precedence handling is already implemented and works. What is missing: (1) a keyword detection system that scans inbound messages for safety-relevant terms across 6 categories, (2) rate limiting to detect abuse patterns, (3) strike escalation logic that converts incidents into holds, and (4) crisis routing that provides appropriate resources for self-harm keywords. Each of these is a substantial subsystem specified in Doc 13 (Safety and Abuse Prevention Playbook). This ticket implements all four.

**Requirements:**

**Keyword Detection:**
* Create `packages/core/src/safety/keyword-detector.ts`:
  * Export `detectSafetyKeywords(messageBody: string): KeywordDetectionResult`
  * `KeywordDetectionResult`: `{ detected: boolean, matches: Array<{ keyword: string, category: SafetyCategory, severity: Severity }> }`
  * Categories (from Doc 13): `violence_threats`, `self_harm`, `hate_speech`, `sexual_harassment`, `doxxing`, `scam_spam`
  * Severity: `low`, `medium`, `high`, `critical`
  * Matching rules:
    * Normalize input: lowercase, collapse whitespace, strip non-alphanumeric (except spaces)
    * Match against keyword list using word-boundary matching (not substring — "therapist" must not match "the rapist")
    * Return ALL matches, not just the first
  * Keyword list must be versioned and stored in a dedicated file
* Create `packages/core/src/safety/keyword-list.ts`:
  * Export `SAFETY_KEYWORDS: Array<{ keyword: string, category: SafetyCategory, severity: Severity }>`
  * Export `KEYWORD_LIST_VERSION: string`
  * Initial keyword list populated from Doc 13 categories (specific keywords to be provided by the safety team — include placeholder structure with 3-5 examples per category for testing)
  * The list is a code artifact (not a DB table for MVP) — versioned via the version string and updated via code changes
* Wire keyword detection into the inbound pipeline:
  * In `supabase/functions/twilio-inbound/index.ts` (or the canonical inbound entry point), AFTER STOP/HELP precedence check and BEFORE intent classification:
    * Call `detectSafetyKeywords(messageBody)`
    * If `detected === true`:
      * Create `safety_incidents` row via `@josh/db`: `{ user_id, message_sid: twilio_message_sid, category: highest_severity_match.category, severity: highest_severity_match.severity, status: 'open', idempotency_key: 'incident:{message_sid}' }`
      * If severity is `critical` (self-harm): call crisis routing (see below)
      * If severity is `high`: apply immediate hold (see strike escalation below)
      * If severity is `medium` or `low`: record incident, continue normal processing (incident feeds into strike escalation on accumulation)
      * Log: `safety.keyword_hit` with `{ category, severity, keyword_list_version, correlation_id }`

**Rate Limiting:**
* Create `packages/core/src/safety/rate-limiter.ts`:
  * Export `checkRateLimit(userId: string, action: RateLimitAction): RateLimitResult`
  * `RateLimitAction`: `inbound_message`, `linkup_initiation`, `unknown_intent`
  * Thresholds (configurable constants):
    * `inbound_message`: max 20 per user per 5-minute window
    * `linkup_initiation`: max 3 per user per day
    * `unknown_intent`: max 5 consecutive unknown intents (reset on any classified intent)
  * Implementation: query `sms_messages` (inbound, by user, within window) for message rate; query `linkups` (by initiator, within day) for initiation rate; track unknown intent count on conversation session
  * `RateLimitResult`: `{ limited: boolean, action: RateLimitAction, count: number, threshold: number, windowMinutes: number }`
  * When rate limited:
    * Create `safety_incidents` row: `{ category: 'rate_limit', severity: 'low', idempotency_key: 'rate_limit:{user_id}:{action}:{window_bucket}' }`
    * Send rate limit message: `"Slow down — I can only handle so many messages at once. Give me a minute and try again."`
    * Do NOT process the inbound message further
    * Log: `safety.rate_limit_hit` with `{ action, count, threshold }`
* Wire rate limiter into inbound pipeline: after STOP/HELP, after keyword detection, before intent classification

**Strike Escalation:**
* Create `packages/core/src/safety/strike-manager.ts`:
  * Export `evaluateStrikes(userId: string): StrikeEvaluation`
  * Query `safety_incidents` for the user within the decay window (90 days)
  * Apply decay: incidents older than 30 days contribute 0.5 weight, older than 60 days contribute 0.25 weight
  * Calculate effective strike count: sum of `severity_weight * decay_factor` across incidents
    * `critical`: weight 3, `high`: weight 2, `medium`: weight 1, `low`: weight 0.5
  * Thresholds:
    * Effective strikes >= 1.0: warning (send `SAFETY_HOLD_NOTICE` once)
    * Effective strikes >= 2.0: temporary hold (apply `global_hold` with `duration: 24 hours`)
    * Effective strikes >= 3.0: suspension review (apply `global_hold` indefinitely, flag for admin review)
  * Hold application: create `safety_holds` row via `@josh/db`: `{ user_id, hold_type, reason: 'strike_escalation', expires_at, idempotency_key: 'hold:{user_id}:{hold_type}:strike_escalation' }`
  * Export `applyHold(userId, holdType, reason, expiresAt?): Promise<void>` — reusable for both strike escalation and direct keyword triggers
  * Log: `safety.strike_evaluated` with `{ user_id, effective_strikes, action_taken }`
* Call `evaluateStrikes()` after every new `safety_incidents` row is created

**Crisis Routing:**
* Create `packages/core/src/safety/crisis-router.ts`:
  * Export `handleCrisisKeyword(userId: string, messageSid: string): Promise<void>`
  * Send `SAFETY_CRISIS_RESPONSE` template via `@josh/messaging`
    * Idempotency key: `crisis_response:{message_sid}`
    * Purpose: `safety_crisis`
  * Apply immediate `global_hold` with reason `crisis_keyword`
  * Create `safety_incidents` row with `severity: 'critical'`, `status: 'escalated'`
  * Log: `safety.crisis_routed` with `{ user_id, correlation_id }`
  * Do NOT process the inbound message further (crisis response takes precedence over all other handlers)

**Deliverables:**

* `packages/core/src/safety/keyword-detector.ts`
* `packages/core/src/safety/keyword-list.ts`
* `packages/core/src/safety/rate-limiter.ts`
* `packages/core/src/safety/strike-manager.ts`
* `packages/core/src/safety/crisis-router.ts`
* Updated inbound pipeline (keyword detection + rate limiting wired in)
* Unit tests: keyword detection (matches, no false positives on substrings, normalized input)
* Unit tests: rate limiting (under threshold passes, over threshold blocks)
* Unit tests: strike evaluation (decay math, threshold actions)
* Unit tests: crisis routing (sends response, applies hold, creates incident)

**Verification:**

* Message containing a `violence_threats` keyword → `safety_incidents` row with correct category and severity
* Message containing `self_harm` keyword with `critical` severity → crisis response sent, hold applied, message not processed further
* "therapist" does NOT trigger a match for "the rapist" (word boundary matching)
* User sending 21 messages in 5 minutes → 21st message rate-limited, incident created
* User with 2.0 effective strikes → `global_hold` applied with 24-hour expiry
* User with 3.0 effective strikes → indefinite hold, flagged for admin review
* Hold is idempotent: applying the same hold twice does not create duplicate rows
* Keyword list version is logged with every detection event
* All safety events use correlation IDs from the inbound message

---

### Ticket 11.2 — Block/Report Flows

**Goal:** Implement SMS-based block and report commands with target identification, guided report flow, incident creation, and admin review queue integration.

**Background:**

Block and report tables exist (`user_blocks`, `user_reports`), and block exclusion is enforced in matching candidate selection. However, there is no SMS command parsing for "BLOCK" or "REPORT", no guided report flow, no incident creation from reports, and no admin review queue. This ticket implements the full user-facing block/report flows as specified in Doc 13.

**Requirements:**

**Block Flow:**
* Create `packages/core/src/safety/block-handler.ts`:
  * Export `handleBlockCommand(userId: string, messageBody: string, session: ConversationSession): Promise<BlockResult>`
  * Parse: `BLOCK {name}` or `BLOCK {number}` — extract target identifier
  * Target identification:
    * If name matches exactly one participant from the user's most recent locked/completed LinkUp → resolve to that user
    * If name matches multiple or zero → ask one clarifier with numbered options (`"Who would you like to block? 1) Alex from Saturday's coffee 2) Jordan from last week's hike"`)
    * If number provided (from contact exchange reveal) → resolve by phone match
    * If no recent LinkUp context → ask clarifier: `"Who would you like to block? Reply with their first name."`
  * Once target resolved:
    * Insert `user_blocks` row: `(blocker_user_id, blocked_user_id)` with unique constraint — on conflict, return "already blocked"
    * Create `safety_incidents` row: `{ category: 'user_block', severity: 'low', user_id: blocker, subject_user_id: blocked, idempotency_key: 'block:{blocker_id}:{blocked_id}' }`
    * Send `SAFETY_BLOCK_CONFIRMED` template interpolated with `{ blockedName }`
    * Log: `safety.block_applied` with `{ blocker_user_id, blocked_user_id, correlation_id }`
  * Edge case: user tries to block someone they haven't been in a LinkUp with → allow the block (defensive), but log `safety.block_no_linkup_context`
  * Edge case: user tries to block themselves → reject with message `"You can't block yourself."`

**Report Flow:**
* Create `packages/core/src/safety/report-handler.ts`:
  * Export `handleReportCommand(userId: string, messageBody: string, session: ConversationSession): Promise<ReportResult>`
  * Parse: `REPORT {name}` or just `REPORT` (guided flow)
  * If target not specified or ambiguous:
    * Send clarifier with recent LinkUp participants (same logic as block target identification)
  * Once target resolved, send reason category prompt:
    * `"Thanks for reporting. What happened? Reply with a number:\n1) Made me uncomfortable\n2) Inappropriate messages\n3) Didn't show up / wasted my time\n4) Safety concern\n5) Other"`
  * Parse reason reply: `1`-`5` → map to reason category enum
  * Create `user_reports` row: `{ reporter_user_id, reported_user_id, reason_category, reason_text: null, status: 'pending', idempotency_key: 'report:{reporter_id}:{reported_id}:{timestamp_bucket}' }` (timestamp bucket = YYYYMMDD to allow one report per pair per day)
  * Create `safety_incidents` row: `{ category: 'user_report', severity: 'medium', user_id: reporter, subject_user_id: reported, status: 'open' }`
  * Apply temporary `match_hold` on the reported user (prevent matching while under review)
  * Send `SAFETY_REPORT_RECEIVED` template to the reporter
  * Log: `safety.report_created` with `{ reporter_user_id, reported_user_id, reason_category, correlation_id }`
* The report flow requires a temporary session mode change — set `mode: 'report_flow'` with state tokens `report:awaiting_target`, `report:awaiting_reason`
  * Register `report_flow` mode in the conversation router (same pattern as Ticket 10.1)
  * When report flow completes, restore previous session mode

**Integration with conversation router:**
* Both BLOCK and REPORT can be triggered from any session mode (they are high-priority intents)
* Update intent detection in the conversation router to recognize `BLOCK` and `REPORT` as keywords (before LLM classification):
  * Regex: `^\s*(BLOCK|REPORT)\s*(.*)$` (case-insensitive)
  * If matched: route to block/report handler, bypass normal intent classification
* After block/report completes, return to previous session mode

**Deliverables:**

* `packages/core/src/safety/block-handler.ts`
* `packages/core/src/safety/report-handler.ts`
* Updated `conversation-router.ts` (BLOCK/REPORT intent detection, report_flow mode)
* Updated state token validator (report: prefix)
* Unit tests: block command parsing (name, number, ambiguous, self-block)
* Unit tests: report flow (target identification, reason selection, incident creation)
* Unit tests: idempotency (duplicate block → "already blocked", duplicate report within same day → conflict handled)
* Unit tests: report flow session mode transitions (mode change → report → restore)

**Verification:**

* User sends `BLOCK Alex` → `user_blocks` row created, confirmation sent, Alex excluded from future matches
* User sends `BLOCK` with no name → receives clarifier with recent LinkUp participants
* User sends `BLOCK` when they have no recent LinkUps → receives `"Who would you like to block? Reply with their first name."`
* User sends `REPORT` → guided flow: target clarifier → reason prompt → report created → hold applied to reported user
* Duplicate block (same pair) → "already blocked" message, no duplicate row
* Report creates both `user_reports` row AND `safety_incidents` row
* Blocked pairs never appear in match candidate lists (verify existing matching exclusion still works)
* Report flow correctly saves and restores the previous session mode
* `BLOCK` command works mid-interview, mid-post-event, and from idle mode

---

### Ticket 11.3 — Safety Holds Integration with Conversation Router

**Goal:** Ensure safety holds interrupt all active conversation flows (onboarding, interview, post-event) and that held users receive appropriate messaging.

**Background:**

Safety holds exist in the DB and are checked at key gates (matching, LinkUp lock, contact exchange reveal). However, the gap analysis identified that holds do not currently interrupt onboarding or interview flows. A user on a safety hold should not be able to continue their interview, and JOSH should acknowledge the hold status rather than silently continuing as if nothing happened. This ticket adds hold awareness to every conversation flow.

Cross-phase gap addressed: integration of safety holds with the Phase 8 conversation router.

**Requirements:**

* Update the conversation router's main dispatch function (in `conversation-router.ts`):
  * After loading the conversation session and BEFORE routing to any handler (onboarding, interview, post-event, etc.):
    * Query `safety_holds` for the user via `@josh/db`: `getActiveHolds(userId)`
    * If any active hold exists with `hold_type` in (`global_hold`, `linkup_hold`):
      * Do NOT route to the normal handler
      * If this is the FIRST message since the hold was applied (check: `hold.notified_at` is null or session doesn't have `hold_acknowledged` flag):
        * Send `SAFETY_HOLD_NOTICE` template
        * Mark the hold as notified: update `safety_holds.notified_at`
      * If user sends further messages while on hold:
        * Reply: `"Your account is still paused. Reply HELP if you need assistance."`
        * Do NOT advance any conversation state
      * Log: `safety.hold_intercepted` with `{ user_id, hold_type, session_mode, correlation_id }`
  * If hold is lifted (no active holds) and session was previously interrupted:
    * On next inbound message: resume the previous conversation flow from where it left off
    * The session mode and state token are preserved (not reset) during the hold
    * Send: `"Welcome back. Let's pick up where we left off."` followed by the appropriate context message (e.g., the next interview question)
* Handle hold expiration:
  * Holds with `expires_at` that have passed → treated as lifted (not active)
  * No explicit "hold expired" notification is sent — the user simply resumes on next message
* Handle HELP during hold:
  * HELP is already handled by STOP/HELP precedence routing — ensure it still works when user is on hold
  * The HELP response should include: `"If you believe this is a mistake, contact support at [support email]."`
* Ensure all session modes are hold-aware: `onboarding`, `interviewing`, `post_event`, `idle`, `report_flow`, `awaiting_invite_reply`
  * Note: `awaiting_invite_reply` is expected to exist from Phase 7 (LinkUp Orchestration). If Phase 7 has not yet registered this mode in the conversation router, add it to Ticket 10.1's mode registration as part of this phase.

**Deliverables:**

* Updated `conversation-router.ts` (hold check before dispatch)
* Updated `safety_holds` handling (notified_at tracking)
* Unit tests: hold intercepts onboarding message (user on hold receives notice, no onboarding progress)
* Unit tests: hold intercepts interview message (user on hold, interview paused)
* Unit tests: hold intercepts post-event message (user on hold, post-event paused)
* Unit tests: hold lifted → user resumes from correct state
* Unit tests: expired hold → user can proceed normally

**Verification:**

* User mid-interview receives a hold → next message gets `SAFETY_HOLD_NOTICE`, interview does not advance
* User sends 3 more messages while on hold → each gets `"Your account is still paused..."`, no state change
* Hold expires after 24 hours → user sends message → interview resumes at correct step
* User on hold sends HELP → receives help message with support contact
* Hold applied during onboarding → onboarding paused, no burst sent
* Hold applied during post-event → post-event paused, no prompts sent
* Session mode and state token are preserved across hold duration (not reset to idle)

---

## Phase 12 — Admin Dashboard (PWA)

This phase implements the admin dashboard for operational visibility and controls, plus a member-facing dashboard update for interview progress and profile completeness. It depends on Phase 11 (Safety) for safety incident views.

---

### Ticket 12.1 — Admin Auth + RBAC

**Goal:** Implement secure admin authentication with role-based access control and audit logging.

**Background:**

The `admin_users` table exists in the schema but no auth implementation exists. The admin dashboard requires authentication and role-based access to protect sensitive operations (user data, safety incidents, entitlement overrides). Doc 5 references an `engineering` role for replay tools; Doc 13 references admin roles for safety triage.

**Requirements:**

* Implement admin auth using Supabase Auth magic link flow:
  * Admin users are pre-provisioned in `admin_users` table (no self-registration)
  * Login flow: admin enters email → receives magic link → clicks link → session created
  * Session management: Supabase Auth session with JWT, refreshed automatically
  * Create `apps/web/app/admin/login/page.tsx` — login form with email input and magic link send
  * Create `apps/web/middleware.ts` (or update existing) — protect all `/admin/*` routes:
    * Check Supabase Auth session exists
    * Verify email matches a row in `admin_users` with `status = 'active'`
    * Verify role meets minimum required for the route
* Define role hierarchy:
  * `viewer` — read-only access to all admin views
  * `operator` — viewer + can manage safety incidents (triage, resolve), manage holds (lift)
  * `engineering` — operator + can use replay tools, view detailed logs, manage conversation states
  * `super_admin` — all permissions + can manage admin users, entitlement overrides
* Create `packages/core/src/admin/rbac.ts`:
  * Export `checkPermission(adminRole: AdminRole, requiredRole: AdminRole): boolean`
  * Role hierarchy: `super_admin > engineering > operator > viewer`
  * Export middleware helper: `requireRole(role: AdminRole)` for use in API routes
* Implement audit logging:
  * Every admin action writes to `audit_log` table via `@josh/db`:
    * `{ admin_user_id, action, target_type, target_id, details: jsonb, ip_address, correlation_id, created_at }`
  * Actions to log: login, view user detail, lift hold, override entitlement, triage incident, resolve incident, manage admin user
  * Create `packages/core/src/admin/audit.ts`:
    * Export `logAdminAction(params: AuditLogParams): Promise<void>`

**Deliverables:**

* `apps/web/app/admin/login/page.tsx`
* Updated `apps/web/middleware.ts` (admin route protection)
* `packages/core/src/admin/rbac.ts`
* `packages/core/src/admin/audit.ts`
* `admin_users` seed for staging (with your admin account as `super_admin`)
* Unit tests: role hierarchy (each role has correct permissions)
* Unit tests: audit logging (actions produce correct audit rows)

**Verification:**

* Non-admin email cannot access `/admin/*` routes (redirected to login)
* Admin with `viewer` role can view all pages but cannot triage incidents (action buttons disabled/hidden)
* Admin with `operator` role can triage and resolve incidents
* Every admin action produces an `audit_log` row with correct `admin_user_id` and `action`
* Magic link login works in staging (email received, session created)
* Session expiry redirects to login page

---

### Ticket 12.2 — Admin Ops Views

**Goal:** Implement operational visibility views for users, messaging, LinkUps, safety incidents, billing, and regions.

**Background:**

The admin dashboard needs six core views for operational management. Each view must account for the Phase 8 conversation redesign (showing onboarding/interview progress, conversation session state) and the safety system (incident triage workflow). Doc 5 specifies admin replay tools for debugging; Doc 13 specifies the incident triage workflow.

**Requirements:**

**Users and Profiles View (`apps/web/app/admin/users/page.tsx`):**
* User list with search (by name, phone, email) and filters (by status, region, profile state)
* User detail page (`apps/web/app/admin/users/[id]/page.tsx`):
  * Profile data: all profile fields, fingerprint factors, activity patterns, group size preference
  * Interview progress: current session mode, state token, signal coverage status (from Ticket 8.4's signal coverage tracker), last activity timestamp
  * Profile completeness: which signals are covered vs. uncovered, mvpComplete status
  * Conversation history: recent inbound/outbound messages (latest 50, paginated)
  * Current session state: mode, state token, context
  * Entitlement status: current entitlements, subscription state, any admin overrides
  * Safety history: incidents, holds, blocks (given and received)
* Admin action: manually advance or reset conversation state (engineering role required):
  * Set session mode and state token to specified values
  * Logs action to audit log

**Messaging Timeline View (`apps/web/app/admin/messaging/page.tsx`):**
* SMS timeline per user: all inbound and outbound messages, chronologically ordered
* Filter by direction (inbound/outbound), date range, purpose
* Show delivery status for outbound (sent, delivered, failed, undelivered)
* Resend tool (engineering role required): re-enqueue a failed outbound message as a new `sms_outbound_jobs` row
* Show correlation IDs for each message for cross-referencing with logs

**LinkUps and State View (`apps/web/app/admin/linkups/page.tsx`):**
* LinkUp list with filters (by state, region, date range)
* LinkUp detail page:
  * State, timestamps (created, broadcasting started, locked, event time)
  * Participant list with roles (initiator, participant)
  * Invite history: all invites with states (pending, accepted, declined, expired, closed)
  * Post-event outcomes (if completed): attendance, do-again, feedback per participant
  * Contact exchange status per participant pair
* Admin action: cancel a stuck LinkUp (operator role required)

**Safety Incidents and Holds View (`apps/web/app/admin/safety/page.tsx`):**
* Incident queue: list of open incidents sorted by severity (critical first), then by created_at
* Filters: by severity, category, status (open, triaged, resolved, escalated)
* Incident detail: user info, message content (redacted per PII rules — show only category and severity, not raw text unless engineering role), trigger type (keyword, rate limit, report)
* Triage workflow (operator role required):
  * Assign to self → status: `triaged`
  * Resolve with resolution notes → status: `resolved`
  * Escalate with notes → status: `escalated`
* Hold management: list of active holds with lift action (operator role required)
  * Lift hold: sets `safety_holds.lifted_at`, logs to audit
* User suspension: suspend user (sets user status to `suspended`), unsuspend (engineering role required)

**Billing Status View (`apps/web/app/admin/billing/page.tsx`):**
* User billing overview: subscription state, current period, cancel status
* Entitlement overrides: list of active overrides with create/deactivate actions (super_admin role required)
  * Create override: specify user, entitlement flags, expiry, reason
  * Deactivate override: sets `admin_overrides.active = false`
* Recent billing events: Stripe webhook events with processing status

**Regions and Waitlist View (`apps/web/app/admin/regions/page.tsx`):**
* Region list: status, user count, waitlist count, density
* Region management: change status (close, pause, open) — operator role required
* Waitlist per region: user list with status, joined date
* Batch activation tool: activate a batch of waitlist users (triggers onboarding) — operator role required

**Note on observability events:** The admin dashboard does not include a dedicated log viewer or observability events feed. Operational log visibility is provided by external tooling (Vercel Logs for structured log events, Sentry for error tracking) as configured in Phase 13. The User Detail page (above) provides conversation session state and message history, which covers the primary admin debugging needs for Phase 8 conversation flows. If a dedicated admin log viewer is needed later, it can be added as a follow-up ticket.

**Deliverables:**

* `apps/web/app/admin/users/page.tsx` + `[id]/page.tsx`
* `apps/web/app/admin/messaging/page.tsx`
* `apps/web/app/admin/linkups/page.tsx`
* `apps/web/app/admin/safety/page.tsx`
* `apps/web/app/admin/billing/page.tsx`
* `apps/web/app/admin/regions/page.tsx`
* Admin layout component with navigation sidebar
* All views use `@josh/db` for data access
* All admin actions write to `audit_log`

**Verification:**

* Admin can search for a user by phone number and see their full profile, interview progress, and conversation history
* Admin can see a user's signal coverage status and which interview signals are missing
* Admin can view a LinkUp's full lifecycle: creation, invites, lock, outcomes, exchanges
* Admin can triage a safety incident: open → triaged → resolved, with audit log entries at each step
* Admin can lift a safety hold, and the user can resume their conversation on next message
* Admin can create an entitlement override for a user, and that user's `evaluateEligibility()` returns `allowed`
* Admin can activate a batch of waitlist users, and each receives the onboarding opening message
* Resend tool re-enqueues a failed outbound message and the message is sent
* All admin views respect role-based access (viewer cannot triage, operator cannot override entitlements)

---

### Ticket 12.3 — Member Dashboard: Interview Progress + Profile Completeness

**Goal:** Add interview progress display and profile completeness indicator to the member-facing dashboard.

**Background:**

The Phase 8 redesign introduces an adaptive interview with signal coverage tracking. Members should be able to see their interview progress on the dashboard — which signals are captured, how far they are from `complete_mvp`, and how to resume if they dropped out. This addresses **Gap 7 (Member Dashboard)** from the gap analysis.

**Requirements:**

* Create `apps/web/app/dashboard/profile/page.tsx` (or update existing profile page):
  * Interview progress section:
    * Call signal coverage tracker (from Ticket 8.4): `getSignalCoverageStatus(profile)`
    * Display: "Profile X% complete" where percentage = (covered signals / total required signals) × 100
    * Show which signal categories are complete (green check) vs. incomplete (gray):
      * Friend Fingerprint factors: X of 8 required captured
      * Activity patterns: X of 3 required captured
      * Group size preference: captured / not captured
      * Time preference: captured / not captured
      * Boundaries: asked / not asked
    * If `mvpComplete === false`: show "Continue your interview — just text JOSH to pick up where you left off" with the JOSH phone number
    * If `mvpComplete === true`: show "Profile complete — you're ready for LinkUps"
  * Profile summary section:
    * Display captured profile data in a user-friendly format (not raw JSON)
    * Activity interests with strength indicators
    * Schedule preferences
    * Group size preference
  * Profile update prompt:
    * Button: "Update my profile" — shows instructions: "Text JOSH 'I want to update my profile' to start"
    * Links to Ticket 4.3 (Profile Update Flow) for the update mechanism
* Ensure the page is accessible without login issues (uses member auth, not admin auth)
* Mobile-responsive (dashboard is PWA)

**Deliverables:**

* `apps/web/app/dashboard/profile/page.tsx` (interview progress + profile completeness)
* API route for fetching profile and signal coverage: `apps/web/app/api/profile/coverage/route.ts`
* Mobile-responsive styling
* Unit tests for signal coverage percentage calculation

**Verification:**

* User with 4 of 8 fingerprint factors, 2 of 3 activities, group size captured, time not captured, boundaries not asked → displays approximately 55% complete with correct green/gray indicators
* User with `mvpComplete === true` → shows "Profile complete" message
* User with `mvpComplete === false` → shows "Continue your interview" with phone number
* Page loads correctly on mobile viewport (375px width)
* Profile data displays in human-readable format (not raw JSON or technical field names)

---

## Phase 13 — Observability + Ops

This phase implements the full observability stack specified in Doc 5: structured logging with canonical events, error tracking with Sentry, and metrics with alerting. All three tickets are rewritten to match Doc 5's detail level and include the new event categories introduced by Phase 8.

**Phase dependencies:**
* Phase 8 (SMS Conversation Redesign) — new log events and metrics for onboarding, interview, LLM extraction
* Phase 9 (Foundational Packages) — logging utilities may be shared via packages

---

### Ticket 13.1 — Structured Logging + Correlation IDs

**Goal:** Implement the complete structured logging framework with canonical log events, correlation ID propagation, and PII redaction.

**Background:**

The codebase has partial structured logging and correlation IDs in some paths. Doc 5 specifies 30+ canonical log events across 7 categories. This ticket implements the full logging framework, ensures correlation IDs propagate through all code paths, adds PII redaction, and includes the new event categories from Phase 8 (onboarding bursts, LLM extraction, signal coverage, interview completion).

**Requirements:**

**Logging Framework:**
* Create `packages/core/src/observability/logger.ts`:
  * Export `createLogger(context: LogContext): Logger`
  * `LogContext`: `{ correlationId: string, env: string, handler?: string }`
  * `Logger` interface: `info(event, data?)`, `warn(event, data?)`, `error(event, data?)`, `fatal(event, data?)`
  * Output format: JSON with required keys: `ts` (ISO 8601), `level`, `event`, `env`, `correlation_id`
  * Optional keys: `user_id`, `phone_hash`, `linkup_id`, `invite_id`, `stripe_event_id`, `twilio_message_sid`, `handler`, `duration_ms`, `attempt`, `error_code`, `error_message`
  * All log output goes to `stdout` (Vercel captures and forwards)
  * Never log: raw SMS body, full phone numbers, API keys, tokens, passwords
* Create `packages/core/src/observability/pii-redactor.ts`:
  * Export `redact(data: Record<string, unknown>): Record<string, unknown>`
  * Redaction rules:
    * Phone numbers: replace with `***-***-{last4}`
    * SMS body: replace with `[REDACTED SMS BODY]`
    * Email: replace with `***@{domain}`
  * Export `phoneHash(phoneE164: string): string` — SHA-256 of phone + pepper (for correlation without PII)
  * Apply automatically to all log data before output

**Correlation ID Propagation:**
* Create `packages/core/src/observability/correlation.ts`:
  * Export `generateCorrelationId(): string` — UUID v4
  * Export `withCorrelation(correlationId: string, fn: () => Promise<T>): Promise<T>` — AsyncLocalStorage-based context propagation
  * Export `getCorrelationId(): string | undefined` — reads from current async context
* Correlation ID must be generated at the entry point of:
  * Twilio inbound webhook
  * Twilio status callback
  * Stripe webhook
  * Vercel Cron runner invocations
  * Admin API actions
* Correlation ID must be included in:
  * All `sms_messages` rows (already exists as column)
  * All `sms_outbound_jobs` rows
  * All `domain_events` / `audit_log` rows
  * All Sentry error reports (as tag)
  * All structured log entries

**Canonical Log Events:**
* Implement the following events (each emitted at the appropriate code location):

  **Inbound SMS:**
  * `sms.inbound.received` — message persisted, before routing
  * `sms.inbound.duplicate_sid` — duplicate MessageSid detected
  * `sms.inbound.signature_invalid` — Twilio signature validation failed
  * `sms.inbound.routed` — message routed to handler (include handler name)

  **Outbound SMS:**
  * `sms.outbound.job_created` — outbound job enqueued
  * `sms.outbound.send_attempt` — Twilio REST API call initiated
  * `sms.outbound.sent` — Twilio returned success (include MessageSid)
  * `sms.outbound.failed` — Twilio returned error (include error code)

  **LLM:**
  * `llm.intent.request` — intent classification call initiated
  * `llm.intent.response` — intent classification returned (include intent, confidence)
  * `llm.intent.invalid_json` — LLM returned invalid JSON
  * `llm.intent.fallback_clarifier` — falling back to clarifier
  * `llm.extraction.request` — signal extraction call initiated
  * `llm.extraction.response` — extraction returned (include signals extracted count)
  * `llm.extraction.invalid_json` — extraction returned invalid JSON
  * `llm.extraction.fallback_regex` — falling back to regex parser
  * `llm.extraction.timeout` — extraction call timed out

  **Onboarding + Interview (NEW for Phase 8):**
  * `onboarding.burst_started` — burst delivery initiated
  * `onboarding.burst_completed` — all burst messages sent
  * `onboarding.burst_message_sent` — individual burst message sent (include message index)
  * `onboarding.burst_message_failed` — individual burst message failed
  * `interview.step_advanced` — moved to next signal target
  * `interview.signal_extracted` — signal written to profile (include signal key, confidence)
  * `interview.mvp_complete` — signal coverage reached mvpComplete
  * `interview.dropout_nudge_sent` — dropout nudge fired
  * `interview.dropout_resumed` — user resumed after dropout
  * `conversation.session_mode_changed` — session mode transitioned (include from/to)

  **LinkUp:**
  * `linkup.created` — LinkUp created
  * `linkup.broadcasting_started` — broadcasting initiated
  * `linkup.invite_wave_sent` — invite wave sent (include wave number, invite count)
  * `linkup.lock_attempt` — lock attempt initiated
  * `linkup.locked` — LinkUp locked
  * `linkup.expired` — LinkUp expired
  * `linkup.canceled` — LinkUp canceled

  **Post-Event (NEW for Phase 10):**
  * `post_event.runner.started` — runner started processing
  * `post_event.runner.linkup_processed` — individual LinkUp processed
  * `post_event.attendance_recorded` — attendance response recorded
  * `post_event.do_again_recorded` — do-again response recorded
  * `post_event.contact_exchange.mutual_detected` — mutual yes detected
  * `post_event.contact_exchange.reveal_sent` — reveal message sent
  * `post_event.contact_exchange.reveal_suppressed` — reveal suppressed (include reason)

  **Safety:**
  * `safety.keyword_hit` — keyword detected (include category, severity)
  * `safety.incident_created` — incident row created
  * `safety.hold_applied` — hold applied to user
  * `safety.hold_lifted` — hold lifted
  * `safety.hold_intercepted` — message intercepted by active hold
  * `safety.crisis_routed` — crisis keyword handled
  * `safety.rate_limit_hit` — rate limit triggered
  * `safety.block_applied` — user blocked another
  * `safety.report_created` — report filed

  **Billing:**
  * `stripe.webhook.received` — Stripe webhook received
  * `stripe.webhook.duplicate_event` — duplicate Stripe event ID
  * `entitlement.updated` — entitlement flags changed

* Wire each event into the appropriate code location across all packages

**Deliverables:**

* `packages/core/src/observability/logger.ts`
* `packages/core/src/observability/pii-redactor.ts`
* `packages/core/src/observability/correlation.ts`
* Updated all handlers and engines to emit canonical events (list above)
* Unit tests: logger output format (JSON with required keys)
* Unit tests: PII redaction (phone, SMS body, email)
* Unit tests: correlation ID propagation (set in entry point, available in nested calls)

**Verification:**

* Every inbound SMS produces a `sms.inbound.received` log entry with `correlation_id`, `twilio_message_sid`, `user_id`, `phone_hash` (NOT full phone number)
* Every outbound SMS produces `sms.outbound.send_attempt` and either `sms.outbound.sent` or `sms.outbound.failed`
* Every LLM call produces `llm.extraction.request` and `llm.extraction.response` (or `timeout`/`invalid_json`/`fallback_regex`)
* Onboarding burst produces `onboarding.burst_started`, N × `onboarding.burst_message_sent`, `onboarding.burst_completed`
* No log entry contains a raw SMS body or full phone number
* Correlation ID is present in ALL log entries for a single request lifecycle
* Log entries are valid JSON parseable by standard log aggregation tools

---

### Ticket 13.2 — Error Tracking (Sentry)

**Goal:** Implement Sentry error tracking for the Next.js application with proper event categorization, PII scrubbing, and performance monitoring.

**Background:**

No error tracking exists in the codebase. Doc 5 specifies Sentry configuration with severity levels, 12 event categories, required tags, PII rules, and performance monitoring with sampling rates. Phase 8 introduces new error categories (LLM invalid JSON, extraction timeout) that must be captured.

**Requirements:**

* Install and configure `@sentry/nextjs`:
  * Create `sentry.client.config.ts` — client-side Sentry initialization
  * Create `sentry.server.config.ts` — server-side Sentry initialization
  * Create `sentry.edge.config.ts` — edge runtime Sentry initialization (for API routes)
  * Update `next.config.js` to include Sentry webpack plugin
* Configure DSN via env var: `SENTRY_DSN` (staging and production)
* Environment tagging: `SENTRY_ENVIRONMENT` = `APP_ENV` value
* Severity levels: `fatal`, `error`, `warning`, `info`
* Event categories (set as Sentry tag `category`):
  * `sms_inbound` — errors in inbound webhook processing
  * `sms_outbound` — errors in outbound send pipeline
  * `stripe_webhook` — errors in Stripe webhook processing
  * `llm_intent` — errors in LLM intent classification
  * `llm_extraction` — errors in LLM signal extraction (invalid JSON, timeout, unexpected response)
  * `linkup_orchestration` — errors in LinkUp state transitions
  * `matching_scoring` — errors in compatibility scoring
  * `dashboard_auth` — errors in admin/member auth
  * `safety_escalation` — errors in safety processing
  * `admin_action` — errors in admin operations
  * `post_event` — errors in post-event flow processing
  * `db_schema` — errors in DB queries or migrations
* Required tags on all events: `env`, `correlation_id`, `user_id` (if available)
* Optional tags: `linkup_id`, `invite_id`, `stripe_event_id`, `twilio_message_sid`
* PII scrubbing configuration:
  * `beforeSend` hook: strip any field containing `phone`, `sms_body`, `message_body`, `email` (unless it's the field name only)
  * Never send: raw SMS body, full phone numbers, API keys, auth tokens
  * Allowed: `user_id`, `phone_hash`, last 2 digits of phone
* Performance monitoring:
  * Transaction recording for: API routes, cron jobs, webhook handlers
  * Sampling rates: `tracesSampleRate: 1.0` for staging, `tracesSampleRate: 0.1` for production
  * Custom spans for: LLM calls (track latency), DB queries (track latency), Twilio sends
* Create `packages/core/src/observability/sentry.ts`:
  * Export `captureError(error, context: SentryContext): void` — wrapper that adds standard tags and scrubs PII
  * Export `startSpan(name, op): Span` — wrapper for performance spans
  * `SentryContext`: `{ category: EventCategory, correlationId, userId?, additionalTags? }`

**Deliverables:**

* `sentry.client.config.ts`
* `sentry.server.config.ts`
* `sentry.edge.config.ts`
* Updated `next.config.js`
* `packages/core/src/observability/sentry.ts`
* PII scrubbing tests (ensure phone/SMS body never reaches Sentry)
* Integration in key error paths: LLM invalid JSON, Twilio send failure, Stripe webhook error, DB query error

**Verification:**

* An unhandled exception in an API route appears in Sentry with correct `env`, `correlation_id`, and `category` tags
* LLM returning invalid JSON → Sentry event with `category: 'llm_extraction'`, `level: 'warning'`
* Twilio send failure → Sentry event with `category: 'sms_outbound'`, `level: 'error'`
* No Sentry event contains a raw SMS body or full phone number (PII scrubbing verified)
* Performance traces show LLM call latency as custom spans
* Staging sends 100% of transactions; production sends ~10%

---

### Ticket 13.3 — Metrics + Alerting

**Goal:** Implement operational metrics emission, dashboard specifications, and alert thresholds as defined in Doc 5.

**Background:**

No metrics adapter, dashboards, or alerting exists. Doc 5 specifies 17 counters, 6 histograms, 3 gauges, 4 dashboards, and alert thresholds. Phase 8 introduces new metrics: onboarding completion rate, interview completion rate, LLM extraction success rate, signal coverage progress. This ticket implements the full metrics stack.

**Requirements:**

**Metrics Emitter:**
* Create `packages/core/src/observability/metrics.ts`:
  * Export `incrementCounter(name: string, labels?: Record<string, string>): void`
  * Export `recordHistogram(name: string, value: number, labels?: Record<string, string>): void`
  * Export `setGauge(name: string, value: number, labels?: Record<string, string>): void`
  * Backend: For MVP, emit metrics as structured log events with `level: 'metric'` and `event: 'metric.{name}'`. This allows metrics to be extracted from log aggregation without requiring a dedicated metrics backend initially.
  * Each metric emission includes: `ts`, `metric_name`, `metric_type` (counter/histogram/gauge), `value`, `labels`, `env`
  * If a dedicated metrics backend is added later (e.g., Prometheus, Datadog), the emitter interface stays the same — only the backend changes.

**Counters (17 + 5 new for Phase 8):**
* `sms_inbound_total{env}` — total inbound SMS received
* `sms_outbound_sent_total{env, purpose}` — total outbound SMS sent, labeled by purpose (onboarding, interview, post_event, safety, linkup, reminder)
* `sms_outbound_failed_total{env, purpose, reason}` — total outbound failures
* `linkups_created_total{env, region}` — total LinkUps created
* `linkups_locked_total{env, region}` — total LinkUps locked
* `linkups_expired_total{env, region}` — total LinkUps expired
* `invites_sent_total{env, region}` — total invites sent
* `invites_accepted_total{env, region}` — total invites accepted
* `invites_declined_total{env, region}` — total invites declined
* `safety_incidents_total{env, category, severity}` — total safety incidents
* `safety_holds_applied_total{env, hold_type}` — total holds applied
* `safety_blocks_total{env}` — total blocks
* `safety_reports_total{env}` — total reports
* `stripe_webhooks_total{env, event_type}` — total Stripe webhooks
* `stripe_webhooks_failed_total{env, event_type}` — total Stripe webhook processing failures
* `entitlement_overrides_total{env}` — total admin entitlement overrides
* `rate_limits_hit_total{env, action}` — total rate limit triggers
* **NEW** `onboarding_burst_completed_total{env}` — total onboarding bursts completed
* **NEW** `onboarding_burst_failed_total{env}` — total onboarding bursts with at least one failure
* **NEW** `interview_mvp_complete_total{env}` — total interviews reaching complete_mvp
* **NEW** `llm_extraction_total{env, result}` — LLM extraction calls (result: success, invalid_json, timeout, fallback)
* **NEW** `llm_tokens_used_total{env, model, direction}` — LLM token consumption (direction: input, output). Used with a per-token cost lookup to derive estimated monthly LLM cost in the cost dashboard.
* **NEW** `interview_dropout_nudge_total{env}` — total dropout nudges sent

**Histograms (6 + 4 new for Phase 8):**
* `api_latency_ms{env, route}` — API route response time
* `llm_latency_ms{env, model}` — LLM call latency
* `time_to_lock_minutes{env, region}` — time from broadcasting to lock
* `time_to_first_reply_minutes{env}` — time from outbound to first inbound reply
* `twilio_send_latency_ms{env}` — Twilio REST API call latency
* `stripe_webhook_processing_ms{env}` — Stripe webhook processing time
* **NEW** `onboarding_burst_duration_ms{env}` — total burst delivery time
* **NEW** `interview_exchanges_to_mvp{env}` — number of exchanges to reach complete_mvp
* **NEW** `signal_coverage_at_completion{env}` — signal coverage percentage when mvpComplete triggers
* **NEW** `post_event_response_time_minutes{env, step}` — time from prompt to response per post-event step

**Gauges (3):**
* `outbound_job_backlog{env}` — count of pending outbound jobs
* `active_linkups{env, region}` — count of LinkUps in broadcasting or locked state
* `users_interviewing{env}` — count of users with `mode: 'interviewing'`

**Wire metrics emission into code:**
* Every counter/histogram must be emitted at the appropriate code location
* Add metric emission to: inbound handler, outbound sender, LLM caller, LinkUp state transitions, safety incident creation, Stripe webhook handler, onboarding engine, interview engine, post-event runner

**Alert Thresholds:**
* Create `docs/ops/alert-definitions.md` documenting all alerts:
  * **Critical (page immediately):**
    * `sms_outbound_failed_total` > 5% of `sms_outbound_sent_total` in 15 minutes
    * Twilio inbound webhook 5xx rate > 2% in 5 minutes
    * Stripe webhook 5xx rate > 1% in 5 minutes
    * `outbound_job_backlog` > 100 for 10+ minutes
  * **High (alert within 1 hour):**
    * `llm_extraction_total{result=invalid_json}` > 1% of total extractions in 30 minutes
    * LinkUp lock rate drops > 30% week-over-week
    * `interview_mvp_complete_total` drops > 50% day-over-day
  * **Medium (daily review):**
    * Clarifier rate > 20% of inbound messages
    * Invite accept rate drops below 30%
    * Average `interview_exchanges_to_mvp` increases > 20% week-over-week
    * `onboarding_burst_failed_total` > 0 in any 24-hour period
* Alert implementation: For MVP, alerts are implemented as checks in a daily Vercel Cron job that queries recent metrics from logs and sends notifications via a configurable webhook (Slack, email, or PagerDuty)
* Create `apps/web/app/api/cron/alert-check/route.ts`:
  * Runs on schedule (every 15 minutes for critical, hourly for high, daily for medium)
  * Queries metric log events from the last window period
  * If any threshold is breached, sends alert via configured webhook

**Dashboard Specifications:**
* Create `docs/ops/dashboard-specs.md` documenting 4 dashboard panels:
  * **Product Health:** onboarding completion rate, interview completion rate, LinkUp lock rate, invite accept rate, post-event response rate
  * **Reliability:** outbound failure rate, LLM success rate, API latency p50/p95/p99, webhook processing latency
  * **Safety:** incidents by category/severity, holds active, blocks/reports trend
  * **Cost:** Twilio sends per day (from `sms_outbound_sent_total`), LLM calls per day (from `llm_extraction_total`), LLM token usage (from `llm_tokens_used_total`), estimated monthly cost per provider (derived: token count × per-token rate for Anthropic, message count × per-segment rate for Twilio)

**Deliverables:**

* `packages/core/src/observability/metrics.ts`
* Updated handlers/engines with metric emissions (all counters, histograms, gauges wired in)
* `apps/web/app/api/cron/alert-check/route.ts`
* `docs/ops/alert-definitions.md`
* `docs/ops/dashboard-specs.md`
* Unit tests: metric emission produces correct structured log events
* Unit tests: alert threshold checks (breach detection logic)

**Verification:**

* Every inbound SMS increments `sms_inbound_total` (visible in log stream as `metric.sms_inbound_total`)
* Every LLM extraction call records `llm_latency_ms` histogram
* Every onboarding burst completion increments `onboarding_burst_completed_total`
* An interview completing in 7 exchanges records `interview_exchanges_to_mvp` value of 7
* Alert check cron detects when `sms_outbound_failed_total` exceeds 5% threshold and sends notification
* `docs/ops/alert-definitions.md` contains all thresholds listed above with clear escalation procedures
* `docs/ops/dashboard-specs.md` describes all 4 dashboards with specific panel definitions

---

## Phase 14 — Testing + E2E Harness

This phase creates the testing infrastructure for end-to-end validation of the complete system. It depends on all previous phases being implemented.

---

### Ticket 14.1 — Twilio Simulator Harness

**Goal:** Create a Twilio simulator that can exercise the full conversation system end-to-end in staging without real SMS, supporting the new in-process sequential delivery pattern.

**Background:**

No Twilio simulator exists. The codebase has unit tests but no end-to-end SMS simulation. The simulator must support the Phase 8 delivery pattern: REST API sends with timing delays (not TwiML responses), multi-message bursts, status callbacks, and multi-turn conversations spanning onboarding → interview → post-event.

**Requirements:**

* Create `scripts/simulate-twilio.ts` (TypeScript, not .mjs):
  * Simulates inbound SMS by sending POST requests to the inbound webhook endpoint with valid Twilio signature
  * Captures outbound SMS by intercepting Twilio REST API calls (via mock/stub of `@josh/messaging` client, or by pointing to a capture endpoint)
  * Supports multi-turn conversations: send inbound → wait for outbound(s) → send next inbound
  * Supports timing verification: records timestamps of outbound messages to verify 8-second delays in onboarding bursts
  * Configuration:
    * `--endpoint`: URL of the webhook endpoint (default: localhost or staging)
    * `--phone`: simulated user phone number
    * `--scenario`: predefined conversation scenario to run (see below)
    * `--interactive`: manual mode where operator types responses
  * Twilio signature generation: generate valid `X-Twilio-Signature` using the staging auth token
  * Status callback simulation: after each outbound capture, fire a status callback to the status endpoint with `MessageStatus: delivered`
* Predefined scenarios (each is a script of inbound messages with expected outbound responses):
  * `new-user-onboarding`: activation → opening reply → explanation reply → burst (verify 4 messages with timing) → interview start reply
  * `interview-rich`: full interview with rich answers that reach complete_mvp in 6-8 exchanges
  * `interview-sparse`: full interview with sparse answers requiring more exchanges (10-13)
  * `interview-dropout`: user stops mid-interview → verify nudge after 24h → user resumes
  * `post-event-full`: attendance → do-again → feedback → contact exchange (with multiple simulated users)
  * `safety-keyword`: trigger a safety keyword mid-interview → verify hold, interview paused
  * `block-report`: user sends BLOCK and REPORT commands → verify correct responses
* Each scenario records: messages sent, messages received, timestamps, state transitions, pass/fail assertions
* Output: structured JSON report with scenario name, steps, pass/fail, timing data, and any assertion failures
* Create `scripts/simulate-twilio-config.ts`: scenario definitions with message sequences and expected outputs

**Deliverables:**

* `scripts/simulate-twilio.ts`
* `scripts/simulate-twilio-config.ts` (scenario definitions)
* `scripts/simulate-twilio-utils.ts` (signature generation, HTTP client, timing helpers)
* `docs/testing/twilio-simulator-usage.md` (usage instructions)

**Verification:**

* `npx ts-node scripts/simulate-twilio.ts --scenario new-user-onboarding --endpoint http://localhost:3000` completes with all assertions passing
* Onboarding burst timing: messages 1-3 have ~8 second gaps, message 4 arrives immediately after 3
* Interview scenario: rich-answer user reaches complete_mvp in fewer exchanges than sparse-answer user
* Dropout scenario: nudge fires at correct time, resume picks up at correct step
* Safety scenario: keyword triggers hold, subsequent messages get hold notice
* All scenarios produce structured JSON output with timing data

---

### Ticket 14.2 — E2E Staging Validation Checklist

**Goal:** Define and implement a comprehensive E2E staging validation checklist that covers the full MVP user journey including all Phase 8+ features.

**Background:**

The existing E2E scenarios are incomplete — they don't cover the new onboarding burst, adaptive interview, LLM extraction, dropout recovery, post-event flow, or safety interruptions. This ticket creates a comprehensive checklist with specific pass criteria for each scenario.

**Requirements:**

* Create `docs/testing/e2e-staging-checklist.md` with the following scenarios, each with step-by-step instructions and specific pass criteria:

**Scenario 1 — Full New User Flow (Waitlist → Active):**
1. Create waitlist entry for test user in open region
2. Activate user from waitlist → verify `ONBOARDING_OPENING` SMS received
3. Reply "yes" → verify `ONBOARDING_EXPLANATION` received
4. Reply "yes" → verify 4-message burst (Messages 1-4) received with ~8-second gaps between Messages 1/2/3, Message 4 immediately after 3
5. Reply "yes" → verify session transitions to `mode: interviewing`, `state_token: interview:activity_01`
6. Complete interview with rich answers (6-8 exchanges) → verify `INTERVIEW_WRAP` received, `profile_state: complete_mvp`
7. Verify profile in DB: fingerprint factors populated, activity patterns populated, group size captured
8. Verify all outbound messages recorded in `sms_messages` with correct `twilio_message_sid`

**Scenario 2 — Interview Dropout + Resume:**
1. Start interview (steps 1-5 from Scenario 1)
2. Answer 2-3 interview questions, then go silent
3. Wait 24 hours (or simulate by adjusting `conversation_sessions.updated_at`) → verify `INTERVIEW_DROPOUT_NUDGE` received exactly once
4. Reply anything → verify `INTERVIEW_DROPOUT_RESUME` received followed by next uncovered signal question
5. Complete interview → verify `complete_mvp` reached
6. Verify resumed question targets an uncovered signal (not a re-ask)

**Scenario 3 — Rich vs. Sparse Interview Comparison:**
1. Run two users through interview: one with rich answers ("I love skydiving, rafting, and rock climbing every summer"), one with sparse answers ("idk, sure, maybe")
2. Verify rich user reaches `complete_mvp` in 6-8 exchanges
3. Verify sparse user reaches `complete_mvp` in 10-13 exchanges
4. Verify both profiles have equivalent signal coverage at completion

**Scenario 4 — LLM Extraction Failure + Fallback:**
1. Start interview, answer a question
2. Simulate LLM failure (timeout or invalid response — may require test hook)
3. Verify fallback regex parser handles the response
4. Verify interview continues without error
5. Verify Sentry event captures the LLM failure
6. Verify log entry: `llm.extraction.fallback_regex`

**Scenario 5 — Post-Event Full Flow:**
1. Create a locked LinkUp with 3 participants, event_time 3 hours ago
2. Run post-event runner → verify all 3 receive attendance prompt
3. Participant 1: reply `1` (attended) → `Y` (do again) → `Great time` (feedback) → `ok` (contact intro) → `1,2` (exchange all)
4. Participant 2: reply `1` → `Y` → `SKIP` → `ok` → `1` (exchange P1 only)
5. Participant 3: reply `2` (no show) → `N` → `SKIP` → `ok` → `NONE`
6. Verify: P1↔P2 mutual yes → both receive reveal messages with each other's phone number
7. Verify: P1→P3, P2→P3 no mutual → no reveal
8. Verify: `linkup_outcomes` has 3 rows with correct data
9. Verify: `learning_signals` has correct entries (attendance, do-again for each user)
10. Verify: `contact_exchanges` has exactly 1 row (P1↔P2)

**Scenario 6 — Safety Keyword Mid-Interview:**
1. Start interview (get to a few questions in)
2. Send a message containing a safety keyword (use a test keyword from the keyword list)
3. Verify: `safety_incidents` row created
4. Verify: hold applied (if severity warrants it)
5. Verify: next message receives hold notice (if hold applied) or interview continues (if low severity)
6. If hold applied: verify interview is paused, state token preserved
7. Lift hold (via admin) → verify: next message resumes interview at correct step

**Scenario 7 — Block/Report Flow:**
1. Create completed LinkUp between User A and User B
2. User A sends `BLOCK User B's name`
3. Verify: `user_blocks` row created, confirmation message sent
4. Verify: User B excluded from future match candidate lists for User A
5. User A sends `REPORT` → follow guided flow → verify: `user_reports` row created, `safety_incidents` row created, hold applied to User B

**Scenario 8 — Idempotency Verification:**
1. Send same inbound SMS twice (same MessageSid) → verify only 1 `sms_messages` row
2. Run post-event runner twice for same LinkUp → verify no duplicate outbound messages
3. Trigger mutual detection twice for same pair → verify only 1 `contact_exchanges` row, only 1 reveal message per recipient

* Each scenario must have:
  * Explicit setup instructions
  * Step-by-step actions
  * Specific pass criteria (DB row counts, message content, timing)
  * Known failure modes to watch for

**Deliverables:**

* `docs/testing/e2e-staging-checklist.md` (comprehensive checklist with all 8 scenarios)
* `scripts/e2e-staging-setup.ts` — sets up test data for scenarios (users, regions, LinkUps) via `@josh/db`
* `scripts/e2e-staging-verify.ts` — verifies DB state after scenario execution (checks row counts, field values)

**Verification:**

* All 8 scenarios can be executed in staging with clear pass/fail results
* Scenario 1 end-to-end takes less than 5 minutes (including burst timing)
* Scenario 3 demonstrates measurable difference in exchange counts between rich and sparse users
* Scenario 8 proves all idempotency guarantees hold
* Checklist document is detailed enough for any team member to execute without additional context

---

## Phase 15 — Production Provisioning + Deployment

This phase provisions production infrastructure and validates the complete system before launch. Updated from the original Phase 13 to include Phase 8+ verification requirements and correct the LLM provider references.

---

### Ticket 15.1 — Production Supabase Provisioning

**Goal:** Create a new production Supabase project with all migrations applied.

**Background:** Same as original Ticket 13.1. No changes needed from the redesign.

**Deliverables:**

* Production Supabase project created
* All migrations applied cleanly
* `docs/runbooks/prod-supabase-setup.md` (updated with any new migration steps)

**Verification:**

* All migrations apply without error
* Schema matches staging exactly
* RLS policies active on all member-facing tables

---

### Ticket 15.2 — Production Vercel Setup

**Goal:** Production Vercel deployment with all environment variables including Anthropic API credentials.

**Background:** The original ticket did not mention the Anthropic API key, which is now required in production since Phase 8 makes LLM extraction primary. All env vars must be provisioned.

**Requirements:**

* Deploy to production Vercel project
* Configure all environment variables:
  * `APP_ENV=production`
  * `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  * `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`
  * `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  * `ANTHROPIC_API_KEY` — required for LLM extraction (interview) and intent classification
  * `SENTRY_DSN` — error tracking
  * `CRON_SECRET` — protects cron endpoints
* Verify build succeeds in production environment

**Deliverables:**

* Production Vercel deployment live
* `docs/runbooks/prod-vercel-setup.md` (updated with Anthropic API key and Sentry DSN)

**Verification:**

* `pnpm build` succeeds in production
* All env vars set (verify via `scripts/doctor.mjs`)
* Production URL loads correctly
* Anthropic API key verified: a test LLM call returns a valid response (use a simple health check, not a real user interaction)

---

### Ticket 15.3 — Production Twilio Wiring

**Goal:** Wire production Twilio number with inbound and status callbacks, verified for the new delivery pattern.

**Background:** The Phase 8 delivery pattern uses Twilio REST API sends (not just TwiML responses). Production Twilio must support this pattern, and A2P compliance must cover the new message patterns (multi-message bursts during onboarding).

**Requirements:**

* Configure production Twilio number:
  * Inbound webhook: `https://{production-url}/api/twilio/inbound`
  * Status callback: `https://{production-url}/api/twilio/status`
* Verify Messaging Service supports REST API sends (not just TwiML)
* Verify A2P campaign sample messages include:
  * Multi-message onboarding burst (4 messages in quick succession)
  * Interview questions
  * Post-event prompts
  * Contact exchange reveal (contains phone numbers)
  * Safety responses

**Deliverables:**

* Production Twilio number configured
* `docs/runbooks/prod-twilio-setup.md` (updated with new message patterns)

**Verification:**

* Inbound webhook receives test message in production
* Outbound REST API send delivers in production
* Status callback fires for outbound sends
* A2P campaign approved with updated sample messages

---

### Ticket 15.4 — Production Stripe Wiring

**Goal:** Wire production Stripe webhooks, products, and prices.

**Background:** Same as original Ticket 13.4. No changes needed from the redesign.

**Deliverables:**

* Production Stripe webhooks configured
* Products and prices created
* `docs/runbooks/prod-stripe-setup.md`

**Verification:**

* Webhook endpoint receives test events
* Test checkout creates correct entitlements

---

### Ticket 15.5 — Launch Checklist + Cutover

**Goal:** Comprehensive launch checklist covering all systems including Phase 8+ features.

**Background:** The original checklist was incomplete — it did not include verification of the new conversation system, LLM connectivity, onboarding burst timing, interview completion, or post-event runner. This ticket adds all Phase 8+ verification items.

**Requirements:**

* Create `docs/runbooks/launch-checklist.md` with the following sections:

**Pre-Launch Infrastructure Checks:**
* [ ] All migrations applied to production DB
* [ ] All webhook endpoints responding (Twilio inbound, Twilio status, Stripe)
* [ ] All cron jobs scheduled and authenticated (outbound runner, reconcile, post-event runner, alert check)
* [ ] All env vars set and validated (`pnpm doctor` green)
* [ ] Sentry receiving test error events
* [ ] Metrics emitting to log stream

**Pre-Launch Smoke Tests:**
* [ ] Verify Anthropic API connectivity: send a test extraction request, receive valid JSON response
* [ ] Verify onboarding burst timing in production: activate a test user, confirm 4-message burst with ~8-second delays
* [ ] Verify full new user flow: waitlist activation → onboarding → interview (3-4 questions) → verify profile writes
* [ ] Verify interview completion produces correct `complete_mvp` state and `INTERVIEW_WRAP` message
* [ ] Verify LLM extraction: send a rich interview answer, confirm signal extraction writes to profile
* [ ] Verify LLM fallback: simulate extraction timeout, confirm regex fallback runs correctly
* [ ] Verify dropout nudge: set `conversation_sessions.updated_at` to 25 hours ago, run dropout check, confirm nudge sent
* [ ] Verify post-event runner: create test locked LinkUp with past event_time, run runner, confirm attendance prompt sent
* [ ] Verify safety keyword detection: send test keyword, confirm incident created
* [ ] Verify STOP/HELP: send STOP, confirm opt-out recorded; send START, confirm opt-in restored
* [ ] Verify Stripe webhook: process test checkout event, confirm entitlements created
* [ ] Verify admin dashboard: login, view user, view LinkUp, triage incident

**Launch Sequence:**
* [ ] Open first region (set status: `open`)
* [ ] Activate first batch of waitlist users (small batch: 10 users)
* [ ] Monitor: onboarding bursts sent, no errors in Sentry, metrics flowing
* [ ] Wait 30 minutes, verify: users progressing through interview
* [ ] If clean: activate next batch (25 users)
* [ ] If clean after 2 hours: activate remaining waitlist

**Post-Launch Monitoring:**
* [ ] Monitor `sms_outbound_failed_total` — should be 0% initially
* [ ] Monitor `llm_extraction_total{result=invalid_json}` — should be < 1%
* [ ] Monitor `outbound_job_backlog` — should stay near 0
* [ ] Monitor Sentry for new error types
* [ ] Check interview completion rate after 24 hours — users should be reaching `complete_mvp`

**Deliverables:**

* `docs/runbooks/launch-checklist.md` (comprehensive, with all items above)

**Verification:**

* Every checklist item can be executed by following the instructions (no implicit knowledge required)
* Smoke test section covers all critical paths introduced by Phase 8+
* Launch sequence includes gradual rollout (not all users at once)
* Post-launch monitoring section references specific metrics and thresholds

---

## Cross-Phase Gap Resolution Summary

| Gap | Resolution |
|-----|-----------|
| **Gap 1 — Post-Event Session Mode** | Ticket 10.1 registers `post_event` mode with all state tokens |
| **Gap 2 — Match Run Orchestration** | Confirmed: scoring functions and `scripts/run-matching-job.mjs` exist but no automated runner. The existing script provides orchestration capability. A Vercel Cron endpoint to trigger match runs should be added as part of Phase 7 completion (out of scope for this rewrite — Phases 0-7 are not being rewritten). Note this gap for the implementer. |
| **Gap 3 — LLM Provider** | Resolved: all references updated to Anthropic. Build plan introduction updated. |
| **Gap 4 — Post-Event → Learning Signal Pipeline** | Ticket 10.3 creates `learning-signal-writer.ts` that writes signals from post-event outcomes |
| **Gap 5 — packages/db/ and packages/messaging/** | Resolved: Phase 9 creates both packages (Tickets 9.1, 9.2, 9.3) |
| **Gap 6 — Conversation Mode Transitions** | Ticket 10.1 (post_event mode), Ticket 11.2 (report_flow mode) register all new modes |
| **Gap 7 — Member Dashboard** | Ticket 12.3 adds interview progress and profile completeness to member dashboard |
