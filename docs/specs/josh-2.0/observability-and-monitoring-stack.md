# Observability And Monitoring Stack (JOSH 2.0)

## *Document \#5*

## Summary

This document defines how JOSH 2.0 is observed in production: what gets logged, how errors are captured, what metrics matter, and how operators diagnose issues when real users and real money are involved. Without strong observability, you will not be able to confidently debug missing invites, duplicate messages, stuck LinkUps, payment gating issues, or safety incidents.

Observability here is not just “nice dashboards.” It is an operational contract: every inbound SMS, every Stripe webhook, every LinkUp lock attempt, and every safety escalation emits consistent logs, trace IDs, and domain events. This lets you answer questions quickly: “What happened to Dorien’s LinkUp?” “Why did a user get paywalled after payment?” “Did Twilio retry, or did we double-send?”

This spec includes: Sentry categories and severity, structured logging schema, metrics, dashboards, alert thresholds, cost tracking, request replay capability, and a production debugging playbook.

---

## Scope, Out Of Scope, Deferred

### In Scope

* Sentry configuration for Next.js (client \+ server).  
* Structured logging schema and log destinations.  
* Metrics definitions (counters/histograms/gauges).  
* Dashboard requirements and example queries.  
* Alerting thresholds and escalation procedures.  
* Cost tracking for Twilio, Stripe, Supabase, and LLM calls.  
* Request correlation and replay guidance.

### Out Of Scope

* Full SIEM integration.  
* Detailed data warehouse / BI tooling.

### Deferred

* Dedicated tracing system (OpenTelemetry exporter \+ collector \+ Jaeger).  
* Automated anomaly detection and forecasting.

---

## Key Decisions

1. Correlation IDs are mandatory across all operations  
   * Every inbound SMS and webhook begins a correlation ID.  
   * That ID is propagated to all logs, domain events, and outbound jobs.  
2. Domain events are the “audit spine”  
   * Critical state transitions write a domain event row.  
   * This is the simplest reliable way to reconstruct what happened.  
3. Sentry is for exceptions and high-signal alerts, not everything  
   * Avoid flooding Sentry with non-errors.  
4. Structured logs are the primary debugging tool  
   * Logs must be machine-readable and consistent.  
5. Metrics must map to product health, not just infrastructure  
   * LinkUp lock rate and invite accept rate matter more than CPU.

---

## Correlation, Trace, And Replay

### Correlation ID

* `correlation_id` is generated at the start of:  
  * Twilio inbound webhook  
  * Stripe webhook  
  * Admin actions  
  * Scheduled reminder runs

Propagation requirements:

* Include `correlation_id` in:  
  * DB inserts: `sms_messages`, `sms_outbound_jobs`, `domain_events`, `stripe_events`, `profile_events`, `linkups`  
  * Log lines  
  * Sentry breadcrumbs and tags

### Request / Event Replay (Practical)

You cannot replay Twilio webhooks directly from Twilio in many cases, but you can:

* Store normalized event payloads in `message_events` (metadata, not raw text)  
* Store Stripe event payload in `stripe_events`  
* Provide an internal admin tool to “re-run handler” for:  
  * failed outbound SMS jobs  
  * stuck LinkUp broadcasting

Rules:

* Replay must be idempotent.  
* Replay must require admin role `engineering`.  
* Replay must log an admin audit entry.

---

## Sentry Configuration

### What To Capture

* Unhandled exceptions in API routes / server actions.  
* Timeouts and network failures to Twilio, Stripe, Supabase, Anthropic.  
* LLM invalid JSON responses.  
* Database constraint violations that indicate logic bugs.

### Severity Levels

* `fatal`: user-impacting outage, cannot process inbound SMS or Stripe webhooks.  
* `error`: failed to send invites, failed to lock LinkUp, failed to update entitlements.  
* `warning`: validation failures, signature verification failures, LLM retry recoveries.  
* `info`: only for rare operational breadcrumbs (avoid spam).

### Sentry Event Categories

Tag every event with:

* `category` (one of):  
  * `sms_inbound`  
  * `sms_outbound`  
  * `stripe_webhook`  
  * `llm_intent`  
  * `llm_extraction`  
  * `linkup_orchestration`  
  * `matching_scoring`  
  * `dashboard_auth`  
  * `safety_escalation`  
  * `admin_action`  
  * `db_schema`

Also tag:

* `env`: `local | staging | prod`  
* `correlation_id`  
* `user_id` (if known)  
* `linkup_id` (if relevant)  
* `invite_id` (if relevant)  
* `stripe_event_id` (if relevant)  
* `twilio_message_sid` (if relevant)

### PII Rules (Sentry)

* Never send raw SMS body to Sentry.  
* Never send full phone numbers.  
* Allowed identifiers:  
  * `user_id`  
  * `phone_hash`  
  * last 2 digits of phone number only if needed for UX debugging

