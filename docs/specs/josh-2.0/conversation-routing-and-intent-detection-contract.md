# Conversation Routing And Intent Detection Contract (JOSH 2.0)

## *Document 4*

## Summary

This document defines exactly how JOSH processes every inbound SMS: how it validates Twilio payloads, applies STOP/START/HELP precedence, short-circuits for safety keywords, loads conversation state, classifies intent, and routes to the correct handler.

The goal is reliability and user trust. If Twilio retries the same message, the system must not double-apply side effects. If the user’s message is ambiguous, JOSH must ask at most one clarifying question, then proceed without spiraling. If the user signals crisis or harm, safety responses must override everything else.

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
* “Max one clarifier” rule.  
* Output generation constraints for SMS.

### Out Of Scope

* Real-time chat between users.  
* Voice calls.  
* Non-SMS channels (WhatsApp, iMessage).

### Deferred

* Multi-model routing (different LLMs for different intents).  
* Per-user adaptive prompting beyond simple personalization.

---

## Key Decisions

1. Command precedence and safety short-circuits bypass the LLM  
   * Prevents accidental misclassification from causing compliance or safety issues.  
2. Local parsing before LLM for structured replies  
   * Invite replies like “A/B/No” should not require LLM.  
3. Bounded clarifier rule (max one)  
   * Maintains momentum and avoids user frustration.  
4. Idempotency anchored on Twilio MessageSid  
   * Prevents duplicate side effects on webhook retries.  
5. Conversation session is a pointer, not a transcript  
   * Encourages privacy-first design and simple routing.

---

## Contract: Twilio Inbound Webhook

### Endpoint

* `POST /api/twilio/inbound`

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
* Compute:  
  * `phone_hash = sha256(from_e164 + pepper)`

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

After precedence checks:

1. Resolve user  
   * By `phone_hash` on `users`.  
   * If no user:  
     * If inbound is from an unknown number, respond with a registration link.  
     * Persist an event `unknown_user_message`.  
2. Load conversation session  
   * `conversation_sessions` row (one per user).  
   * If missing, create default `idle` session.  
3. Check user state  
   * If `suspended`:  
     * If hold is hard: only allow safety/legal templates.  
     * Else: send “you’re temporarily paused” message.  
4. Check region gating  
   * If region waitlisted:  
     * allow onboarding interview (as per your earlier decision)  
     * deny LinkUp actions and invites

---

## Intent Taxonomy (Canonical)

### Primary Intents

* `INTERVIEW_ANSWER`  
* `LINKUP_REQUEST`  
* `INVITE_RESPONSE`  
* `PROFILE_UPDATE`  
* `HELP`  
* `UNKNOWN`

### System / Compliance Intents

* `STOP`  
* `START`

### Safety Intent

* `CRISIS`

Note:

* `STOP/START/HELP` are detected locally and should not rely on LLM.  
* `CRISIS` is primarily keyword-driven, optionally LLM-confirmed.

---

## Confidence Thresholds And Clarifier Rules

### Thresholds

These values must be constants and included in configs.

* `HIGH_CONFIDENCE = 0.80`  
* `MED_CONFIDENCE = 0.60`  
* `LOW_CONFIDENCE = 0.40`

### Routing Rules

* If intent confidence ≥ `HIGH_CONFIDENCE`: execute handler.  
* If `MED_CONFIDENCE ≤ confidence < HIGH_CONFIDENCE`:  
  * If the extracted fields satisfy required schema: execute handler.  
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

1. Invite replies when `conversation.mode = awaiting_invite_reply`  
   * Accept tokens: `a`, `b`, `yes`, `in`, `ok`, `sure`  
   * Decline tokens: `no`, `nah`, `cant`, `can't`, `pass`  
2. Simple help  
   * If message contains “help” anywhere, you may still treat as HELP if not part of another structured flow.  
3. Profile update shortcuts  
   * “Change my region” → route to support flow.  
   * “Delete my account” → deletion confirmation flow.

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
  recentMessages: Array<{ direction: "in" | "out"; text: string; at: string }>;
  activeState: {
    mode: "interviewing" | "idle" | "linkup_forming" | "awaiting_invite_reply";
    stateToken: string;
  };
  regionState: "open" | "waitlisted" | "closed";
  entitlement: {
    canParticipate: boolean;
    canInitiate: boolean;
  };
};

