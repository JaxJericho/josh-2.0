# System Architecture Overview (JOSH 2.0)

## *Document \#1*

## Summary

JOSH 2.0 is an SMS-first service that helps adults meet compatible friends by coordinating small, one-time group hangs (“LinkUps”). Users register on the website, verify their phone number, complete a conversational interview over SMS, then either initiate a LinkUp by texting naturally or accept invites to LinkUps that fit their vibe.

The system’s job is to reliably move people through a few high-stakes moments: verification, interview completion, a clear paywall when needed, forming a LinkUp within a 24-hour acceptance window, locking the group when quorum is reached, and supporting a privacy-first contact exchange afterward. Every part of the architecture is designed to be correct under retries (Twilio re-deliveries, webhook duplication), safe under abuse scenarios, and auditable when something goes wrong.

This document defines the full service boundary map, how data flows through the system, and the API contracts between major components. It is written to be buildable from scratch.

---

## Scope, Out Of Scope, Deferred

### In Scope

* SMS inbound/outbound processing via Twilio webhooks.  
* Conversation routing and intent detection.  
* Conversational interview, profile signal extraction, and updates.  
* LinkUp creation, candidate selection, wave invites, locking, and cancellations.  
* Dashboard magic links and web dashboard views.  
* Stripe subscription and entitlements enforcement.  
* Safety and privacy protections (keyword short-circuits, holds, minimal raw text retention).  
* Admin dashboard basics (ops \+ support workflows) as defined in later documents.  
* Observability hooks (logging, Sentry events, metrics interfaces).

### Out Of Scope

* Real-time chat between participants (SafeChat, masked relay chat) unless explicitly defined later.  
* Full venue marketplace integrations (Yelp, Google Places) beyond minimal geocoding and suggestion logic.  
* Complex scheduling negotiation beyond “bounded clarifier (max one question).”  
* Advanced ML training pipelines (batch learning beyond the MVP learning loop).

### Deferred

* Participant-initiated events (“hosting a D\&D game”) as an alternative LinkUp creation pathway.  
* Rich preference editor UI beyond minimal profile review \+ simple updates.  
* Multi-region travel mode / temporary location switching.

---

## Service Boundaries And Responsibilities

This architecture favors a modular monolith in the web layer (Next.js) plus clear domain services (implemented as application modules and/or serverless functions). You can split into microservices later without changing contracts.

### Core Components

1. Web App (Next.js)  
   * Public website and registration (OTP flow via SMS).  
   * User dashboard (LinkUps, profile summary, contact exchange).  
   * Admin dashboard (ops/support).  
   * Server routes for internal orchestration (API routes / server actions) and webhook endpoints.  
2. SMS Gateway (Twilio)  
   * Inbound SMS webhooks → JOSH.  
   * Outbound SMS delivery.  
   * STOP/START/HELP handling (with precedence).  
3. Conversation Engine  
   * Normalize inbound messages.  
   * Enforce command precedence and safety short-circuits.  
   * Determine “what the user is trying to do” (intent detection contract).  
   * Maintain conversation state machine pointers (interview step, LinkUp pending decision, etc.).  
4. Profile & Signal Service  
   * Store the user’s structured “friend fingerprint” signals.  
   * Update rules: confidence, freshness, and guardrails.  
   * Provide profile summaries for dashboard and matching.  
5. Matching Service  
   * Candidate filtering (eligibility \+ feasibility).  
   * Scoring (friend compatibility \+ moment fit).  
   * Ranking and selection.  
   * Explainability fields for audit/debug.  
6. LinkUp Coordinator  
   * Create LinkUp briefs.  
   * Invite waves.  
   * Manage 24-hour acceptance windows.  
   * Lock groups, handle cancel/replacement rules.  
   * Schedule reminders.  
7. Billing & Entitlements (Stripe)  
   * Subscription checkout.  
   * Webhooks for subscription state.  
   * Entitlements enforcement across system.  
8. Safety & Trust  
   * Crisis keyword detection.  
   * Safety holds and rate limiting.  
   * Reporting and audit queues.  
9. Data Platform (Supabase)  
   * PostgreSQL for core data.  
   * Row-level security (RLS) for user-visible tables.  
   * Storage for profile images.  
   * Auth (magic links / session-based auth).  
