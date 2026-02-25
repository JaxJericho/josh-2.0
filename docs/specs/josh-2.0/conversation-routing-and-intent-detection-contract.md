# Conversation Routing And Intent Detection Contract

## Summary

This document defines exactly how JOSH processes every inbound SMS: how it validates Twilio payloads, applies STOP/START/HELP precedence, short-circuits for safety keywords, loads conversation state, classifies intent, and routes to the correct handler.

The goal is reliability and user trust. If Twilio retries the same message, the system must not double-apply side effects. If the user's message is ambiguous, JOSH must ask at most one clarifying question, then proceed without spiraling. If the user signals crisis or harm, safety responses must override everything else.

This spec includes the intent taxonomy, confidence thresholds, decision trees, local parsing rules (before using the LLM), context window management, prompt templates, error handling, and production wiring verification.

---

## Scope, Out Of Scope, Deferred

### In Scope

* Inbound SMS webhook contract and verification.  
* Message normalization and persistence.  
* Command precedence: STOP/START/HELP.  
* Safety keyword detection and escalation.  
* Conversation session loading and mode-based routing.  
* Intent detection: local parsing \+ LLM classifier.  
* "Max one clarifier" rule.  
* Output generation constraints for SMS.  
* Eligibility gate enforcement for all three coordination paths.  
* Invited user registration and reconciliation.

### Out Of Scope

* Real-time chat between users.  
* Voice calls.  
* Non-SMS channels (WhatsApp, iMessage).

### Deferred

* Multi-model routing (different LLMs for different intents).  
* Per-user adaptive prompting beyond simple personalization.

---

## Key Decisions

1. Command precedence and safety short-circuits bypass the LLM. Prevents accidental misclassification from causing compliance or safety issues.  
2. Local parsing before LLM for structured replies. Invite replies like "A/B/No" should not require LLM.  
3. Bounded clarifier rule (max one). Maintains momentum and avoids user frustration.  
4. Idempotency anchored on Twilio MessageSid. Prevents duplicate side effects on webhook retries.  
5. Conversation session is a pointer, not a transcript. Encourages privacy-first design and simple routing.  
6. Eligibility gates are split by action type, not binary access control. Three distinct gates enforce the 3.0 coordination path model. See Eligibility Gate Contract below.  
7. Invited user phone resolution runs before standard user lookup. An inbound message from an unknown number may be a response to a contact invitation. This must be checked before treating the sender as an unregistered stranger.

---

## Contract: Twilio Inbound Webhook

### Endpoint

`POST /api/twilio/inbound`

### Required Verification

1. Twilio signature validation  
   * Validate `X-Twilio-Signature` using Twilio Auth Token and full URL.  
   * If invalid: return 401 and do not persist message.  
2. Payload validation  
   * Required fields: `From`, `To`, `Body`, `MessageSid`.  
   * If missing: return 400, persist a `message_event` of type `inbound_invalid_payload`.

### Normalization

* Normalize `From` and `To` to E.164.  
* Trim body; collapse excessive whitespace.  
* Normalize unicode punctuation (optional but recommended).  
* Compute: `phone_hash = sha256(from_e164 + pepper)`

### Persistence (Always)

* Insert into `sms_messages`:  
  * direction `in`  
  * from/to  
  * twilio\_message\_sid  
  * encrypted body fields  
  * correlation\_id

Idempotency:

* Unique constraint on `sms_messages.twilio_message_sid`.  
* If insert conflicts:  
  * treat as duplicate delivery  
  * do not re-run side effects  
  * return 200\.

### Response Behavior

Preferred pattern:

* Return 200 quickly (no TwiML)  
* Send outbound SMS via Twilio REST after processing

Reason:

* Keeps webhook fast and avoids TwiML coupling to multi-step handlers.

---

## Precedence Rules (Hard)

These rules apply before any conversation state or LLM.

### STOP / START / HELP

1. If body matches STOP keyword:  
   * Record opt-out state.  
   * Send confirmation.  
   * Do not send any non-compliance messages.  
2. If body matches START keyword:  
   * Remove opt-out state.  
   * Send confirmation.  