export type IntentResult = {
  intent:
    | "INTERVIEW_ANSWER"
    | "LINKUP_REQUEST"
    | "INVITE_RESPONSE"
    | "PROFILE_UPDATE"
    | "HELP"
    | "UNKNOWN";
  confidence: number;
  extracted?: {
    interview?: { stepId?: string; answerText?: string };
    linkup?: {
      activityKey?: string;
      timeWindow?: string;
      locationHint?: string;
      groupSizePref?: { min?: number; max?: number };
      constraints?: Record<string, boolean>;
    };
    invite?: { response?: "A" | "B" | "NO" | "YES" | "CANT" };
    profileUpdate?: { patches?: Array<{ path: string; op: "set" | "add" | "remove"; value: unknown }> };
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

---

## Prompt Templates

Prompts must be short, stable, and non-leaky.

### System Prompt (Intent Classifier)

```
You are an intent classifier for an SMS-first friendship matching service.
Return ONLY valid JSON matching the provided schema.
Never include extra keys.
Use the user's current mode and state token.
If the message is ambiguous, set needsClarifier=true and provide a single choice-based clarifier.
```

### Developer Prompt (Schema \+ Rules)

```
Schema: {IntentResult JSON schema description}
Rules:
- STOP/START/HELP are handled elsewhere; do not output them.
- Prefer INTERVIEW_ANSWER when mode=interviewing.
- Prefer INVITE_RESPONSE when mode=awaiting_invite_reply.
- LINKUP_REQUEST requires activity + time window; otherwise request clarifier.
- Keep clarifiers simple: reply A/B/No where possible.
```

### User Prompt (Context)

```
User message: "{messageText}"
Mode: {mode}
State token: {stateToken}
Region state: {regionState}
Entitlements: participate={canParticipate}, initiate={canInitiate}
Recent messages:
{recentMessages}
```

---

## Handler Routing Contract

After determining intent:

* Map intent to exactly one handler.  
* Handlers must be idempotent.  
* Handlers must write domain events for state transitions.

### Handler List (Minimum)

* `handleInterviewAnswer`  
* `handleLinkupRequest`  
* `handleInviteResponse`  
* `handleProfileUpdate`  
* `handleHelp`  
* `handleUnknown`

### Handler Rules

* Each handler:  
  * validates extracted payload  
  * performs DB transaction(s)  
  * creates outbound SMS jobs  
  * updates conversation session mode/state token  
  * emits domain events

---

## Error Handling

### Categories

1. User errors (bad inputs)  
   * Response: one helpful SMS with choices.  
2. System errors (exceptions, DB failures)  
   * Response: apology \+ “try again” message.  
   * Log: Sentry error \+ correlation ID.  
3. LLM errors (timeout, invalid JSON)  
   * Response: fallback to simple local clarifier.  
   * Log: store prompt hash \+ error.

### Retry Policy

* Inbound processing should be at-least-once safe.  
* Outbound job sending should retry with backoff:  
  * 1m, 5m, 15m, then fail.

---

## Decision Trees

### Decision Tree: Inbound Message

* If Twilio signature invalid → 401  
* Else insert `sms_messages` (idempotent)  
* If duplicate MessageSid → 200 and exit  
* Else if STOP/START/HELP → handle and exit  
* Else if safety keyword hit → create incident \+ hold \+ safe reply and exit  
* Else resolve user and session  
* If user unknown → send registration link  
* Else if user suspended → restricted messaging  
* Else local parse if awaiting invite reply  
* Else call LLM  
* If confidence high → route handler  
* Else ask clarifier

### Decision Tree: Clarifier Reply

* If session.state\_token indicates clarifier pending:  
  * attempt parse as one of options  
  * if matches: route original intended handler with clarified fields  
  * else: proceed using best-effort inference (do not ask another clarifier)

---

## Examples

### Example 1: Invite Reply

* Mode: `awaiting_invite_reply`  
* User text: “A”  
* Local parse → `INVITE_RESPONSE` accept A  
* No LLM call.

### Example 2: LinkUp Request Ambiguous

* User text: “Wanna do something this weekend”  
* LLM returns confidence 0.65, missing activity  
* Clarifier: “What sounds best? Reply A coffee, B walk, C museum.”

### Example 3: Safety Short-Circuit

* User text includes self-harm phrase  
* Create incident \+ hard hold  
* Send safe response  
* No further processing.

---

## Dependencies

* Document 2: states and transitions.  
* Document 3: schema tables for messages, sessions, incidents, jobs.  
* Document 6: interview step IDs and extraction mapping.  
* Document 7: LinkUp brief schema and wave invite rules.

---

## Risks And Mitigation

1. LLM outputs invalid JSON  
   * Mitigation: strict JSON schema validation \+ retry once \+ fallback clarifier.  
2. Clarifier loops  
   * Mitigation: store clarifier pending token and enforce max one.  
3. False positive safety detection  
   * Mitigation: two-stage approach; require high confidence for hard hold.  
4. Unknown user inbound messages spam endpoint  
   * Mitigation: rate limit per From number hash.

---

## Testing Approach

### Unit Tests

* STOP/START/HELP precedence.  
* Safety short-circuit.  
* Local parsing patterns.  
* Clarifier state machine.

### Integration Tests

* Full inbound → insert → handler → outbound job.  
* LLM invalid JSON fallback.  
* Twilio duplicate MessageSid no double side effects.

### E2E Scenarios

* Interview flow progression.  
* LinkUp request with clarifier.  
* Invite acceptance locks LinkUp.  
* Safety incident overrides normal flow.

---

## Production Readiness

### 1\) Infrastructure Setup

#### Vercel

* Ensure `/api/twilio/inbound` is publicly reachable.  
* Add rate limiting (edge middleware or server-side) for unknown senders.  
* Set environment variables:  
  * `TWILIO_AUTH_TOKEN`  
  * `TWILIO_ACCOUNT_SID`  
  * `TWILIO_MESSAGING_SERVICE_SID`  
  * `ANTHROPIC_API_KEY`  
  * `SUPABASE_SERVICE_ROLE_KEY`

#### Twilio

* Configure inbound webhook URL per environment.  
* Confirm Messaging Service compliance settings.  
* Verify STOP keywords behavior and ensure JOSH respects opt-out.

### 2\) Environment Parity

* Staging must use a separate Twilio number.  
* Optional staging allowlist:  
  * only respond to approved numbers.

### 3\) Deployment Procedure

1. Deploy code to staging.  
2. Point staging Twilio webhook to staging endpoint.  
3. Send controlled test messages.  
4. Promote to production.  
5. Point production Twilio webhook to prod endpoint.

### 4\) Wiring Verification

Run these smoke tests:

* Send “HELP” → help response  
* Send “STOP” → opt-out confirmation  
* Send “START” → opt-in confirmation  
* Send random text during interview → interview handler  
* Send “A” to an invite → invite handler local parse  
* Send ambiguous LinkUp request → clarifier asked

Verify in DB:

* `sms_messages` inserted once per MessageSid  
* outbound job created for each outbound SMS  
* domain events recorded for state changes

### 5\) Operational Readiness

* Every inbound message logs:  
  * correlation\_id  
  * resolved user\_id  
  * intent \+ confidence  
  * handler selected  
* Sentry should capture:  
  * webhook validation failures (warning)  
  * LLM timeouts  
  * handler exceptions  
* Metrics:  
  * inbound volume  
  * intent distribution  
  * clarifier rate  
  * safety hit rate

---

## Implementation Checklist

1. Implement Twilio signature verification.  
2. Implement inbound payload validation \+ normalization.  
3. Implement `sms_messages` insert with idempotency.  
4. Implement STOP/START/HELP local handlers \+ opt-out state.  
5. Implement safety keyword detection and incident creation.  
6. Implement conversation session load/create and update.  
7. Implement local parse rules for invite replies.  
8. Implement LLM adapter:  
   * prompt assembly  
   * schema validation  
   * retry \+ fallback  
9. Implement handler registry and routing.  
10. Add structured logs \+ correlation ID propagation.  
11. Add integration tests for duplicates and fallbacks.