### Performance Monitoring

Enable Sentry performance traces for:

* `/api/twilio/inbound`  
* `/api/stripe/webhook`  
* LinkUp formation handler route

Record spans:

* DB query time  
* LLM call time  
* Twilio send time

Sampling:

* 100% on staging  
* 10–25% on production (adjust as needed)

---

## Structured Logging

### Log Destination

* Vercel logs are the baseline.  
* Add an external log sink for production (recommended):  
  * Datadog, Grafana Loki, or similar.

### Log Format

Every log entry is JSON.

Required keys:

* `ts` (ISO timestamp)  
* `level` (`debug|info|warn|error`)  
* `event` (short stable name)  
* `env`  
* `correlation_id`

Optional but strongly recommended:

* `user_id`  
* `phone_hash`  
* `linkup_id`  
* `invite_id`  
* `stripe_event_id`  
* `twilio_message_sid`  
* `handler`  
* `duration_ms`  
* `attempt`  
* `error_code`  
* `error_message`

### Canonical Log Events

Inbound SMS:

* `sms.inbound.received`  
* `sms.inbound.duplicate_sid`  
* `sms.inbound.signature_invalid`  
* `sms.inbound.routed`

Outbound SMS:

* `sms.outbound.job_created`  
* `sms.outbound.send_attempt`  
* `sms.outbound.sent`  
* `sms.outbound.failed`

LLM:

* `llm.intent.request`  
* `llm.intent.response`  
* `llm.intent.invalid_json`  
* `llm.intent.fallback_clarifier`

LinkUp:

* `linkup.created`  
* `linkup.broadcasting_started`  
* `linkup.invite_wave_sent`  
* `linkup.lock_attempt`  
* `linkup.locked`  
* `linkup.expired`  
* `linkup.canceled`

Billing:

* `stripe.webhook.received`  
* `stripe.webhook.duplicate_event`  
* `entitlement.updated`

Safety:

* `safety.keyword_hit`  
* `safety.incident_created`  
* `safety.hold_applied`

Admin:

* `admin.action`  
* `admin.replay_triggered`

---

## Metrics

Metrics should be emitted via a small metrics adapter.

### Counters

* `sms_inbound_total{env}`  
* `sms_inbound_duplicates_total{env}`  
* `sms_outbound_sent_total{env,purpose}`  
* `sms_outbound_failed_total{env,purpose,reason}`  
* `llm_intent_calls_total{env}`  
* `llm_intent_failures_total{env,reason}`  
* `clarifiers_asked_total{env,intent}`  
* `linkups_created_total{env,region}`  
* `linkups_locked_total{env,region}`  
* `linkups_expired_total{env,region}`  
* `linkups_canceled_total{env,region,reason}`  
* `invites_sent_total{env,region}`  
* `invites_accepted_total{env,region}`  
* `invites_declined_total{env,region}`  
* `invites_expired_total{env,region}`  
* `stripe_webhooks_total{env,type}`  
* `stripe_webhook_failures_total{env,type}`  
* `safety_incidents_total{env,category,severity}`

### Histograms

* `api_latency_ms{env,route}`  
* `db_query_ms{env,query_name}`  
* `llm_latency_ms{env,model}`  
* `twilio_send_latency_ms{env}`  
* `time_to_lock_minutes{env,region}`  
* `time_to_first_reply_minutes{env}`

### Gauges

* `broadcasting_linkups_active{env,region}`  
* `pending_outbound_jobs{env}`  
* `pending_admin_safety_queue{env}`

---

## Dashboards (Minimum)

### Product Health

* Registration funnel:  
  * registrations → OTP verified → interview started → interview complete  
* LinkUp funnel:  
  * LinkUps created → invites sent → accept rate → lock rate → completed  
* Engagement:  
  * inbound SMS per user per week  
  * repeat attendance

### Reliability

* Inbound webhook 5xx rate (Twilio)  
* Outbound failures rate (Twilio)  
* Stripe webhook failures rate  
* LLM failure / invalid JSON rate  
* DB error rate and latency

### Safety

* incidents by category and severity  
* holds applied per day  
* reports and resolution time

### Cost

* Twilio messages sent per day \* unit cost estimate  
* LLM calls per day \* estimated cost  
* Supabase DB usage metrics (connections, query time)

---

## Alerting And Escalation

### Alert Thresholds (Initial)

These should be tuned after production data exists.

Critical (page):

* Twilio inbound endpoint 5xx \> 2% over 5 minutes  
* Stripe webhook endpoint 5xx \> 1% over 5 minutes  
* Outbound send failures \> 5% over 15 minutes

High (notify):