10. Observability  
* Sentry for errors/performance.  
* Structured logs.  
* Metrics (counters/histograms) exported to a dashboard stack.

---

## Deployment Topology

### High-Level Topology

* Vercel hosts Next.js (web \+ API routes).  
* Supabase Cloud hosts Postgres \+ Auth \+ Storage.  
* Twilio is the SMS provider.  
* Stripe handles payments.  
* LLM Provider (Anthropic API) handles intent classification \+ interview extraction.

Mermaid: deployment view

```
flowchart LR
  U[User Phone] -->|SMS| T[Twilio]
  T -->|Webhook: inbound SMS| V[Vercel: Next.js API]
  V -->|Read/Write| S[(Supabase Postgres)]
  V -->|Auth/Storage| SA[Supabase Auth/Storage]
  V -->|LLM calls| A[Anthropic API]
  V -->|Checkout + Webhooks| P[Stripe]
  V -->|Outbound SMS| T
  V -->|Errors/Perf| E[Sentry]
```

### Environment Separation

Three environments are mandatory:

1. Local Dev  
   * Next.js local server.  
   * Supabase local stack (CLI).  
   * Twilio dev number configured to point to a tunnel URL (ngrok/cloudflared).  
   * Stripe test mode.  
2. Staging  
   * Vercel project: `josh-staging`.  
   * Supabase project: `josh-staging`.  
   * Twilio staging number.  
   * Stripe test mode (or a dedicated staging Stripe account).  
3. Production  
   * Vercel project: `josh-prod`.  
   * Supabase project: `josh-prod`.  
   * Twilio production number.  
   * Stripe live mode.

Principle: No shared databases, no shared phone numbers, no shared Stripe webhook endpoints.

---

## Data Flow Diagrams

### A) Inbound SMS → Routing → Action

```
flowchart TD
  A[Twilio inbound SMS webhook] --> B[Normalize + validate payload]
  B --> C{Command? STOP/START/HELP}
  C -->|Yes| C1[Handle command and exit]
  C -->|No| D{Safety keyword hit?}
  D -->|Yes| D1[Create safety incident + hold + safe reply]
  D -->|No| E[Load user + conversation state]
  E --> F[Intent detection]
  F --> G{Intent type}
  G -->|Interview| H[Interview step handler]
  G -->|LinkUp request| I[LinkUp brief builder]
  G -->|Invite response| J[Invite response handler]
  G -->|Profile update| K[Profile update handler]
  G -->|Help/other| L[Help/FAQ handler]
  H --> M[Persist signals + state]
  I --> N[Persist LinkUp draft + maybe clarifier]
  J --> O[Update invite status + maybe lock]
  K --> P[Persist profile edits]
  L --> Q[Send response]
  M --> Q
  N --> Q
  O --> Q
  P --> Q
```

### B) LinkUp Formation: From Brief → Invites → Lock

```
flowchart TD
  A[LinkUp Brief created] --> B[Eligibility + feasibility filters]
  B --> C[Score candidates]
  C --> D[Invite wave #1]
  D --> E{Quorum reached?}
  E -->|Yes| F[Lock LinkUp]
  E -->|No| G{Acceptance window remaining?}
  G -->|Yes| H[Invite wave #2..N]
  H --> E
  G -->|No| I[Expire + notify initiator]
  F --> J[Send lock texts + dashboard magic link]
  F --> K[Schedule day-of reminder]
```

---

## Technology Stack

### Mandatory Stack

* Next.js (App Router) for website, dashboard, and server endpoints.  
* TypeScript for all application code.  
* Supabase for Postgres, Auth, and Storage.  
* Twilio for SMS.  
* Anthropic API for classification/extraction.  
* Stripe for billing.  
* Sentry for error \+ perf.

### Why This Stack

* One codebase can serve web UI and server endpoints.  
* Supabase provides a fast path to secure data access (RLS) and auth.  
* Twilio and Stripe are battle-tested for SMS and money.

---

## Integration Points And API Contracts

All integration points must be idempotent and support retries.

### Contract 1: Twilio → Inbound SMS Webhook

Endpoint: `POST /api/twilio/inbound`

Responsibilities

