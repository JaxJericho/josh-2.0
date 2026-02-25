# JOSH 3.0 — Implementation Build Plan

This document is the implementation plan for the JOSH 3.0 pivot. It follows directly after Phase 15 (Production Provisioning \+ Deployment) in the JOSH 2.0 Comprehensive Build Plan. Phases 0–15 are either complete or in progress.

This plan was compiled from the full codebase audit (Steps 1–4) and cross-referenced against an independent Codex audit of the same codebase.

---

## **Scope, Assumptions, And Decisions**

### **What We Are Building (3.0 MVP)**

* Solo coordination path (Path 1\) — JOSH suggests activities, follows up via `post_activity_checkin`, learns from outcomes. No group matching required for this path.  
* Plan Circle path (Path 2\) — JOSH coordinates plans with a user's named contacts via `handleNamedPlanRequest` and `handlePlanSocialChoice`.  
* LinkUp path (Path 3\) — Existing 2.0 LinkUp flow preserved, updated to use 3.0 eligibility gates and the 6-dimension compatibility model.  
* Invited user registration flow — A user invites a contact via SMS; that contact is onboarded through an abbreviated interview producing a `complete_invited` profile.  
* 6-dimension coordination profile — Replaces the 2.0 12-factor Friend Fingerprint across signal coverage tracking, LLM extraction, profile writes, and matching.  
* Activity catalog — 55 activities seeded into the database.  
* BETA framing — The product launches as BETA with honest expectation-setting in all onboarding and system messaging.

### **Key Decisions**

* The 12-factor fingerprint replacement is a coordinated replace task across `packages/core`, `packages/llm`, and `packages/db`. It ships as a single phase (Phase 18\) before any 3.0 matching or suggestion work begins.  
* `evaluateEntitlements()` is fully replaced by `evaluateEligibility()` with per-action `action_type` gating in Phase 17\. The 2.0 waitlist-based gating is removed.  
* The `complete_invited` hard filter must be enforced at query level in five locations. Phase 16 introduces the enum value. Phase 21 enforces it everywhere. It must never be relaxed regardless of pool size or region density.  
* Destructive enum migrations (removing `match_preview_*` and `one_to_one`) run in Phase 21 after all write paths are confirmed clean. They do not run earlier.  
* The `profiles.fingerprint` rename is a two-step operation: the shadow column (`coordination_dimensions`) is added in Phase 16, all code switches to it in Phase 18, and the old column is dropped in Phase 22\.  
* A2P campaign approval for cold SMS to non-member invitees must be confirmed before Phase 20 ships to production. Phase 20 may be implemented and tested in staging without it.  
* Phases 17, 18, and 19 have no dependency on each other and may run in parallel after Phase 16 completes.

### **Non-Negotiable Reliability Rules (inherited from 2.0 plan)**

* Idempotency for all webhooks and scheduled runners  
* DB uniqueness constraints for external IDs  
* State transitions in transactions  
* Correlation IDs and structured logs everywhere  
* Secrets isolated per environment

---

## **Phase 16 — Schema Foundation**

All additive migrations. No application logic changes. No existing tables, columns, or enum values are modified or removed. All eight tickets in this phase may be run as a single migration set or in order.

Dependencies: Phase 15 complete.

---

### **Ticket 16.1 — Additive Enum Migrations (S)**

Goal: Add all new enum values required for 3.0 to existing Postgres enums.

Requirements:

* Add `complete_invited` to the `profile_state` enum  
* Add `interviewing_abbreviated`, `awaiting_social_choice`, `post_activity_checkin`, `pending_plan_confirmation` to the `conversation_mode` enum  
* Add `solo_activity_attended`, `solo_activity_skipped`, `solo_do_again_yes`, `solo_do_again_no`, `solo_bridge_accepted` to the `learning_signal_type` enum  
* Update corresponding TypeScript union types in `packages/core` and `packages/db`  
* Update any Zod schemas or validators that enumerate these types

Deliverables:

* `supabase/migrations/YYYYMMDD_add_3_0_enum_values.sql`  
* Updated TypeScript types in `packages/db` and `packages/core`

Verification:

* Migration applies cleanly on staging with no errors  
* `pnpm typecheck` passes after type updates  
* A conversation session can be created with `mode = interviewing_abbreviated` without a DB constraint error

---

### **Ticket 16.2 — New Tables: contact\_invitations, contact\_circle, plan\_briefs (M)**

Goal: Create the three new tables required for the invited user and Plan Circle flows.

Requirements:

* `contact_invitations` table:  
  * `id` uuid primary key  
  * `inviter_user_id` uuid references users(id)  
  * `invitee_phone_hash` text not null  
  * `plan_brief_id` uuid references plan\_briefs(id) nullable  
  * `status` text not null default 'pending' (values: pending, accepted, declined, expired)  
  * `created_at`, `updated_at` timestamptz  
  * Index on `invitee_phone_hash`  
* `plan_briefs` table:  
  * `id` uuid primary key  
  * `creator_user_id` uuid references users(id)  
  * `activity_key` text  
  * `proposed_time_window` text  
  * `notes` text  
  * `status` text not null default 'draft'  
  * `created_at`, `updated_at` timestamptz  
* `contact_circle` table:  
  * `id` uuid primary key  
  * `user_id` uuid references users(id)  
  * `contact_name` text not null  
  * `contact_phone_hash` text not null  
  * `contact_phone_e164` text not null  
  * `created_at`, `updated_at` timestamptz  
  * Unique constraint on `(user_id, contact_phone_hash)`  
  * Index on `user_id`

Note: `contact_invitations` references `plan_briefs`, so `plan_briefs` must be created first in the migration.

Deliverables:

* `supabase/migrations/YYYYMMDD_add_3_0_tables.sql`

Verification:

* Migration applies cleanly on staging  
* All foreign key constraints resolve  
* `EXPLAIN ANALYZE` on a `contact_invitations` lookup by `invitee_phone_hash` uses the index

---

### **Ticket 16.3 — Profile Schema And activity\_catalog Updates (S)**

Goal: Add coordination signal columns, Layer B placeholder columns, `registration_source` to users, and the `activity_catalog` table.

Requirements:

* Add to `profiles` table:  
  * `scheduling_availability` jsonb nullable  
  * `notice_preference` text nullable  
  * `coordination_style` text nullable  
  * `personality_substrate` jsonb nullable (Layer B — never read at MVP)  
  * `relational_style` jsonb nullable (Layer B — never read at MVP)  
  * `values_orientation` jsonb nullable (Layer B — never read at MVP)  
* Add to `users` table:  
  * `registration_source` text nullable  
