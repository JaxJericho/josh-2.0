# Eligibility And Entitlements Enforcement (JOSH 2.0)

## *Document \#11*

## Summary

This document defines how JOSH 2.0 enforces who can initiate and participate in matching and LinkUps based on subscription state, entitlements, region gating, and safety controls. The system must remain correct under Stripe webhook lag, retries, and partial failures. Enforcement points are explicitly enumerated so no feature silently bypasses eligibility.

The enforcement model is “deny by default”: product actions require an entitlement that is computed from canonical billing events plus controlled admin overrides. Entitlements are derived into a fast, queryable table and validated at every critical boundary: website registration, SMS entry, matching runs, LinkUp orchestration, contact exchange, and admin actions.

## Goals

* Enforce product access consistently across SMS and dashboard.  
* Handle Stripe webhook lag and out-of-order delivery safely.  
* Provide clear audit trails for entitlement decisions.  
* Support region gating and pre-launch onboarding behavior.  
* Allow limited, explicit admin overrides.

## Non-Goals

* Pricing strategy, product packaging, or plan design.  
* Customer support workflows (covered by Doc 14).  
* Fraud detection beyond basic safeguards (deferred).

## Key Decisions And Trade-Offs

* Derived entitlements table: simplifies reads at runtime; requires robust reconciliation.  
* Webhook-first source of truth: avoids relying on client claims; introduces lag that must be mitigated.  
* Grace periods: reduce user frustration; require careful limits and logging.  
* Strict enforcement at boundaries: increases implementation work, reduces risk of bypass.

## Definitions

* Subscription State: Stripe subscription lifecycle state (active, past\_due, canceled, etc.).  
* Entitlement: A boolean or quota that grants specific product capabilities.  
* Eligibility: The combined result of entitlements \+ region \+ safety \+ account status.  
* Webhook Lag: The time between a Stripe event and JOSH receiving/processing it.

## Entitlement Model

### Canonical Entitlements

Define the minimum set as explicit flags/quotas.

MVP recommended entitlements:

* `can_receive_intro` (boolean)  
* `can_initiate_linkup` (boolean)  
* `can_participate_linkup` (boolean)  
* `intro_credits_remaining` (integer)  
* `linkup_credits_remaining` (integer)

If your business model uses only one credit type, keep the schema but set the unused counters to 0\.

### Eligibility Gates

Eligibility is computed as:

* `account_ok` (phone verified, not suspended)  
* `region_ok` (in open region, or allowed pre-launch flow)  
* `safety_ok` (not on hold that blocks participation)  
* `entitlement_ok` (required entitlement for action)

If any gate fails, deny and respond with an appropriate message.

## Data Model

This doc assumes Doc 03 includes billing/webhook ingestion tables. If not, add these minimal tables.

### Table: `billing_events`

An append-only log of Stripe events.

* `id` uuid  
* `stripe_event_id` text unique  
* `event_type` text  
* `payload` jsonb  
* `received_at` timestamptz  
* `processed_at` timestamptz nullable  
* `status` enum: `received | processed | failed`  
* `error_detail` text nullable

### Table: `subscriptions`

Canonical subscription snapshot per user.

* `user_id` uuid primary key  
* `stripe_customer_id` text  
* `stripe_subscription_id` text nullable  
* `status` enum (mapped from Stripe)  
* `current_period_end` timestamptz nullable  
* `cancel_at_period_end` boolean  
* `updated_at` timestamptz

### Table: `entitlements`

Derived entitlements snapshot per user.

* `user_id` uuid primary key  
* `can_receive_intro` boolean  
* `can_initiate_linkup` boolean  
* `can_participate_linkup` boolean  
* `intro_credits_remaining` int  
* `linkup_credits_remaining` int  
* `source` enum: `stripe | admin_override | reconciled`  
* `computed_at` timestamptz  
* `version` int

### Table: `entitlement_ledger` (Recommended)

Tracks consumptions and grants with idempotency.

* `id` uuid  
* `user_id`  
* `entitlement_type` text  
* `delta` int  
* `reason` text  
* `subject_type` text nullable  
* `subject_id` uuid nullable  
* `idempotency_key` text unique  
* `created_at` timestamptz

This enables atomic consumption without relying solely on Stripe timing.