3. If body matches HELP keyword:  
   * Send help message.

Precedence:

* STOP overrides everything.  
* START overrides other intents.  
* HELP overrides normal routing.

Implementation note:

* Twilio can handle STOP/START automatically for messaging services. Even so, JOSH must maintain its own opt-out state to avoid accidental sends.

### Keyword Definitions

Case-insensitive exact match and common variants:

* STOP: `stop`, `unsubscribe`, `cancel`, `end`, `quit`  
* START: `start`, `unstop`, `yes`  
* HELP: `help`, `info`

---

## Safety Keyword Detection And Escalation

Safety detection runs after STOP/START/HELP and before intent detection.

### Safety Keyword Categories

* Self-harm / suicide ideation  
* Harm threats (to others)  
* Sexual exploitation or coercion  
* Stalking / doxxing intent

### Detection Strategy

* Stage 1: deterministic keyword/phrase match (high recall)  
* Stage 2: optional LLM classification only when stage 1 hits (to reduce false positives)

### Short-Circuit Behavior

If safety hit is high confidence:

* Create `safety_incident` (severity \+ category)  
* Apply `safety_hold`:  
  * `hard_hold` for self-harm or imminent threats  
  * `soft_hold` for harassment signals pending review  
* Send safe response template.  
* Exit.

### Safe Response Requirements

* Non-judgmental.  
* Encourages contacting local emergency services.  
* Does not offer clinical advice.  
* Provides crisis resources (configurable by region/country).

---

## Conversation State Loading

After precedence checks, execute in this order:

1. Check for pending contact invitation

   * Query `contact_invitations` where `invitee_phone_hash = phone_hash` AND `status = pending`.  
   * If found: route to `handleContactInviteResponse`. This takes precedence over unknown user handling.  
   * If not found: continue to user resolution.  
2. Resolve user

   * By `phone_hash` on `users`.  
   * If no user found and no pending invitation: respond with a registration prompt. Persist a `message_event` of type `unknown_user_message`.  
3. Load conversation session

   * `conversation_sessions` row (one per user).  
   * If missing, create default `idle` session.  
4. Check user state

   * If `suspended`:  
     * If hold is hard: only allow safety/legal templates.  
     * Else: send "you're temporarily paused" message.  
5. Evaluate eligibility for action

   * Eligibility is checked per action type at the handler level, not at the routing level.  
   * See Eligibility Gate Contract below.

Note: Waitlist gating and region-based access control are deprecated. There is no waitlist check in the routing flow. Region state is used only by the eligibility gate for `can_initiate_linkup`.

---

## Eligibility Gate Contract

Three eligibility gates replace the previous single access control check. Every call to `evaluateEligibility()` must pass an explicit `action_type`. Any call site that does not pass `action_type` is a bug.

### Gate Definitions

`can_initiate_linkup`

* Required: `region.status = open` AND active subscription  
* Checked by: `handleLinkupRequest` and `handleOpenIntent` when resolved to a LinkUp

`can_initiate_named_plan`

* Required: active subscription only  
* Region state is irrelevant for this gate  
* Checked by: `handleNamedPlanRequest` and `handleOpenIntent` when resolved to a named plan

`can_receive_contact_invitation`

* Required: membership only (any user record exists)  
* No subscription check  
* Checked by: `handleContactInviteResponse` before beginning the abbreviated interview

### Enforcement Rule

Each handler is responsible for calling `evaluateEligibility({ userId, action_type })` before executing. The router does not evaluate eligibility — it only routes. If a handler receives a request it cannot fulfill due to eligibility, it returns a user-facing message explaining what's unavailable and why, without exposing technical detail.

---

## Intent Taxonomy (Canonical)

### Primary Intents

`INTERVIEW_ANSWER` User is responding to a profile interview question. Active when `session.mode = interviewing` or `session.mode = interviewing_abbreviated`.

`OPEN_INTENT` User expresses a social intent in natural language without naming specific contacts. Examples: "free this Saturday," "want to get out of the house," "looking to do something this weekend." Requires resolution to determine which coordination path applies (solo suggestion, Plan Circle, or LinkUp). Resolution depends on eligibility and profile state.