* Create `activity_catalog` table:  
  * `id` uuid primary key  
  * `activity_key` text unique not null  
  * `display_name` text not null  
  * `category` text not null  
  * `short_description` text not null  
  * `regional_availability` text not null  
  * `motive_weights` jsonb not null  
  * `constraints` jsonb not null  
  * `preferred_windows` text\[\] not null  
  * `group_size_fit` text\[\] not null  
  * `tags` text\[\]  
  * `created_at` timestamptz

Deliverables:

* `supabase/migrations/YYYYMMDD_add_3_0_profile_and_catalog.sql`  
* `scripts/seed-activity-catalog.ts` — inserts all 55 entries from `docs/seed/activity_catalog_seed.ts` after migration runs

Verification:

* Migration applies cleanly  
* Seed script inserts 55 activities with no constraint errors  
* `SELECT COUNT(*) FROM activity_catalog` returns 55  
* Layer B columns exist and are null for all rows

---

### **Ticket 16.4 — Add coordination\_dimensions Shadow Column (M)**

Goal: Begin the two-step fingerprint column rename by adding `coordination_dimensions` as a shadow column alongside `fingerprint`, and copying existing data into it.

Background:

The `profiles.fingerprint` column stores 3.0 coordination dimensions under the wrong name. Renaming it directly would require a single-step migration that breaks all running application code simultaneously. The two-step approach adds the new column alongside the old one, switches application code in Phase 18, then drops the old column in Phase 22\.

Requirements:

* Add `coordination_dimensions jsonb` to `profiles`  
* In the same migration: `UPDATE profiles SET coordination_dimensions = fingerprint` to populate existing rows  
* Add a constant `PROFILE_DIMENSIONS_COLUMN = 'coordination_dimensions'` to `packages/core/src/profile/profile-writer.ts` to make the column name configurable until the old column is dropped. All existing reads/writes continue to use `fingerprint` for now — Phase 18 switches them to the constant.  
* Do not update any application read/write paths in this ticket

Deliverables:

* `supabase/migrations/YYYYMMDD_add_coordination_dimensions_column.sql`  
* `PROFILE_DIMENSIONS_COLUMN` constant added to `profile-writer.ts` (value is still `'fingerprint'` until Phase 18 switches it to `'coordination_dimensions'`)

Verification:

* Both `fingerprint` and `coordination_dimensions` columns exist on `profiles`  
* `coordination_dimensions` contains identical data to `fingerprint` for all rows  
* No application read/write behavior changes after this migration

---

### **Ticket 16.5 — Update Dropout Recovery To Handle Abbreviated Mode (S)**

Goal: Update the dropout recovery function to fire nudges for users in `interviewing_abbreviated` mode, not only `interviewing`.

Background:

`enqueue_interview_dropout_nudges` currently only checks `mode = 'interviewing'`. This must be updated before the abbreviated interview exists in production, otherwise invited users who abandon their profile mid-interview will never receive a recovery nudge.

Requirements:

* Update the mode filter in `enqueue_interview_dropout_nudges` to check both `mode = 'interviewing'` and `mode = 'interviewing_abbreviated'`  
* The nudge message, timing (24 hours), and idempotency behavior are unchanged — this is a mode filter expansion only  
* Verify that the existing `dropout_nudge_sent_at` column on `conversation_sessions` is used correctly for both modes

Deliverables:

* Updated `enqueue_interview_dropout_nudges`  
* Unit test: abbreviated interview session inactive for 24 hours triggers nudge  
* Unit test: regular interview session inactive for 24 hours still triggers nudge

Verification:

* A `conversation_sessions` row with `mode = interviewing_abbreviated` and `updated_at` more than 24 hours ago is picked up by the dropout runner  
* `dropout_nudge_sent_at` is set correctly after the nudge fires

---

## **Phase 17 — Type System And Eligibility Layer**

Replaces the 2.0 type infrastructure and the `evaluateEntitlements()` function. No conversation flow changes occur in this phase.

Dependencies: Phase 16 complete.

---

### **Ticket 17.1 — 3.0 Type Definitions (packages/db) (M)**

Goal: Define all new TypeScript types for 3.0 domain entities and replace the per-step extraction types with holistic extraction types.

Requirements:

* Add to `packages/db/src/types/`:  
  * `ContactInvitation` — matches `contact_invitations` table shape  
  * `PlanBrief` — matches `plan_briefs` table shape  
  * `ContactCircleEntry` — matches `contact_circle` table shape  
  * `ActivityCatalogEntry` — consistent with `docs/seed/activity_catalog_seed.ts`  
  * `CoordinationDimensions` — typed interface for all 6 dimensions (`social_energy`, `social_pace`, `conversation_depth`, `adventure_orientation`, `group_dynamic`, `values_proximity`), each as `{ value: number; confidence: number }`  
  * `CoordinationSignals` — typed interface for `scheduling_availability`, `notice_preference`, `coordination_style`  
  * `DimensionCoverageSummary` — per-dimension `{ covered: boolean; confidence: number }` for all 6 dimensions and 3 signals  
* Create `packages/db/src/types/holistic-extraction.ts`:  
  * `HolisticExtractInput` — takes `conversationHistory: ConversationTurn[]`, `currentProfile: Partial<CoordinationDimensions>`, `sessionId: string`  
  * `HolisticExtractOutput` — returns `coordinationDimensionUpdates`, `coordinationSignalUpdates`, `coverageSummary: DimensionCoverageSummary`, `needsFollowUp: boolean`  
* Mark `InterviewExtractInput` / `InterviewExtractOutput` as `@deprecated` with a comment pointing to the replacement types — do not delete until Phase 18 removes all callers

Deliverables:

* Updated `packages/db/src/types/` with all new types  
* `packages/db/src/types/holistic-extraction.ts`

Verification:

* `pnpm typecheck` passes across all packages  
* `CoordinationDimensions` type correctly constrains all 6 dimension keys  
* `HolisticExtractInput` does not accept a `stepId` field  
* A unit test imports and instantiates all new types without error

---

### **Ticket 17.2 — Replace evaluateEntitlements() With evaluateEligibility() (M)**

Goal: Replace the 2.0 waitlist-based entitlement function with the 3.0 per-action eligibility system.

Requirements:

* Create `packages/core/src/entitlements/evaluate-eligibility.ts`  
* Implement `evaluateEligibility({ userId, action_type }): Promise<EligibilityResult>`:  
  * `can_initiate_linkup` — requires region \= open AND active subscription  
  * `can_initiate_named_plan` — requires active subscription only  
  * `can_receive_contact_invitation` — requires membership only (any active user)  