### Table: `admin_overrides`

* `id` uuid  
* `user_id`  
* `override_type` text  
* `value` jsonb  
* `active` boolean  
* `created_by_admin_id`  
* `created_at`  
* `expires_at` nullable  
* `reason` text

## Stripe Integration Contract

### Source Of Truth

* Stripe webhooks are the canonical source for subscription status and plan.  
* The client (website/dashboard) must never be trusted for entitlement claims.

### Webhook Handling Requirements

* Verify signatures.  
* Idempotency on `stripe_event_id`.  
* Process events in any order safely.

### Mapping Stripe Events

Minimum events to handle:

* `checkout.session.completed` (initial purchase)  
* `customer.subscription.created`  
* `customer.subscription.updated`  
* `customer.subscription.deleted`  
* `invoice.payment_succeeded`  
* `invoice.payment_failed`

You may not need all events depending on your plan model, but your handler must be resilient.

### Webhook Lag Mitigation

Because users may purchase and immediately try to use features, implement a short “pending activation” grace:

* If the user has a recent `checkout.session.completed` recorded (or a known Stripe customer id) but entitlements not yet computed, allow a limited action set for a short window.

Recommended grace window:

* `GRACE_PENDING_MINUTES = 15`

This grace must:

* Be logged (`eligibility_grace_used`).  
* Be bounded to prevent abuse.  
* Not override safety.

## Entitlement Computation

### Computation Strategy

Entitlements are computed from:

1. Subscription snapshot (`subscriptions`)  
2. Entitlement ledger (grants/consumptions)  
3. Admin overrides

Priority:

* Safety holds always override entitlements (deny participation).  
* Admin overrides can grant or revoke entitlements but must be auditable.

### Reconciliation Job

A periodic job recomputes entitlements for all users or those with recent billing events.

* Run frequency: every 5–15 minutes in production (tunable)  
* Also run on-demand after webhook processing

Idempotency:

* `reconcile:{user_id}:{billing_event_id}`

### Atomic Consumption

Whenever a feature consumes a credit:

* Write an `entitlement_ledger` row with an idempotency key.  
* Update `entitlements` in the same transaction.

Consumption points:

* 1:1 intro creation (or preview acceptance) depending on product design  
* LinkUp initiation

Doc 02’s state machines should define exactly where consumption happens; enforce it here.

## Enforcement Points

The following boundaries MUST call a single eligibility evaluation function.

### 1\) Website Registration

* Allow registration regardless of subscription.  
* Enforce region gating:  
  * Open region: proceed to onboarding  
  * Closed region: waitlist \+ pre-launch onboarding as policy allows

Do not require subscription to register.

### 2\) SMS Entry And Router (Twilio Inbound)

* STOP/HELP precedence.  
* If user attempts a premium-only action (e.g., “start a LinkUp”), check:  
  * `can_initiate_linkup`

If denied:

* Respond with a clear message and a dashboard link to upgrade.

### 3\) Matching Job (1:1)

Before producing a match for a user, require:

* `can_receive_intro = true`  
* `intro_credits_remaining > 0` (if credits model)

If denied:

* Do not create preview.  
* Optionally queue a “you’re paused” message.

### 4\) LinkUp Orchestration

At LinkUp creation:

* Require `can_initiate_linkup = true` and credits if applicable.

At candidate invitation:

* For each invitee require `can_participate_linkup = true`.

If a candidate is ineligible:

* Exclude from pool and log.

### 5\) Contact Exchange (Doc 08\)

To allow contact exchange:

* Require `can_participate_linkup = true`.

If the user loses entitlements after event time:

* Allow exchange only if both users were eligible at lock time, OR deny strictly.

MVP recommendation: allow exchange if eligible at lock time, but log and suppress if safety changes.

### 6\) Dashboard Actions

Every protected UI action must call the eligibility endpoint:

* start LinkUp  
* opt into LinkUp  
* request another intro  
* view premium-only analytics

### 7\) Admin Actions

Admin can:

* apply override  
* consume/grant credits  
* suspend user

Every action writes to `admin_audit_log`.

## Eligibility Evaluation Contract

Implement a single function:

`evaluateEligibility(user_id, action, context) -> {allowed, reason_code, user_message, debug}`