`NAMED_PLAN_REQUEST` User references one or more specific contacts by name or relationship. Examples: "want to grab coffee with Sarah," "see if Marcus is down for a hike." Routes to Plan Circle coordination. Requires `can_initiate_named_plan` eligibility.

`PLAN_SOCIAL_CHOICE` User is responding to a JOSH prompt asking how they want to handle social dimensions of a plan. Examples: choosing between solo or group, deciding whether to invite contacts, selecting an activity from options JOSH has offered. Active when `session.mode = awaiting_social_choice`.

`CONTACT_INVITE_RESPONSE` An invitee is responding to a contact invitation SMS. Active when a pending `contact_invitations` row exists for the sender's `phone_hash`. May originate from a non-member (new registration via invitation) or an existing member.

`POST_ACTIVITY_CHECKIN` User is responding to a JOSH post-activity follow-up. Active when `session.mode = post_activity_checkin`. Used as a learning signal and as a bridge to offer future social plans.

`INVITE_RESPONSE` User is responding to a LinkUp invitation (existing 2.0 flow). Active when `session.mode = awaiting_invite_reply`.

`PROFILE_UPDATE` User is requesting a change to their profile, preferences, or contacts. Examples: "add Jordan to my contacts," "I don't like hiking," "change my availability."

`HELP` User is asking for help or information about JOSH.

`UNKNOWN` Intent cannot be classified with sufficient confidence. Triggers a clarifier.

### System / Compliance Intents

`STOP` `START`

### Safety Intent

`CRISIS`

Note: `STOP/START/HELP` are detected locally and must not rely on the LLM. `CRISIS` is primarily keyword-driven, optionally LLM-confirmed.

---

## Session Modes (Canonical)

Session modes govern which intents are treated as primary when a message arrives.

`idle` — No active flow. General intent detection applies. `onboarding` — User is in the onboarding sequence. `interviewing` — User is completing the full profile interview. `interviewing_abbreviated` — Invited user is completing the abbreviated interview. `awaiting_social_choice` — JOSH has presented social options and is waiting for the user's selection. `awaiting_invite_reply` — User has received a LinkUp invitation and has not yet responded. `pending_plan_confirmation` — An invited user has completed the abbreviated interview; plan confirmation is pending. `post_activity_checkin` — JOSH has sent a post-activity follow-up and is awaiting a response.

---

## Confidence Thresholds And Clarifier Rules

### Thresholds

These values must be constants defined in config.

* `HIGH_CONFIDENCE = 0.80`  
* `MED_CONFIDENCE = 0.60`  
* `LOW_CONFIDENCE = 0.40`

### Routing Rules

* If intent confidence ≥ `HIGH_CONFIDENCE`: execute handler.  
* If `MED_CONFIDENCE ≤ confidence < HIGH_CONFIDENCE`:  
  * If the extracted fields satisfy the required schema: execute handler.  
  * Else: ask one clarifier.  
* If confidence \< `MED_CONFIDENCE`: ask one clarifier.

### Max One Clarifier Rule

* The system may ask at most one clarifying question for a message.  
* The clarifier must be choice-based whenever possible.  
* If user replies unexpectedly, treat it as their answer and proceed.

Clarifier tracking:

* Store a `clarifier_pending` state token in `conversation_sessions.state_token`.  
* Clarifier expires after 15 minutes or after next inbound message.

---

## Local Parsing Rules (Before LLM)

### Priority Local Parses

1. Contact invite responses when a pending `contact_invitations` row exists for the sender's `phone_hash`.

   * Accept tokens: `a`, `b`, `yes`, `in`, `ok`, `sure`, `I'm in`, `sounds good`  
   * Decline tokens: `no`, `nah`, `cant`, `can't`, `pass`, `not interested`  
2. Invite replies when `conversation.mode = awaiting_invite_reply` (LinkUp invitations)

   * Accept tokens: `a`, `b`, `yes`, `in`, `ok`, `sure`  
   * Decline tokens: `no`, `nah`, `cant`, `can't`, `pass`  