* `EligibilityResult`: `{ eligible: boolean; reason?: string }`  
* Identify all call sites of `evaluateEntitlements()` before writing any code — each call site must be migrated with an explicit `action_type`  
* Add a runtime guard that throws on any `action_type` not in the three allowed values  
* Mark `evaluateEntitlements()` as `@deprecated` after migration — do not delete until all call sites are confirmed migrated

Deliverables:

* `packages/core/src/entitlements/evaluate-eligibility.ts`  
* Updated call sites across `packages/core`, `packages/messaging`, `supabase/functions`  
* Unit tests: each action\_type gate enforces its correct condition  
* Unit test: unknown `action_type` throws

Verification:

* A user with no active subscription cannot initiate a LinkUp or named plan  
* A user with an active subscription in a closed region cannot initiate a LinkUp  
* Any active user can receive a contact invitation regardless of subscription  
* Passing an unknown `action_type` throws a runtime error  
* `pnpm typecheck` passes

---

## **Phase 18 — 6-Dimension Profile System**

Replaces the 12-factor Friend Fingerprint with the 6-dimension coordination profile across all application code. This phase is a coordinated replace across five files and must ship as a unit. Partial replacement is not acceptable — all five files must be updated together.

Dependencies: Phase 17 complete (types and `HolisticExtractInput/Output` must exist before implementation begins).

---

### **Ticket 18.1 — Signal Coverage Tracker: 6-Dimension Model (M)**

Goal: Replace the 12-factor signal coverage tracker with a 6-dimension system using 3.0 completeness thresholds.

Requirements:

* Replace `FINGERPRINT_FACTOR_KEYS` (12 values) with:  
  * `COORDINATION_DIMENSION_KEYS`: `social_energy`, `social_pace`, `conversation_depth`, `adventure_orientation`, `group_dynamic`, `values_proximity`  
  * `COORDINATION_SIGNAL_KEYS`: `scheduling_availability`, `notice_preference`, `coordination_style`  
* Replace `getSignalCoverageStatus(profile)` return shape:  
  * `coveredDimensions: string[]`  
  * `uncoveredDimensions: string[]`  
  * `coveredSignals: string[]`  
  * `uncoveredSignals: string[]`  
  * `mvpComplete: boolean` — true when all 6 dimensions \>= 0.55 AND all 3 signals

     \= 0.60

  * `nextTarget: string | null`  
* Update `selectNextQuestion()` to target uncovered dimensions and signals  
* Update `buildInterviewTransitionPlan()` in `state.ts` to use the updated return shape  
* Remove all references to `fingerprintCoveredCount` and `FINGERPRINT_FACTOR_KEYS`

Deliverables:

* Updated `packages/core/src/interview/signal-coverage.ts`  
* Updated `packages/core/src/interview/state.ts`  
* Unit tests: `mvpComplete = true` when all 6 dimensions \+ 3 signals meet thresholds  
* Unit tests: `mvpComplete = false` when any is below threshold  
* Unit tests: `selectNextQuestion()` does not target already-covered dimensions

Verification:

* A profile with all 6 dimensions at 0.60 and all 3 signals at 0.65 returns `mvpComplete = true`  
* A profile missing `conversation_depth` confidence returns `mvpComplete = false`  
* No reference to `fingerprintCoveredCount` or any 2.0 factor name remains

---

### **Ticket 18.2 — Profile Writer: 6-Dimension Writes (M)**

Goal: Replace all 12-factor fingerprint writes in `profile-writer.ts` with 6-dimension coordinate writes.

Requirements:

* Update `profile-writer.ts` lines 577–685 to write `CoordinationDimensions` and `CoordinationSignals` shapes  
* Switch all writes from the `fingerprint` column to `coordination_dimensions` by updating `PROFILE_DIMENSIONS_COLUMN` constant value from `'fingerprint'` to `'coordination_dimensions'` (constant introduced in Ticket 16.4)  
* No write may include any 2.0 factor key  
* All dimension writes must include a `confidence` field  
* Merging a new update into an existing profile must use `Math.max(existing.confidence, incoming.confidence)` — confidence never decreases

Deliverables:

* Updated `packages/core/src/profile/profile-writer.ts`  
* Unit tests: write produces correct JSONB shape for all 6 dimensions  
* Unit test: merge does not reduce existing confidence

Verification:

* After a profile write, stored JSONB contains only 3.0 dimension keys  
* No 2.0 factor names appear in any write path  
* `pnpm typecheck` passes

---

### **Ticket 18.3 — Compatibility Normalizer: 6-Dimension Reads (M)**

Goal: Replace all 12-factor reads in `normalizer.ts` and remove `compatibility-signal-writer.ts` from the active pipeline.

Requirements:

* Update `normalizer.ts` to read the 6 dimension names from `coordination_dimensions`  
* Remove reads of all 2.0 factor names (`social_pace`, `interaction_style`, `conversation_style`, etc.)  
* Update any scoring or weighting functions that reference 2.0 factor names  
* Normalizer must gracefully handle profiles with no dimension data (return null defaults rather than throwing)  
* Flag `compatibility-signal-writer.ts` for removal: confirm whether any 3.0 path reads its output. If no active consumer exists, delete it in this ticket. If a consumer exists, mark it `@deprecated` and remove in Ticket 21.4.

Deliverables:

* Updated `packages/core/normalizer.ts`  
* `compatibility-signal-writer.ts` removed or flagged  
* Unit tests: normalizer returns correct dimension values for a 3.0-shaped profile  
* Unit tests: normalizer returns defaults for a profile with no dimension data

Verification:

* No 2.0 factor name appears in `normalizer.ts` after this ticket  
* `pnpm typecheck` passes

---

### **Ticket 18.4 — LLM Extraction: Holistic Model \+ 6-Dimension Prompt (L)**

Goal: Replace the per-step LLM extraction system prompt and extractor with the holistic 6-dimension model.

Requirements:

* Replace `interview-extraction-system-prompt.ts` with a prompt that:  
  * Reads full conversation history, not a single step  
  * Returns only valid JSON matching `HolisticExtractOutput`  
  * Uses `coordinationDimensionUpdates` keyed to the 6 dimension names  
  * Includes `coverageSummary` with a `confidence` value per dimension and signal  
  * Never returns 2.0 factor names in any field  
  * Flags `needsFollowUp: true` only when a required dimension cannot be inferred from conversation history  
* Replace `extractInterviewSignals(input: InterviewExtractInput)` with `extractCoordinationSignals(input: HolisticExtractInput): Promise<HolisticExtractOutput>`  
* Update `state.ts` to call `extractCoordinationSignals()` with full conversation history at natural pause points  
* JSON schema validation must run on every LLM response — invalid responses are discarded and the existing profile is unchanged  
* Timeout (5 seconds) and single retry on transient failure — existing fallback behavior preserved  
* Delete the deprecated `InterviewExtractInput/Output` types from `packages/db`