Where:

* `action` is an enum: `receive_intro | initiate_linkup | participate_linkup | contact_exchange | admin_override`  
* `context` includes `region_id`, `linkup_id`, timestamps

Reason codes (examples):

* `INELIGIBLE_REGION`  
* `INELIGIBLE_SUBSCRIPTION`  
* `INELIGIBLE_CREDITS`  
* `INELIGIBLE_SAFETY_HOLD`  
* `INELIGIBLE_ACCOUNT_STATUS`  
* `INELIGIBLE_WEBHOOK_PENDING`

The function must return a safe user message and a debug payload for logs.

## Decision Trees

### Decision Tree: Premium Action Via SMS

1. Is user known and verified?  
   * No → prompt registration/OTP.  
2. Is user on safety hold?  
   * Yes → deny with safety message.  
3. Evaluate entitlements for action.  
   * Allowed → proceed.  
   * Denied → if webhook pending and within grace → allow limited, log.  
   * Else deny with upgrade guidance.

### Decision Tree: Webhook Pending Grace

1. Did we receive `checkout.session.completed` within last 15 minutes?  
   * No → deny normally.  
2. Is `subscriptions.status` still unknown?  
   * Yes → allow only the minimal action set (e.g., viewing status, starting onboarding).  
3. Are we trying to consume credits?  
   * If yes, do not consume until entitlements computed.

## Idempotency And Retry Safety

* Webhook handler idempotent by `stripe_event_id`.  
* Entitlement ledger idempotent by `idempotency_key`.  
* Consumption idempotency keys include the domain object:  
  * `consume:intro:{preview_id}:{user_id}`  
  * `consume:linkup:{linkup_id}:{user_id}`

If the same event is processed twice, no double-consumption occurs.

## Edge Cases

* Out-of-order Stripe events:  
  * Subscription deleted then updated: snapshot must reflect latest `created` time or Stripe-provided `latest_invoice` state.  
  * Always rely on Stripe object’s `status` and timestamps.  
* Payment failure:  
  * If `past_due`, you may allow a short grace period but must record it.  
  * If `canceled`, revoke entitlements after period end.  
* Refunds / chargebacks:  
  * Treat as immediate revocation (policy-dependent). Ensure audit.  
* Admin override conflicts:  
  * Overrides should have explicit precedence and expiry.  
* Region closure after user active:  
  * Region gating affects new initiations, not necessarily ongoing LinkUps.

## Testing Plan

### Unit Tests

* Stripe event mapping to subscription snapshot.  
* Eligibility evaluation returns correct reason codes.  
* Grace logic bounded.  
* Credit consumption idempotency.

### Integration Tests

* Webhook ingestion idempotency.  
* Reconciliation job recomputes entitlements correctly.  
* Concurrent consumption attempts result in a single ledger entry.

### End-To-End Tests

1. Purchase subscription, immediately attempt LinkUp initiation.  
2. Verify webhook lag grace behavior.  
3. Verify entitlements become active after webhook processing.  
4. Consume a credit once, verify not consumed twice under retries.  
5. Cancel subscription and verify entitlements revoke at correct time.

## Production Readiness

### Observability

Emit:

* `billing_event_received/processed/failed`  
* `entitlements_computed`  
* `eligibility_denied` with reason code  
* `eligibility_grace_used`  
* `entitlement_consumed`

All with `correlation_id`, `user_id` (logs), `stripe_event_id` when relevant.

### Operational Runbook

* If users report “I paid but I’m blocked,” check:  
  * billing\_events status  
  * subscriptions snapshot  
  * entitlements row  
  * grace window logs

### Wiring Verification

In staging:

* Run a checkout flow.  
* Confirm webhook received and processed.  
* Confirm entitlements computed.  
* Trigger a premium action via SMS and dashboard.  
* Confirm denials and allowances match expected.

## Implementation Checklist

* Implement Stripe webhook handler with signature validation and idempotency.  
* Implement subscription snapshot updater.  
* Implement entitlements reconciliation job.  
* Implement entitlement ledger and atomic consumption.  
* Implement `evaluateEligibility` function and enforce it at all boundaries.  
* Add admin override mechanism with audit.  
* Add observability and alerts.