3. Post-activity checkin replies when `conversation.mode = post_activity_checkin`

   * Positive signal tokens: `yes`, `great`, `good`, `loved it`, `fun`, `enjoyed`  
   * Negative signal tokens: `no`, `nah`, `not really`, `didn't go`, `skipped`  
4. Simple help

   * If message contains "help" anywhere, treat as HELP if not part of another structured flow.  
5. Profile update shortcuts

   * "Change my region" → route to support flow.  
   * "Delete my account" → deletion confirmation flow.  
   * "Add \[name\]" or "Add \[name\] to my contacts" → `handleProfileUpdate` with contact add intent.

### Regex Examples

* Accept A: `^\s*(a|option\s*a|1)\s*$`  
* Accept B: `^\s*(b|option\s*b|2)\s*$`  
* Decline: `^\s*(no|nah|pass|cant|can't)\s*$`

---

## LLM Intent Detection Contract

### Interface (TypeScript)

```ts
export type LlmClassifyIntentInput = {
  userId: string;
  messageText: string;
  sessionMode: string;
  stateToken: string;
  recentMessages: Array<{
    role: "josh" | "user";
    text: string;
    timestamp: string;
  }>;
  eligibility: {
    canInitiateLinkup: boolean;
    canInitiateNamedPlan: boolean;
    canReceiveContactInvitation: boolean;
  };
};

export type LlmClassifyIntentOutput = {
  intent: string;
  confidence: number;
  extracted: {
    openIntent?: {
      activityHint?: string;
      timeWindowHint?: string;
      socialPreference?: "solo" | "named_contacts" | "open";
    };
    namedPlanRequest?: {
      contactNames: string[];
      activityHint?: string;
      timeWindowHint?: string;
    };
    planSocialChoice?: {
      selection: string;
    };
    inviteResponse?: { response?: "A" | "B" | "NO" | "YES" | "CANT" };
    profileUpdate?: {
      patches?: Array<{ path: string; op: "set" | "add" | "remove"; value: unknown }>;
    };
  };
  needsClarifier?: boolean;
  clarifierQuestion?: string;
  clarifierOptions?: Array<{ key: string; label: string }>;
};
```

### Output Constraints

* Always return valid JSON.  
* No additional prose.  
* If unsure, set `intent = UNKNOWN` and low confidence.  
* Clarifier question must be one SMS-length question (≤ 240 chars preferred).  
* Never return `STOP`, `START`, or `HELP` — these are handled before LLM classification.

---

## Prompt Templates

Prompts must be short, stable, and non-leaky.

### System Prompt (Intent Classifier)

```
You are an intent classifier for an SMS-first social coordination service.
Return ONLY valid JSON matching the provided schema.
Never include extra keys.
Use the user's current session mode and state token to weight intent probabilities.
If the message is ambiguous, set needsClarifier=true and provide a single choice-based clarifier.
Do not classify STOP, START, or HELP — these are handled upstream.
```

### Developer Prompt (Schema \+ Rules)

```
Schema: {IntentResult JSON schema description}

Rules:
- Prefer INTERVIEW_ANSWER when mode=interviewing or mode=interviewing_abbreviated.
- Prefer INVITE_RESPONSE when mode=awaiting_invite_reply.
- Prefer PLAN_SOCIAL_CHOICE when mode=awaiting_social_choice.
- Prefer POST_ACTIVITY_CHECKIN when mode=post_activity_checkin.
- Classify as NAMED_PLAN_REQUEST when the user references one or more contacts by name or relationship.
- Classify as OPEN_INTENT when the user expresses a social desire without naming contacts.
- OPEN_INTENT and NAMED_PLAN_REQUEST require activity or time signal; otherwise request clarifier.
- Use eligibility fields to inform resolution hints — do not enforce eligibility yourself.
- Keep clarifiers simple: reply A/B/No where possible.
```

### User Prompt (Context)

```
User message: "{messageText}"
Mode: {mode}
State token: {stateToken}
Eligibility: linkup={canInitiateLinkup}, named_plan={canInitiateNamedPlan}
Recent messages:
{recentMessages}
```