* Verify Twilio signature.  
* Normalize phone numbers to E.164.  
* Create a `message_inbound` record (encrypted body) and a `message_event` audit record.  
* Route to Conversation Engine.

Example payload (subset)

```json
{
  "From": "+14155551234",
  "To": "+14155559876",
  "Body": "Coffee tomorrow morning?",
  "MessageSid": "SMxxxxxxxx",
  "NumMedia": "0"
}
```

Response

* 200 with TwiML OR 200 empty (preferred: empty \+ send outbound via REST API), depending on your chosen pattern.

Idempotency key

* `twilio_message_sid` (MessageSid). If the same SID is seen again, do not double-apply state transitions.

### Contract 2: App → Twilio Outbound SMS

Interface (app-internal)

```ts
type SendSmsRequest = {
  toE164: string;
  body: string;
  correlationId: string; // trace id
  purpose:
    | "otp"
    | "interview"
    | "invite"
    | "lock"
    | "reminder"
    | "help"
    | "safety";
};

type SendSmsResult = {
  twilioMessageSid: string;
  status: "queued" | "sent" | "failed";
};
```

Policy

* Every outbound SMS must have a persisted `sms_outbound_job` row before sending.  
* Retrying must be safe: duplicates must not send if job already has a Twilio SID.

### Contract 3: Stripe → Webhooks

Endpoint: `POST /api/stripe/webhook`

Events (minimum)

* `checkout.session.completed`  
* `customer.subscription.created`  
* `customer.subscription.updated`  
* `customer.subscription.deleted`  
* `invoice.payment_failed`  
* `invoice.payment_succeeded`

Idempotency

* Use Stripe `event.id` as the idempotency key in `stripe_events` table.

Outputs

* Update `subscriptions` \+ `entitlements` tables.  
* Emit an `entitlement_changed` domain event.

### Contract 4: LLM Intent \+ Extraction

The Conversation Engine calls the LLM through a strict adapter.

Interface

```ts
type LlmClassifyIntentInput = {
  userId: string;
  messageText: string;
  recentMessages: Array<{ direction: "in" | "out"; text: string; at: string }>;
  activeState: {
    mode: "interview" | "idle" | "linkup_forming" | "awaiting_invite_reply";
    stateToken: string; // stable reference
  };
};

type IntentResult = {
  intent:
    | "INTERVIEW_ANSWER"
    | "LINKUP_REQUEST"
    | "INVITE_RESPONSE"
    | "PROFILE_UPDATE"
    | "HELP"
    | "STOP"
    | "START"
    | "CRISIS" // only when high confidence
    | "UNKNOWN";
  confidence: number; // 0..1
  extracted?: {
    // intent-specific extractions
    timeWindow?: "A" | "B" | "MORNING" | "DAY" | "EVENING";
    activityKey?: string;
    responseChoice?: "A" | "B" | "NO" | "IN" | "CANT";
    profileEdits?: Record<string, unknown>;
  };
  needsClarifier?: boolean;
  clarifierQuestion?: string; // max one
};
```

Hard rules

* STOP/START/HELP bypass LLM.  
* Safety keyword detection can bypass LLM.  
* If confidence \< threshold, ask at most one clarifier.

---

## Decision Trees

### Decision Tree: Message Handling

* If message matches STOP/START/HELP: handle immediately; do not call LLM.  
* Else if safety keyword hit: create safety incident, apply safety hold if required, send safe reply; do not call LLM.  
* Else load conversation state:  
  * If state is “awaiting\_invite\_reply”: try parse locally (A/B/No) before LLM.  
  * Else call LLM intent classifier.  
* If classifier confidence ≥ threshold: route to handler.  
* Else: ask one clarifier (choice-based). If user responds unexpectedly, treat it as the answer and proceed.

### Decision Tree: LinkUp Lock

* If initiator \+ at least 1 accepted before expiry: lock.  
* Else if expiry occurs and quorum not met: expire, notify initiator, record outcome for learning.  
* If lock occurs and later a participant cancels:  
  * If quorum remains: confirm plan still on.  
  * If quorum breaks: run exactly one replacement wave with a short deadline.  
  * If replacement fails: cancel, notify all.

---

## Examples

### Example: LinkUp Brief Object