Deliverables:

* Replaced `packages/llm/src/prompts/interview-extraction-system-prompt.ts`  
* New `packages/llm/src/holistic-extractor.ts`  
* Updated `packages/core/src/interview/state.ts`  
* JSON schema validator for `HolisticExtractOutput`  
* `InterviewExtractInput/Output` types deleted  
* Unit tests: valid holistic extraction, invalid JSON fallback, timeout fallback  
* Golden tests: multi-turn conversations produce correct dimension updates

Verification:

* A 5-message conversation about outdoor activities produces `adventure_orientation >= 0.65` in `coordinationDimensionUpdates`  
* An LLM response containing any 2.0 factor key fails schema validation and is discarded  
* `coverageSummary` in every valid response contains entries for all 9 keys  
* LLM timeout → existing profile unchanged → interview continues  
* No reference to `fingerprintPatches` or any 2.0 factor name remains anywhere in the extraction system

---

## **Phase 19 — Intent Classification And Routing**

Implements the 3.0 intent classification system and wires all handlers into the router. Replaces mode-only routing with intent-first dispatch.

Dependencies: Phase 17 complete (evaluateEligibility must exist before handlers can call it). Phase 16 complete (contact\_invitations table must exist for the invitation lookup in the router).

---

### **Ticket 19.1 — Intent Type Definitions And Classifier (M)**

Goal: Define all 3.0 intent types and implement the classification function.

Requirements:

* Create `packages/messaging/src/intents/intent-types.ts` with the following TypeScript union:  
  * `OPEN_INTENT` — user wants to do something, unspecified  
  * `NAMED_PLAN_REQUEST` — user references a specific person or group  
  * `PLAN_SOCIAL_CHOICE` — user is responding to an activity suggestion in `awaiting_social_choice` mode  
  * `CONTACT_INVITE_RESPONSE` — unknown number with a pending invitation  
  * `POST_ACTIVITY_CHECKIN` — post-activity follow-up response  
  * `INTERVIEW_ANSWER` — response within an active interview session  
  * `INTERVIEW_ANSWER_ABBREVIATED` — response within an abbreviated interview  
  * `SYSTEM_COMMAND` — STOP, HELP, or other system keywords (existing)  
* Implement `classifyIntent(message: string, session: ConversationSession): IntentClassification` returning `{ intent: IntentType; confidence: number }`  
* A message from a number with no user record AND a pending `contact_invitations` row must classify as `CONTACT_INVITE_RESPONSE` — this check runs before all other classification  
* A user in `awaiting_social_choice` mode whose message matches no system keyword classifies as `PLAN_SOCIAL_CHOICE` without LLM involvement  
* A user in `interviewing` mode whose message matches no system keyword classifies as `INTERVIEW_ANSWER` without LLM involvement  
* LLM is used only for `OPEN_INTENT` vs `NAMED_PLAN_REQUEST` disambiguation when the message is ambiguous

Deliverables:

* `packages/messaging/src/intents/intent-types.ts`  
* `packages/messaging/src/intents/intent-classifier.ts`  
* Unit tests: all deterministic classification paths  
* Unit tests: session-mode-informed classification avoids LLM for interview answers and social choice responses

Verification:

* "I want to do something this weekend" → `OPEN_INTENT`  
* "I want to go hiking with Sarah" → `NAMED_PLAN_REQUEST`  
* Message from unknown number with pending invitation → `CONTACT_INVITE_RESPONSE` regardless of message content  
* Message from user in `awaiting_social_choice` → `PLAN_SOCIAL_CHOICE` without LLM call  
* Message from user in `interviewing` → `INTERVIEW_ANSWER` without LLM call

---

### **Ticket 19.2 — Router Update: Intent-First Dispatch (M)**

Goal: Update the conversation router to dispatch on intent type, with invitation lookup before user resolution.

Requirements:

* Update `packages/messaging/conversation-router.ts`:  
  * Run STOP/HELP precedence check first (unchanged)  
  * Look up `contact_invitations` by `phone_hash` before user resolution — if a pending invitation exists for the inbound number, short-circuit to `CONTACT_INVITE_RESPONSE` before attempting user lookup  
  * Run `classifyIntent()` on all messages passing STOP/HELP check  
  * Dispatch based on intent type:  
    * `CONTACT_INVITE_RESPONSE` → `handleContactInviteResponse`  
    * `POST_ACTIVITY_CHECKIN` → `handlePostActivityCheckin`  
    * `OPEN_INTENT` → `handleOpenIntent`  
    * `NAMED_PLAN_REQUEST` → `handleNamedPlanRequest`  
    * `PLAN_SOCIAL_CHOICE` → `handlePlanSocialChoice`  
    * `INTERVIEW_ANSWER` → existing interview engine  
    * `INTERVIEW_ANSWER_ABBREVIATED` → `handleInterviewAnswerAbbreviated`  
    * `SYSTEM_COMMAND` → existing STOP/HELP handlers  
  * Preserve backward-compatible mode-based routing for session modes not covered by the new intent types  
* Update `supabase/functions/twilio-inbound/index.ts` to reflect the new router dispatch order

Deliverables:

* Updated `packages/messaging/conversation-router.ts`  
* Updated `supabase/functions/twilio-inbound/index.ts`  
* Unit tests: invitation lookup short-circuit routes correctly  
* Unit tests: STOP/HELP still takes precedence over all intent routing

Verification:

* An inbound message from an unknown number with a pending invitation routes to `handleContactInviteResponse` before user resolution runs  
* An inbound message from a known user in `interviewing` mode routes to the interview engine without running `classifyIntent()`  
* STOP received from any state bypasses the intent classifier entirely

---

### **Ticket 19.3 — handleOpenIntent: Solo Suggestion Fallback (M)**

Goal: Implement the OPEN\_INTENT handler with solo activity suggestion as the default path, with LinkUp and Plan Circle paths gated on eligibility.

Requirements:

* Create `packages/messaging/src/handlers/handle-open-intent.ts`  
* Implement `handleOpenIntent(userId, message, session)`:  
  * Call `evaluateEligibility({ userId, action_type: 'can_initiate_linkup' })`  
  * If eligible for LinkUp → hand off to existing LinkUp initiation flow  
  * If not LinkUp-eligible but `contact_circle` has entries → call `evaluateEligibility({ userId, action_type: 'can_initiate_named_plan' })` and offer Plan Circle path if eligible  
  * Fallback (always available): call `suggestSoloActivity(userId)` and send suggestion  
  * `suggestSoloActivity(userId)` queries `activity_catalog` filtered by user's regional availability, motive weights, and schedule preferences — returns one activity with a suggestion message using `activity_catalog.short_description`  
  * JOSH does not generate its own activity copy  