---

## Handler Routing Contract

After determining intent, map to exactly one handler. Handlers must be idempotent. Handlers must write domain events for state transitions.

### Handler List

`handleInterviewAnswer` — processes a user response during the full profile interview `handleInterviewAnswerAbbreviated` — processes a user response during the invited user abbreviated interview `handleOpenIntent` — resolves an OPEN\_INTENT to the appropriate coordination path based on eligibility and profile state; may route to solo suggestion, Plan Circle offer, or LinkUp initiation `handleNamedPlanRequest` — initiates Plan Circle coordination for one or more named contacts `handlePlanSocialChoice` — processes a user's selection when JOSH has offered social options `handleContactInviteResponse` — handles an invitee's response to a contact invitation; creates new user if needed, begins abbreviated interview `handlePostActivityCheckin` — processes a post-activity follow-up response; records outcome as learning signal; offers bridge to social plans `handleInviteResponse` — processes a user's response to a LinkUp invitation (2.0 flow) `handleProfileUpdate` — applies changes to profile, preferences, or contacts `handleHelp` — sends help content `handleUnknown` — sends a clarifier

### Handler Rules

Each handler:

* validates extracted payload  
* calls `evaluateEligibility({ userId, action_type })` where applicable  
* performs DB transaction(s)  
* creates outbound SMS jobs  
* updates conversation session mode and state token  
* emits domain events

### Registration Via Invitation

When `handleContactInviteResponse` receives a message from a phone number with a pending `contact_invitations` row and no existing `users` row:

1. Create a new `users` row with `registration_source = contact_invitation`.  
2. Create a new `conversation_sessions` row with `mode = interviewing_abbreviated`.  
3. Create a new `profiles` row with `profile_state = NULL` (abbreviated interview begins).  
4. Mark `contact_invitations.status = accepted`.  
5. Begin abbreviated interview flow.

### Dual Registration Race Condition

If an invitee independently registers through the organic BETA path while a `contact_invitations` row is pending for their `phone_hash`:

* Detect on user creation: query `contact_invitations` by `invitee_phone_hash` on every new user insert.  
* If a pending invitation is found: mark it `status = reconciled`, associate it with the newly created user, and flag it for follow-up by the Plan Circle initiator.  
* This handler must be explicit. Do not rely on eventual consistency.

---

## OPEN\_INTENT Resolution Logic

`OPEN_INTENT` requires resolution to determine which coordination path applies. The resolver runs inside `handleOpenIntent` after eligibility is evaluated.

Resolution priority:

1. If `can_initiate_linkup = true` AND region is open AND user has Plan Circle contacts with compatible profiles for the inferred activity: offer Plan Circle path first, with LinkUp as an alternative.  
2. If `can_initiate_linkup = true` AND region is open AND no compatible Plan Circle contacts: initiate LinkUp.  
3. If `can_initiate_named_plan = true` AND user has Plan Circle contacts: offer Plan Circle.  
4. Default: initiate solo coordination suggestion.

Solo coordination is always available as a fallback. It is never presented to the user as a consolation — it is framed as the primary action when no other path is available or appropriate.

---

## Error Handling

### Categories

1. User errors (bad inputs)  
   * Response: one helpful SMS with choices.  
2. System errors (exceptions, DB failures)  
   * Response: apology \+ "try again" message.  
   * Log: Sentry error \+ correlation ID.  
3. LLM errors (timeout, invalid JSON)  
   * Response: fallback to simple local clarifier.  
   * Log: store prompt hash \+ error.

### Retry Policy

* Inbound processing must be at-least-once safe.  
* Outbound job sending retries with backoff: 1m, 5m, 15m, then fail.

---

## Decision Trees

### Decision Tree: Inbound Message

* If Twilio signature invalid → 401  
* Else insert `sms_messages` (idempotent)  
* If duplicate MessageSid → 200 and exit  
* Else if STOP/START/HELP → handle and exit  
* Else if safety keyword hit → create incident \+ hold \+ safe reply and exit  
* Else check `contact_invitations` by `phone_hash`  
  * If pending invitation found → route to `handleContactInviteResponse`  