* LLM invalid JSON \> 1% of calls over 30 minutes  
* LinkUp lock rate drops \> 30% week-over-week (notify only)  
* Safety incidents spike \> 3x baseline

Medium (daily digest):

* Clarifier rate \> 20% of inbound messages  
* Invite accept rate drops below target

### Escalation Procedure

1. Confirm if it is environment-specific (staging vs prod).  
2. Check Vercel logs by correlation\_id.  
3. Check `domain_events` for affected entity.  
4. Check Twilio/Stripe dashboards for external failures.  
5. Roll back if recent deploy caused spike.

---

## Debugging Playbook

### Common Incident: “User Didn’t Get A Reply”

1. Find inbound message by `twilio_message_sid` in `sms_messages`.  
2. Confirm `correlation_id`.  
3. Check logs `sms.inbound.routed`.  
4. Confirm handler executed and created `sms_outbound_job`.  
5. If job exists, check its status and Twilio SID.  
6. If no job, check for:  
   * STOP state  
   * safety hold  
   * unknown user state  
   * LLM failure fallback

### Common Incident: “Duplicate Invite Sent”

1. Find invite record by `linkup_id` \+ user.  
2. Check `sms_outbound_jobs` for multiple sends with same idempotency key.  
3. Ensure idempotency constraint working.  
4. Check if messaging service duplicated (Twilio) vs app bug.

### Common Incident: “User Paid But Still Paywalled”

1. Check Stripe webhook received.  
2. Verify `stripe_events` processed.  
3. Check `subscriptions` and `entitlements` row.  
4. If webhook delayed:  
   * verify checkout session completion handler did optimistic unlock

### Common Incident: “LinkUp Stuck Broadcasting”

1. Check `linkups` state and acceptance window.  
2. Check invites created.  
3. Check invite wave sends.  
4. Check accept count.  
5. If window elapsed, ensure expiry job ran.

---

## Dependencies

* Document 1: service boundaries.  
* Document 3: schema tables for logs/events.  
* Document 7: LinkUp reminders and job scheduling.  
* Document 11: entitlements enforcement events.

---

## Risks And Mitigation

1. Flooding Sentry with noisy events  
   * Mitigation: use logs for high-volume, Sentry for high-signal.  
2. Logging sensitive content  
   * Mitigation: never log raw SMS bodies; only hashes and IDs.  
3. Missing cost visibility until too late  
   * Mitigation: track daily volume and estimate costs; set budgets.  
4. No replay tools in emergencies  
   * Mitigation: build minimal admin replay for outbound job resend and stuck LinkUp recovery.

---

## Testing Approach

### Unit Tests

* logger includes mandatory fields.  
* correlation ID propagation.  
* redaction rules (no phone numbers, no raw bodies).

### Integration Tests

* Sentry captures handler exceptions with tags.  
* metrics counters increment on key operations.

### E2E Scenarios

* Induce LLM timeout → verify fallback clarifier and logs.  
* Induce Twilio send failure → verify retries and alerts.

---

## Production Readiness

### 1\) Infrastructure Setup

#### Vercel

* Ensure runtime has access to:  
  * `NEXT_PUBLIC_SENTRY_DSN`  
  * `SENTRY_DSN` (server)  
  * any required Sentry auth token for source maps

#### Supabase

* Ensure `domain_events`, `message_events`, `stripe_events` exist.  
* Ensure indexes on `correlation_id` fields.

#### External

* Twilio status callback (optional): configure status callbacks to an endpoint to update `sms_messages.status`.

### 2\) Environment Parity

* Staging captures 100% traces and logs.  
* Production sampling tuned to budget.

### 3\) Deployment Procedure

1. Deploy logging \+ Sentry in staging.  
2. Validate PII redaction.  
3. Turn on production with conservative sampling.

### 4\) Wiring Verification

* Send SMS in staging and confirm:  
  * logs contain correlation\_id  
  * Sentry breadcrumbs include handler  
  * outbound job metrics increment  
* Send Stripe test webhook and confirm:  
  * stripe\_events row created  
  * entitlement updated

### 5\) Operational Readiness

Minimum operational kit:

* A dashboard with:  
  * inbound volume  
  * outbound failures  
  * LinkUp lock rate  
  * Stripe webhook failures  
* Alerting configured for critical thresholds.  
* A documented on-call procedure (this playbook).

---

## Implementation Checklist

1. Implement correlation ID generator and propagation.  
2. Implement JSON structured logger.  
3. Add Sentry Next.js SDK (server \+ client).  
4. Add redaction utilities for PII.  
5. Implement metrics adapter and emit counters/histograms.  
6. Create dashboards for product health \+ reliability \+ safety \+ cost.  
7. Configure alert rules and escalation.  
8. Build minimal admin replay tools (engineering role).  
9. Add integration tests for exception capture and redaction.