* Set session mode to `awaiting_social_choice` after suggestion is sent

Deliverables:

* `packages/messaging/src/handlers/handle-open-intent.ts`  
* `packages/core/src/suggestions/suggest-solo-activity.ts`  
* Unit tests: eligibility gate routing (LinkUp eligible / named plan only / solo only)  
* Unit tests: `suggestSoloActivity()` returns an activity matching user's `regional_availability`  
* Unit tests: session transitions to `awaiting_social_choice` after suggestion

Verification:

* A user with no subscription receives a solo activity suggestion  
* A user with an active subscription in an open region receives a LinkUp offer  
* Suggested activity `regional_availability` is consistent with user's location  
* Session mode is `awaiting_social_choice` after handler completes

---

### **Ticket 19.4 — handlePlanSocialChoice (M)**

Goal: Implement the handler that processes a user's response to an activity suggestion while in `awaiting_social_choice` mode.

Background:

After JOSH sends an activity suggestion via `handleOpenIntent`, the session enters `awaiting_social_choice`. The user's next reply is classified as `PLAN_SOCIAL_CHOICE` and routes here. The user may accept the suggestion, decline it, modify it, or ask for a different suggestion entirely.

Requirements:

* Create `packages/messaging/src/handlers/handle-plan-social-choice.ts`  
* Implement `handlePlanSocialChoice(userId, message, session)`:  
  * Parse the user's response: accept / decline / modify / request alternative  
  * Accept → create a `plan_briefs` row with `status = confirmed`, transition session to `pending_plan_confirmation`, send confirmation message  
  * Decline → set session to `idle`, send a natural acknowledgment ("No worries — reach out whenever you feel like doing something.")  
  * Modify → update the pending suggestion based on the user's feedback, resend an updated suggestion, remain in `awaiting_social_choice`  
  * Request alternative → call `suggestSoloActivity(userId)` again with the previous suggestion excluded, resend, remain in `awaiting_social_choice`  
  * After 3 alternative requests with no acceptance, set session to `idle` with a graceful message ("We can revisit this whenever you're in the mood.")  
* All transitions write domain events to the audit log

Deliverables:

* `packages/messaging/src/handlers/handle-plan-social-choice.ts`  
* Unit tests: all four response branches (accept, decline, modify, request alternative)  
* Unit tests: three-strike decline limit returns session to idle gracefully  
* Unit tests: acceptance creates `plan_briefs` row and transitions session correctly

Verification:

* User replies "yes" to a suggestion → `plan_briefs` row created with `status = confirmed`, session mode \= `pending_plan_confirmation`  
* User replies "no" → session mode \= `idle`, no `plan_briefs` row created  
* User replies "actually hiking" → suggestion updates, session stays `awaiting_social_choice`  
* Three consecutive alternative requests → session returns to `idle` gracefully

---

## **Phase 20 — Invited User Flow**

Implements the complete invited user registration path. May be implemented and tested in staging without A2P approval. Production deployment of the outbound invitation dispatch path is gated on A2P campaign confirmation.

Dependencies: Phase 16 (contact\_invitations table), Phase 17 (evaluateEligibility), Phase 19 (router and intent classification).

---

### **Ticket 20.1 — Contact Invitation Creation Flow (M)**

Goal: Implement the flow by which a user creates a contact invitation, stores the invitee in `contact_circle`, and creates a `contact_invitations` row.

Requirements:

* Create `packages/core/src/invitations/create-invitation.ts`  
* Implement `createContactInvitation({ inviterUserId, inviteePhoneE164, inviteePlanBriefId? })`:  
  * Hash invitee phone to `invitee_phone_hash` using the same hashing function used everywhere  
  * Check for an existing pending invitation from this inviter to this invitee — if one exists, return it (idempotent)  
  * Create a `contact_invitations` row with `status = 'pending'`  
  * Upsert a `contact_circle` row for the inviter  
  * Return the invitation ID and a formatted invitation SMS message  
* The outbound SMS to the invitee is queued via `sms_outbound_jobs` but the send path is NOT triggered until A2P compliance is confirmed. Create the job row; do not wire the actual Twilio send until the A2P gate is lifted.  
* Track invitation creation in the audit log

Deliverables:

* `packages/core/src/invitations/create-invitation.ts`  
* Unit tests: idempotent invitation creation (second call returns existing row)  
* Unit tests: `contact_circle` row is upserted, not duplicated  
* Unit tests: phone hash consistency

Verification:

* Two calls to `createContactInvitation()` with the same inviter/invitee pair produce one `contact_invitations` row  
* `sms_outbound_jobs` row is created but no Twilio send is triggered

---

### **Ticket 20.2 — handleContactInviteResponse: Invited User Registration (M)**

Goal: Implement the full invited user registration flow triggered when a pending invitee sends their first inbound SMS.

Background:

When an unknown phone number sends an inbound message and a pending `contact_invitations` row exists for their `phone_hash`, the router dispatches here. This handler creates the user, session, and profile, marks the invitation accepted, and begins the abbreviated interview.

Requirements:

* Create `packages/messaging/src/handlers/handle-contact-invite-response.ts`  
* Implement `handleContactInviteResponse(phoneE164, phoneHash, inboundMessage)`:  
  1. Look up pending `contact_invitations` row by `phone_hash`  
  2. Create `users` row with `registration_source = 'contact_invitation'`  
  3. Create `conversation_sessions` row with `mode = interviewing_abbreviated`  
  4. Create `profiles` row with `state = empty`  
  5. Update `contact_invitations.status` to `'accepted'`  
  6. Send abbreviated welcome message (verbatim): "Hey — {inviterName} thought you'd be a good fit for JOSH. I'm JOSH, and I help people actually make plans. I just need a few quick answers to get started. Sound good?"  
  7. Begin abbreviated interview using `handleInterviewAnswerAbbreviated`  
* Handle dual-registration race condition: if two messages arrive simultaneously from the same invitee, use a DB transaction with a unique constraint on `users.phone_hash` to ensure only one user row is created. The second request receives a graceful fallback.  
* Profile state reaches `complete_invited` on abbreviated interview completion — never `complete_mvp`

Deliverables:

* `packages/messaging/src/handlers/handle-contact-invite-response.ts`  
* `packages/core/src/invitations/abbreviated-welcome-messages.ts` (verbatim message constants)  
* Unit tests: race condition handling (two simultaneous registrations for same phone)  
* Unit tests: profile state is `complete_invited` after abbreviated interview, not `complete_mvp`