```json
{
  "linkupBriefId": "lub_01H...",
  "initiatorUserId": "usr_01H...",
  "regionId": "r_seattle_capitol_hill",
  "activityKey": "coffee",
  "motiveEmphasis": { "connection": 0.7, "comfort": 0.6, "restorative": 0.4 },
  "timeWindow": "SAT_MORNING",
  "groupSize": { "min": 2, "max": 6 },
  "constraints": { "quiet": true, "outdoor_ok": true },
  "createdAt": "2026-02-02T18:00:00Z"
}
```

### Example: Invite SMS

* “Quick one: Want in on a coffee LinkUp Saturday morning? Reply A (9–11), B (11–1), or No.”

### Example: Locked Confirmation SMS

* “Locked. Coffee LinkUp is on: Saturday 10:00 AM at \[Venue\]. You can see who’s coming in your dashboard: \[Magic Link\]. Reply Can’t if you need to drop.”

---

## Key Decisions

1. Single ingestion pipeline for SMS, regardless of user state  
   * Choice: one inbound endpoint \+ state machine routing.  
   * Trade-off: slightly more complex router, much easier debugging and correctness.  
2. Idempotency-first domain transitions  
   * Choice: every external event has an idempotency key stored in DB.  
   * Trade-off: more tables and checks, dramatically fewer “double invite/double charge” disasters.  
3. Derived-signal-first privacy model  
   * Choice: persist structured signals long-term; encrypt raw message bodies with short retention.  
   * Trade-off: less raw context for support, better privacy posture and lower breach risk.  
4. Bounded clarifier rule (max one)  
   * Choice: no multi-turn interrogation to resolve ambiguity.  
   * Trade-off: occasional imperfect interpretation; better user momentum and trust.  
5. Modular monolith now, contracts ready for later split  
   * Choice: keep domains in one app, but enforce internal interfaces.  
   * Trade-off: less infra overhead now; still scalable later.

---

## Dependencies

* Document 2 (Domain Model and State Machines): must define canonical states referenced here.  
* Document 3 (Database Schema): must implement tables mentioned here.  
* Document 4 (Conversation Routing Contract): must finalize intent taxonomy \+ thresholds.  
* Document 11 (Entitlements): must define subscription states and enforcement.  
* Document 13 (Safety): must define safety holds and crisis flows.

---

## Risks And Mitigation

1. Webhook duplication causes double state changes  
   * Mitigation: idempotency keys \+ transactional state transitions.  
2. LLM misclassification causes wrong actions  
   * Mitigation: command precedence, safety short-circuits, confidence thresholds, bounded clarifier.  
3. Cross-environment leakage (staging texts real users)  
   * Mitigation: separate phone numbers, explicit environment banners/log tags, allowlist in staging.  
4. Data privacy concerns  
   * Mitigation: encryption at rest for raw SMS, short retention, RLS, audited admin access.

---

## Testing Approach

### Unit Tests

* Intent router: command precedence and safety short-circuits.  
* Idempotency guard functions.  
* LinkUp state transition functions.

### Integration Tests

* Inbound webhook → DB insert → handler → outbound SMS job creation.  
* Stripe webhook → entitlement update.  
* LinkUp formation: invite wave creation \+ accept handling \+ lock.

### E2E Scenarios

* New user: register → OTP → interview → paywall → LinkUp formed → lock → reminder → post-event exchange.  
* User in waitlisted region: register → waitlist state → region activated → entry message.  
* Failure paths: insufficient candidates → honest failure messaging.  
* Abuse paths: repeated cancels → cooldown.

---

## Production Readiness

### 1\) Infrastructure Setup

#### Vercel

* Project: `josh-staging` and `josh-prod`.  
* Framework: Next.js.  
* Build command: `pnpm build`.  
* Install command: `pnpm install`.  
* Output: default (Next.js).  
* Serverless functions: default Vercel runtime.  
* Domains:  
  * Staging: separate subdomain (example: `staging.<domain>`).  
  * Production: primary domain \+ www redirect.

Required environment variables (names)

* Supabase:  
  * `NEXT_PUBLIC_SUPABASE_URL`  
  * `NEXT_PUBLIC_SUPABASE_ANON_KEY`  
  * `SUPABASE_SERVICE_ROLE_KEY`  