* Else resolve user by `phone_hash`  
  * If no user found → send registration prompt and exit  
* Else load conversation session  
* If user suspended → restricted messaging  
* Else local parse if awaiting invite reply or post-activity checkin  
* Else call LLM intent classifier  
* If confidence high → route handler  
* Else ask clarifier

### Decision Tree: Clarifier Reply

* If session.state\_token indicates clarifier pending:  
  * attempt parse as one of options  
  * if matches: route original intended handler with clarified fields  
  * else: proceed using best-effort inference (do not ask another clarifier)

---

## Examples

### Example 1: Invite Reply (LinkUp)

* Mode: `awaiting_invite_reply`  
* User text: "A"  
* Local parse → `INVITE_RESPONSE` accept A  
* No LLM call.

### Example 2: Open Intent With Clarifier

* User text: "Want to do something this weekend"  
* LLM returns `OPEN_INTENT`, confidence 0.65, no activity signal  
* Clarifier: "What sounds good? Reply A coffee, B hike, C something else."

### Example 3: Named Plan Request

* User text: "See if Jordan is free for a hike Saturday"  
* LLM returns `NAMED_PLAN_REQUEST`, confidence 0.88, contactNames: \["Jordan"\], activityHint: "hike", timeWindowHint: "Saturday"  
* No clarifier. Route to `handleNamedPlanRequest`.

### Example 4: Contact Invite Response (New User)

* Inbound from unknown phone number  
* `contact_invitations` query returns a pending row for this `phone_hash`  
* Route to `handleContactInviteResponse`  
* No existing user → create user, session, profile → begin abbreviated interview

### Example 5: Post-Activity Checkin

* Mode: `post_activity_checkin`  
* User text: "Yeah it was great actually"  
* Local parse → positive signal  
* Route to `handlePostActivityCheckin`  
* Record outcome → offer bridge to Plan Circle or future LinkUp

### Example 6: Safety Short-Circuit

* User text includes self-harm phrase  
* Create incident \+ hard hold  
* Send safe response  
* No further processing.

---

## Dependencies

* Domain Model And State Machines spec: states and transitions.  
* Database Schema spec: schema tables for messages, sessions, incidents, jobs, contacts, contact\_invitations, plan\_briefs.  
* Profile Interview And Signal Extraction Spec: extraction interfaces and profile state definitions.  
* Eligibility And Entitlements Enforcement spec: `evaluateEligibility()` implementation.  
* Link Up Orchestration Contract: LinkUp brief schema and wave invite rules.  
* Compatibility Scoring And Matching Algorithm spec: matching logic called by `handleOpenIntent` for LinkUp path.

---

## Risks And Mitigation

1. LLM outputs invalid JSON  
   * Mitigation: strict JSON schema validation \+ retry once \+ fallback clarifier.  
2. Clarifier loops  
   * Mitigation: store clarifier pending token and enforce max one.  
3. False positive safety detection  
   * Mitigation: two-stage approach; require high confidence for hard hold.  
4. Unknown user inbound messages spam endpoint  
   * Mitigation: rate limit per `phone_hash`.  
5. complete\_invited profile enters stranger matching pool  
   * Mitigation: hard filter in `evaluateEligibility()` for `can_initiate_linkup`. Audited at every call site during Claude Code review.  
6. Dual registration race condition  
   * Mitigation: explicit reconciliation handler on every new user insert. Not deferred.  
7. Twilio A2P compliance for cold SMS to non-member invitees  
   * Mitigation: do not ship `handleContactInviteResponse` send flow without confirmed A2P campaign approval for this use case. This is a carrier and legal requirement, not an engineering decision.

---

## Testing Approach

### Unit Tests

* STOP/START/HELP precedence.  
* Safety short-circuit.  
* Local parsing patterns.  
* Clarifier state machine.  
* `evaluateEligibility()` returns correct gate result for each `action_type`.  
* Contact invite lookup correctly identifies pending invitations before user resolution.

### Integration Tests