Verification:

* An inbound message from a phone with a pending invitation creates exactly one user row even if the webhook fires twice  
* New user has `registration_source = 'contact_invitation'`  
* New session has `mode = interviewing_abbreviated`  
* Profile state is `complete_invited` after abbreviated interview completion

---

### **Ticket 20.3 — handleInterviewAnswerAbbreviated: Abbreviated Interview Engine (M)**

Goal: Implement the abbreviated interview flow for invited users.

Requirements:

* Create `packages/messaging/src/handlers/handle-interview-answer-abbreviated.ts`  
* Abbreviated completeness threshold (lower than full interview):  
  * At least 3 of 6 coordination dimensions at confidence \>= 0.55  
  * At least 1 of 3 coordination signals at confidence \>= 0.60  
* Use `selectNextQuestion()` from Phase 18 with the reduced threshold as the completion check  
* On completion, set `profile_state = complete_invited` (never `complete_mvp`)  
* Send abbreviated wrap message (verbatim): "That's enough to start. {inviterName} will get a heads up that you're in. I'll reach out when there's a plan that fits."  
* Dropout recovery for `interviewing_abbreviated` mode is already handled (Ticket 16.5)

Deliverables:

* `packages/messaging/src/handlers/handle-interview-answer-abbreviated.ts`  
* Unit tests: abbreviated completion threshold (3 of 6 dimensions, 1 of 3 signals)  
* Unit tests: abbreviated wrap message sent on completion  
* Unit tests: profile state is `complete_invited`, not `complete_mvp`, on completion

Verification:

* An abbreviated session with 3 dimensions at confidence \>= 0.55 and 1 signal at

   \= 0.60 transitions profile to `complete_invited`

* The abbreviated interview does not require all 6 dimensions  
* Dropout nudge fires for `interviewing_abbreviated` sessions inactive for 24 hours (covered by Ticket 16.5)

---

## **Phase 21 — Matching System Updates, Destructive Migrations, And Legacy Removal**

Updates the matching job to use 3.0 eligibility gates and the 6-dimension scoring model, runs the destructive enum migrations to remove deprecated values, and removes the legacy fingerprint compatibility pipeline.

Dependencies: Phase 18 (6-dimension profile system), Phase 17 (evaluateEligibility).

---

### **Ticket 21.1 — Enforce complete\_invited Hard Filter Across All Five Locations (L)**

Goal: Add the `complete_invited` hard filter at query level to every location in the codebase that fetches match candidates. This is the highest-priority safety item in the 3.0 build.

The filter must appear in all five locations identified by the codebase audit:

* `scripts/run-matching-job.mjs` — add `.neq("state", "complete_invited")` to the candidate pool query at line 34  
* `packages/core/compatibility-score-writer.ts` — add explicit exclusion to any candidate fetch  
* Orchestration SQL queries that fetch candidates — add `WHERE state != 'complete_invited'` to all  
* `match_candidates` import queries — add explicit exclusion  
* Initiator eligibility check — `complete_invited` users cannot initiate LinkUps

For each location:

* The filter must be at query level (not application level)  
* Add a comment reading `-- complete_invited hard filter: never relax` (or equivalent in application code: `// complete_invited hard filter: never relax`)  
* Add a defense-in-depth application-level check at lines 90–96 of the matching job as a secondary guard

Deliverables:

* Updated `run-matching-job.mjs`  
* Updated `compatibility-score-writer.ts`  
* Updated orchestration SQL  
* Updated `match_candidates` import queries  
* Updated initiator eligibility check  
* Unit tests: candidate pool query never returns a `complete_invited` profile regardless of `is_complete_mvp` value

Verification:

* A test profile with `state = complete_invited` AND `is_complete_mvp = true` does not appear in any match run output  
* Grep for `complete_invited hard filter` confirms the comment appears in all five locations

---

### **Ticket 21.2 — Matching Job: Remove one\_to\_one And Update Default Mode (S)**

Goal: Remove all `one_to_one` references from the matching job before the enum recreation migration runs.

Requirements:

* Remove `one_to_one` from `RUN_MODES` set (line 10\)  
* Remove `one_to_one` as a valid `--mode` argument (line 18\)  
* Change the default mode (line 374\) from `one_to_one` to `linkup`  
* Remove any `mode = 'one_to_one'` writes in `match_runs` and `match_candidates`  
* Verify no other application code writes `mode = 'one_to_one'` to any table

Deliverables:

* Updated `scripts/run-matching-job.mjs`  
* Unit test: passing `--mode one_to_one` throws an error  
* Unit test: default run mode is `linkup`

Verification:

* Running the matching job with `--mode one_to_one` throws before any DB writes  
* Default mode is `linkup`  
* No write to `match_runs.mode` or `match_candidates.mode` can produce `one_to_one` after this ticket

---

### **Ticket 21.3 — Matching Job: 6-Dimension Scoring (M)**

Goal: Update candidate scoring to use 6-dimension coordination profiles.

Requirements:

* Update scoring functions in `packages/core/` to read `CoordinationDimensions` from the `coordination_dimensions` column (using `PROFILE_DIMENSIONS_COLUMN` constant, now set to `coordination_dimensions` after Phase 18\)  
* Apply the 3.0 dimension weights from the Compatibility Scoring And Matching Algorithm spec  
* Profiles with incomplete dimension coverage are included with reduced confidence weight, not excluded  
* No 2.0 factor name may appear in the scoring logic after this ticket

Deliverables:

* Updated scoring functions in `packages/core/`  
* Updated call sites in `run-matching-job.mjs`  
* Unit tests: two 3.0-shaped profiles score correctly relative to each other  
* Unit tests: incomplete profile (3 of 6 dimensions) scores below complete profile

Verification:

* Two profiles with aligned `conversation_depth` score higher together than two profiles with mismatched `conversation_depth`  
* A profile with only 3 of 6 dimensions populated scores below a profile with all 6

---

### **Ticket 21.4 — Remove Legacy Fingerprint Compatibility Pipeline (L)**

Goal: Remove `compatibility-signal-writer.ts` and all remaining fingerprint-based compatibility pipeline code.

Background:

The Codex audit identified `compatibility-signal-writer.ts` as part of the 2.0 fingerprint pipeline that is not consumed by any 3.0 path. The `profile_compatibility_signals` and `profile_compatibility_scores` tables appear to be 2.0 dead code. This ticket confirms and removes them.

Pre-removal checklist (must be verified before executing):

* Confirm that `compatibility-signal-writer.ts` output is not consumed by any runtime path in 3.0 (grep all call sites)  
* Confirm that `profile_compatibility_signals` and `profile_compatibility_scores` are not read or written by any active application code