* Twilio:  
  * `TWILIO_ACCOUNT_SID`  
  * `TWILIO_AUTH_TOKEN`  
  * `TWILIO_MESSAGING_SERVICE_SID` (or `TWILIO_FROM_NUMBER`)  
  * `TWILIO_WEBHOOK_SIGNING_SECRET` (if using custom verification)  
* Stripe:  
  * `STRIPE_SECRET_KEY`  
  * `STRIPE_WEBHOOK_SECRET`  
  * `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`  
* LLM:  
  * `ANTHROPIC_API_KEY`  
* Observability:  
  * `SENTRY_AUTH_TOKEN` (build-time, if needed)  
  * `NEXT_PUBLIC_SENTRY_DSN`  
  * `SENTRY_DSN` (server)

Environment parity rule: same variable names in staging and prod; values differ.

#### Supabase

* Create two projects: staging and prod.  
* Enable RLS by default.  
* Configure Auth:  
  * Email magic links for dashboard login.  
  * Optional: phone auth can be used, but SMS OTP is already handled via Twilio for onboarding.  
* Storage bucket for profile images.  
* Connection pooling:  
  * Use Supabase pooler for serverless environments.

#### External Services

* Twilio:  
  * Two phone numbers (staging, prod) or two Messaging Services.  
  * Each number points webhook to the correct Vercel environment.  
* Stripe:  
  * Separate webhook endpoints for staging/prod.  
  * Ensure event subscriptions include required events.

### 2\) Environment Parity

* Staging mirrors production flows end-to-end using:  
  * Its own DB.  
  * Its own Twilio number.  
  * Stripe test mode.  
* Differences:  
  * API keys.  
  * Domain names.  
  * Optional allowlist to prevent texting real users in staging.

### 3\) Deployment Procedure

#### Database

1. Apply migrations to staging:  
   * `npx supabase db push` (or `supabase db push`) with staging credentials.  
2. Verify RLS policies are enabled.  
3. Run seed data scripts (regions, activities, etc.).

#### Web

1. Merge to main.  
2. Vercel deploys automatically (recommended).  
3. Confirm environment variables are present.

#### Twilio & Stripe Wiring

1. Update Twilio inbound webhook URL to `/api/twilio/inbound` for each environment.  
2. Update Stripe webhook URL to `/api/stripe/webhook` for each environment.

### 4\) Wiring Verification

#### Smoke Tests (Staging)

* Send SMS “help” → ensure help response.  
* Send SMS “stop” → ensure opt-out recorded and no further messages.  
* Register a test user → OTP verifies.  
* Complete 2–3 interview prompts → signals persist.  
* Trigger a LinkUp request → receives bounded clarifier if needed.  
* Accept invite → LinkUp locks when quorum met.  
* Stripe test checkout → entitlement flips within expected window.

#### Production Smoke Tests

* Same as staging, using internal test numbers.  
* Verify no staging users are being texted.

### 5\) Operational Readiness

* Every inbound message gets a `correlationId` that is propagated:  
  * inbound webhook → domain handlers → outbound SMS job → logs \+ Sentry.  
* Minimum alerting:  
  * inbound webhook 5xx rate.  
  * Stripe webhook failures.  
  * Twilio send failures.  
  * Spike in safety keyword hits.  
* Minimum dashboards:  
  * registration → interview completion funnel.  
  * LinkUp lock rate.  
  * invite accept rate.  
  * SMS delivery statuses.

---

## Implementation Checklist

1. Create Next.js app scaffold with `/api/twilio/inbound` and `/api/stripe/webhook` endpoints.  
2. Implement correlation ID \+ structured logger used everywhere.  
3. Implement Twilio signature verification and payload normalization.  
4. Implement command precedence (STOP/START/HELP) and safety keyword short-circuit.  
5. Implement Conversation Engine router and handler registry.  
6. Implement outbound SMS job table \+ send worker function.  
7. Implement Stripe webhook ingestion \+ idempotent entitlement updates.  
8. Add basic user dashboard scaffolding and magic link auth.  
9. Add LinkUp Coordinator scaffolding and end-to-end happy path.  
10. Add Sentry integration and baseline alerts.