* Full inbound → insert → handler → outbound job.  
* LLM invalid JSON fallback.  
* Twilio duplicate MessageSid no double side effects.  
* New user created via invitation → abbreviated interview begins → `profile_state = complete_invited`.  
* `complete_invited` user cannot trigger `can_initiate_linkup` gate.  
* Dual registration reconciliation fires when organic BETA registration matches pending invitation `phone_hash`.

### E2E Scenarios

* Organic BETA onboarding → full interview → first solo suggestion → Plan Circle prompt.  
* Invited user flow → abbreviated interview → plan confirmation.  
* OPEN\_INTENT resolved to solo suggestion when LinkUp unavailable.  
* NAMED\_PLAN\_REQUEST with valid Plan Circle contact.  
* Post-activity checkin → bridge to social plan offer.  
* LinkUp invitation → acceptance → plan lock.  
* Safety incident overrides normal flow.

---

## Production Readiness

### Infrastructure Setup

Vercel:

* Ensure `/api/twilio/inbound` is publicly reachable.  
* Add rate limiting (edge middleware or server-side) for unknown senders.  
* Set environment variables:  
  * `TWILIO_AUTH_TOKEN`  
  * `TWILIO_ACCOUNT_SID`  
  * `TWILIO_MESSAGING_SERVICE_SID`  
  * `ANTHROPIC_API_KEY`  
  * `SUPABASE_SERVICE_ROLE_KEY`

Twilio:

* Configure inbound webhook URL per environment.  
* Confirm Messaging Service compliance settings, including A2P campaign approval status for contact invitation SMS before that flow ships.  
* Verify STOP keyword behavior and ensure JOSH respects opt-out.

### Environment Parity

* Staging must use a separate Twilio number.  
* Optional staging allowlist: only respond to approved numbers.

### Deployment Procedure

1. Deploy code to staging.  
2. Point staging Twilio webhook to staging endpoint.  
3. Send controlled test messages.  
4. Promote to production.  
5. Point production Twilio webhook to prod endpoint.

### Wiring Verification

Smoke tests:

* Send "HELP" → help response  
* Send "STOP" → opt-out confirmation  
* Send "START" → opt-in confirmation  
* Send random text during interview → interview handler  
* Send "A" to a LinkUp invite → invite handler local parse  
* Send ambiguous open intent → clarifier asked  
* Send message from phone number with pending contact invitation (no user record) → abbreviated interview begins  
* Send open intent from user with no eligible region → solo suggestion returned

Verify in DB:

* `sms_messages` inserted once per MessageSid  
* outbound job created for each outbound SMS  
* domain events recorded for state changes  
* `contact_invitations.status` updated on response  
* `profile_state = complete_invited` set after abbreviated interview wrap

### Operational Readiness

Every inbound message logs:

* correlation\_id  
* resolved user\_id (or `unknown` if not resolved)  
* intent \+ confidence  
* handler selected  
* eligibility gate result where applicable

Sentry captures:

* webhook validation failures (warning)  
* LLM timeouts  
* handler exceptions  
* eligibility gate errors

Metrics:

* inbound volume  
* intent distribution  
* clarifier rate  
* safety hit rate  
* contact invitation response rate  
* `complete_invited` conversion to `complete_mvp` rate

---

## Implementation Checklist

1. Implement Twilio signature verification.  
2. Implement inbound payload validation \+ normalization.  
3. Implement `sms_messages` insert with idempotency.  
4. Implement STOP/START/HELP local handlers \+ opt-out state.  
5. Implement safety keyword detection and incident creation.  
6. Implement contact invitation lookup before user resolution.  
7. Implement conversation session load/create and update.  
8. Implement local parse rules for invite replies, contact invite responses, and post-activity checkins.  
9. Implement `evaluateEligibility()` with all three action types.  
10. Implement LLM adapter:  
    * prompt assembly  
    * schema validation  
    * retry \+ fallback  
11. Implement handler registry and routing.  
12. Implement dual registration reconciliation on new user insert.  
13. Add structured logs \+ correlation ID propagation.  
14. Add integration tests for duplicates, fallbacks, eligibility gates, and invited user registration.