Requirements:

* Delete `packages/core/compatibility-signal-writer.ts` (if confirmed unused)  
* If the file has active consumers in any 3.0 path, mark `@deprecated` and resolve those consumers before deleting  
* Create and run migration to drop `profile_compatibility_signals` table (if confirmed unused)  
* Create and run migration to drop `profile_compatibility_scores` table (if confirmed unused)  
* Verify that no remaining fingerprint-keyed scoring or read path exists after Phases 18 and 21.3

Deliverables:

* `packages/core/compatibility-signal-writer.ts` deleted (or `@deprecated` if consumer found — consumers must be resolved before merge)  
* `supabase/migrations/YYYYMMDD_drop_legacy_compatibility_tables.sql`  
* Confirmation that grep produces no results for `compatibility-signal-writer` in active application code after this ticket

Verification:

* `profile_compatibility_signals` and `profile_compatibility_scores` no longer exist in the schema  
* No import of `compatibility-signal-writer` exists anywhere in the codebase

---

### **Ticket 21.5 — Destructive Enum Migrations (M)**

Goal: Remove deprecated enum values from `learning_signal_type` and `match_mode`.

Pre-migration checklist (must be verified before executing):

* No write path produces `match_preview_accepted`, `match_preview_rejected`, or `match_preview_expired` signal types (Ticket 21.1 should have caught all of these)  
* No write path produces `mode = 'one_to_one'` in `match_runs` or `match_candidates` (Ticket 21.2 must be complete)  
* `pnpm typecheck` passes with all deprecated values removed from TypeScript union types before the SQL migration runs

Requirements:

* For `learning_signal_type`:  
  1. Create `learning_signal_type_v2` enum with all current values minus `match_preview_accepted`, `match_preview_rejected`, `match_preview_expired`  
  2. Alter all columns using `learning_signal_type` to use the new type via USING cast  
  3. Drop `learning_signal_type`, rename `learning_signal_type_v2`  
* For `match_mode`:  
  1. Same pattern — create new enum with `linkup` only, alter `match_runs.mode` and `match_candidates.mode`, rebuild dependent indexes, drop old enum  
* Both recreations run in a single transaction  
* Document the rollback procedure in the migration file

Deliverables:

* `supabase/migrations/YYYYMMDD_recreate_enums_remove_deprecated.sql`  
* `docs/runbooks/enum-recreation-rollback.md`  
* Verification queries that confirm no rows contain deprecated values before the migration runs

Verification:

* Migration applies cleanly on staging with no data loss  
* Attempting to insert `match_preview_accepted` as a signal type throws a Postgres constraint error  
* Attempting to insert `one_to_one` as a match mode throws a Postgres constraint error  
* Row counts in `learning_signals` and `match_runs` are unchanged before and after

---

## **Phase 22 — Plan Circle, Solo Follow-Through, And Cleanup**

Implements the named plan coordination path, closes the solo follow-through loop, and runs all deferred cleanup work.

Dependencies: Phase 19 (intent routing), Phase 20 (contact\_circle populated by invited user flow).

---

### **Ticket 22.1 — handleNamedPlanRequest (M)**

Goal: Implement the NAMED\_PLAN\_REQUEST handler that coordinates plans with named contacts from the user's Plan Circle.

Requirements:

* Create `packages/messaging/src/handlers/handle-named-plan-request.ts`  
* Implement `handleNamedPlanRequest(userId, message, session)`:  
  * Call `evaluateEligibility({ userId, action_type: 'can_initiate_named_plan' })`  
  * If not eligible, respond with a friendly subscription message  
  * If eligible, extract the referenced contact name (LLM or deterministic — match against `contact_circle.contact_name`)  
  * If contact found: create a `plan_briefs` row, set session to `pending_plan_confirmation`, send a plan confirmation prompt  
  * If contact not found: ask the user to clarify or offer to add the contact  
* Session transitions to `pending_plan_confirmation` while awaiting reply

Deliverables:

* `packages/messaging/src/handlers/handle-named-plan-request.ts`  
* Unit tests: eligible user with known contact creates `plan_briefs` row  
* Unit tests: ineligible user receives subscription message, no `plan_briefs` created

Verification:

* "I want to grab dinner with Marcus" from a subscribed user creates a `plan_briefs` row and sends a confirmation prompt  
* The same message from an unsubscribed user receives an eligibility message  
* Session mode is `pending_plan_confirmation` after handler completes

---

### **Ticket 22.2 — handlePostActivityCheckin: Solo Follow-Through Loop (M)**

Goal: Implement the `post_activity_checkin` handler that closes the solo coordination loop and writes learning signals.

Requirements:

* Create `packages/messaging/src/handlers/handle-post-activity-checkin.ts`  
* Implement `handlePostActivityCheckin(userId, message, session)`:  
  * Parse attendance response (attended / did not attend)  
  * Attended → write `solo_activity_attended`, prompt do-again preference  
  * Do-again Yes → write `solo_do_again_yes`, prompt bridge offer ("Want me to find someone to do this with next time?")  
  * Bridge accepted → write `solo_bridge_accepted`, set session to idle  
  * Do-again No → write `solo_do_again_no`, set session to idle  
  * Did not attend → write `solo_activity_skipped`, set session to idle  
* Session returns to idle after any terminal branch  
* All five solo signal types from Phase 16 are written in their correct branches

Deliverables:

* `packages/messaging/src/handlers/handle-post-activity-checkin.ts`  
* Unit tests: all five solo signal types are written in the correct branches  
* Unit tests: session returns to idle in all terminal branches

Verification:

* A user who attended, wants to do it again with others, and accepts the bridge offer has `solo_activity_attended`, `solo_do_again_yes`, and `solo_bridge_accepted` signal rows after completing all three steps  
* Session mode is `idle` after any terminal branch

---

### **Ticket 22.3 — Remove Waitlist And Region Gate Runtime Paths (M)**

Goal: Remove the waitlist and region gating logic from all runtime code paths.

Background:

The 3.0 BETA model eliminates the waitlist. The 3.0 eligibility system (`evaluateEligibility()`) handles access gating. Any remaining runtime code that checks waitlist status, enqueues waitlist activations, or gates access based on region enrollment is 2.0 code that must be removed.

Pre-removal checklist (run before writing any code):

* Grep all runtime files for: `waitlist`, `region_gate`, `waitlist_activation`, `waitlist_status`, and `is_waitlisted`  
* List every file and function that checks waitlist or region gate state  
* Confirm none of these checks are required by the 3.0 eligibility model

Requirements:

* Remove all runtime waitlist status checks from conversation handlers and routing  
* Remove waitlist activation triggers from any runner or cron job  
* Remove region gate checks that have been superseded by `evaluateEligibility()` — region open/closed state is now only checked inside `can_initiate_linkup`  
* Do not remove the `regions` table or region data — region assignment still exists, only the gate-based enrollment logic is removed  
* Update `docs/runbooks/` if any runbook describes waitlist operations

Deliverables:

* All waitlist runtime checks removed  
* Updated runbooks if applicable  
* Confirmation grep: no runtime file references `waitlist_activation` or `is_waitlisted` after this ticket

Verification:

* A new user is not gated by waitlist status at any point in the 3.0 conversation flow  
* `evaluateEligibility({ action_type: 'can_initiate_linkup' })` is the only gating mechanism for LinkUp access

---

### **Ticket 22.4 — Remove All 1:1 Mode Code Paths (M)**

Goal: Remove all remaining `one_to_one` references from application code after the schema migration in Ticket 21.5.

Background:

Ticket 21.2 removed `one_to_one` from the matching job. Ticket 21.5 removed it from the schema. This ticket ensures no stray references remain elsewhere in the codebase.

Requirements:

* Grep the entire codebase for `one_to_one`, `OneToOne`, and `1:1` (in mode/matching context) after Ticket 21.5 completes  
* Remove or update every reference found  
* Update any TypeScript types, Zod validators, or constants that still reference the value  
* Update any documentation or runbooks that describe 1:1 matching

Deliverables:

* All `one_to_one` references removed from runtime code  
* Confirmation grep: no runtime file contains `one_to_one` in a matching or mode context after this ticket

Verification:

* `grep -r "one_to_one" --include="*.ts" .` returns no results in runtime code (migrations are acceptable)  
* `pnpm typecheck` passes

---

### **Ticket 22.5 — Drop profiles.fingerprint Column (M)**

Goal: Complete the two-step fingerprint column rename by dropping the `fingerprint` column after confirming all application code uses `coordination_dimensions`.

Background:

Phase 16 added `coordination_dimensions` alongside `fingerprint` and copied data. Phase 18 switched all writes and reads to `coordination_dimensions` via the `PROFILE_DIMENSIONS_COLUMN` constant. This ticket drops the old column.

Pre-removal checklist:

* `grep -r "fingerprint" --include="*.ts" packages/` returns no results outside of comment text  
* `grep -r '"fingerprint"' packages/` returns no results  
* All rows have non-null `coordination_dimensions` (verify before dropping)

Requirements:

* Drop `profiles.fingerprint` column  
* Remove the `PROFILE_DIMENSIONS_COLUMN` constant from `profile-writer.ts` and replace all uses with the literal string `'coordination_dimensions'`

Deliverables:

* `supabase/migrations/YYYYMMDD_drop_fingerprint_column.sql`  
* Updated `packages/core/src/profile/profile-writer.ts`

Verification:

* No column named `fingerprint` exists on `profiles`  
* All rows in `profiles` have non-null `coordination_dimensions`  
* `pnpm typecheck` passes

---

### **Ticket 22.6 — Spec Corrections (S)**

Goal: Update the two spec files containing 2.0 content identified during the audit.

Requirements:

* Update `docs/specs/Conversation_Behavior_Spec_3_0.md` line 389: Replace the 6-motive list (`connection, comfort, growth, play, restorative, adventure`) with the authoritative 9-motive vocabulary (`restorative, connection, play, exploration, achievement, stimulation, belonging, focus, comfort`)  
* Rewrite `docs/specs/Profile_Interview_And_Signal_Extraction_Spec.md`:  
  * Remove all references to the 12-factor Friend Fingerprint  
  * Remove `InterviewExtractInput/Output` with `stepId`  
  * Document the 6-dimension model and `HolisticExtractInput/HolisticExtractOutput`  
  * Document holistic extraction trigger points  
  * Document the 3.0 completeness thresholds

Deliverables:

* Updated `Conversation_Behavior_Spec_3_0.md`  
* Rewritten `Profile_Interview_And_Signal_Extraction_Spec.md`

Verification:

* No reference to `fingerprintPatches`, `FINGERPRINT_FACTOR_KEYS`, or any 2.0 factor name appears in either spec after this ticket  
* 9-motive vocabulary appears at the corrected location in `Conversation_Behavior_Spec_3_0.md`

---

## **Appendix — Build Order And Parallelism**

| Phase | Focus | Gate |
| ----- | ----- | ----- |
| 16 | Schema foundation — all additive migrations \+ dropout fix | Phase 15 complete |
| 17 | Type system \+ evaluateEligibility() | Phase 16 complete |
| 18 | 6-dimension profile system — coordinated replace | Phase 17 complete |
| 19 | Intent classification \+ router \+ all handlers | Phase 17 \+ Phase 16 complete |
| 20 | Invited user flow | Phase 16 \+ 17 \+ 19 complete; A2P for production dispatch |
| 21 | Matching job \+ destructive migrations \+ legacy removal | Phase 18 \+ 17 complete |
| 22 | Plan Circle \+ solo checkin \+ cleanup | Phase 19 \+ 20 complete |

Phases 17, 18, and 19 may run in parallel after Phase 16 completes. Phases 18 and 19 have no dependency on each other.

---

## **Appendix — complete\_invited Safety Guarantee**

The `complete_invited` hard filter is the highest-priority safety item in the 3.0 build. It must be enforced at multiple layers with no exceptions.

The five locations that require the filter (Ticket 21.1):

1. `run-matching-job.mjs` candidate pool query  
2. `packages/core/compatibility-score-writer.ts`  
3. Orchestration SQL queries that fetch candidates  
4. `match_candidates` import queries  
5. Initiator eligibility check

Rules that apply to all five locations:

* The filter must be at query level, not application level  
* The matching job must also have an application-level check as defense in depth  
* The filter must never be relaxed for low-density regions or small pool sizes  
* If the candidate pool is too small to run a match after the filter is applied, the match run aborts — it does not fall back to including invited users  
* Every location must carry the comment: `// complete_invited hard filter: never relax`

---

## **Appendix — A2P Compliance Gate**

The `handleContactInviteResponse` and contact invitation dispatch path send an unsolicited SMS to a non-member phone number. This requires A2P 10DLC campaign approval before it can legally be sent via Twilio in the US.

The A2P gate applies only to the outbound send path (the SMS to the invitee). All other work in Phase 20 — table creation, handler implementation, staging tests — may proceed without A2P approval.

Start the A2P campaign application in parallel with Phase 16 or 17 engineering work. Approval timelines vary and are outside engineering control. Do not let A2P approval become a blocker discovered at launch.