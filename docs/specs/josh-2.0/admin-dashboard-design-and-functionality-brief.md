# Admin Dashboard Design And Functionality Brief (JOSH 2.0)

## *Document \#14*

## Summary

This document specifies the admin dashboard for JOSH 2.0: the operational tooling needed to run an SMS-first friendship matching service safely and reliably. The admin dashboard supports core workflows across user support, LinkUp operations, matching visibility, billing/entitlements, safety triage, and observability.

The dashboard must be production-grade: permissioned access, audit logs for every sensitive action, high signal-to-noise views, and resilience when data is missing or delayed. It is not a “nice-to-have” UI; it is critical infrastructure for shipping and operating JOSH.

## Goals

* Provide admin operators with the tools to:  
  * triage safety incidents  
  * diagnose messaging failures  
  * manage LinkUps and invites  
  * resolve user support issues  
  * manage entitlements and overrides  
  * monitor system health and costs  
* Enforce role-based access control (RBAC) and audit every admin mutation.  
* Provide deterministic, explainable views into matching decisions.  
* Be resilient and usable with partial or missing data.

## Non-Goals

* A full CRM system.  
* Complex BI/reporting dashboards beyond essential metrics.  
* Internal developer tooling that belongs in logs/CLI (though links out are allowed).

## Key Decisions And Trade-Offs

* Focus on operational workflows over analytics polish.  
* Build with “read-first” posture: most pages are read-only with a small set of guarded mutations.  
* Prefer server-rendered/admin API queries with explicit pagination and caching.  
* Store all admin actions in an immutable audit log.

## Personas And Roles

### Roles

* Support Admin: view users, messages, LinkUps; limited actions.  
* Safety Admin: access incident queues, holds, reports, blocks.  
* Billing Admin: entitlements, overrides, Stripe reconciliation.  
* Super Admin: all permissions, including region open/pause and destructive actions.

### RBAC Requirements

* Every route checks role.  
* Every mutation checks role and records audit.

## Navigation And Information Architecture

Recommended primary nav sections:

1. Overview  
2. Users  
3. LinkUps  
4. Matching  
5. Messaging  
6. Safety  
7. Billing  
8. Regions  
9. System Logs / Audit  
10. Settings

## Core Pages And Requirements

### 1\) Overview (Ops Home)

Purpose: high-level operational health.

Widgets:

* inbound SMS volume (24h)  
* outbound send success rate  
* active LinkUps today/this week  
* match run success rate  
* safety incidents open (by severity)  
* billing webhook failures

Actions:

* quick links to incident queue and failed jobs

### 2\) Users

#### User List

* search by phone hash, name, user\_id, email (if collected)  
* filters: region, status, holds, subscription state  
* pagination

#### User Detail

Tabs:

* Profile summary  
  * onboarding completeness  
  * key preference signals (safe display)  
* Activity / history  
  * LinkUps participated  
  * 1:1 previews history  
* Messaging  
  * recent inbound/outbound (redacted)  
  * delivery status timeline  
* Safety  
  * incidents involving user  
  * holds and strikes  
  * blocks/reports summary  
* Billing  
  * subscription state  
  * entitlements snapshot  
  * ledger entries

Admin actions (guarded):

* apply/lift hold  
* apply entitlement override  
* resend a specific system message (limited)  
* region change (with constraints)  
* suspend user

All actions require reason text and are audited.

### 3\) LinkUps

#### LinkUp List

* filters: state, region, date, activity type  
* show: size, event time, quorum, lock status

#### LinkUp Detail

* LinkUp Brief  
* participant list with statuses  
* invite waves timeline  
* reminders sent  
* post-event outcomes completion  
* contact exchanges created (counts only; details permissioned)

Actions:

* cancel LinkUp  
* extend expiration  
* trigger next invite wave (manual override)  
* replace a participant (rare, high privilege)

### 4\) Matching

Purpose: visibility and debugging.

#### Match Runs

* list match runs (mode, region, status)  
* show pool size, relaxation level, weights version

#### Subject User Match View

* show top candidates with scores and explainability  
* show hard-filter rejections summary (counts)  
* show why a specific candidate was excluded

Actions:

* trigger match run (admin-only)  
* rerun with a different relaxation level (for testing)

Constraints:

* Never allow admin to force-match two users in MVP.

### 5\) Messaging

Purpose: monitor Twilio health and outbound queues.

Views:

* inbound messages (redacted; show metadata and message ids)  
* outbound jobs queue (pending/failed/sent)  
* per-user message timeline  
* Twilio status callbacks (if captured)

Actions:

* retry failed outbound job  
* cancel outbound job

Guardrails:

* retries should respect idempotency keys  
* rate limit admin-triggered retries

### 6\) Safety

Purpose: triage and enforcement.

#### Incident Queue

* filters by severity, category, status  
* quick actions: apply hold, assign, resolve

#### Incident Detail

* incident metadata  
* related user history  
* related LinkUp/match  
* resolution notes

#### Holds

* list active holds  
* expiration tracking

#### Reports And Blocks

* aggregate counts  
* drilldown permitted only for safety roles

### 7\) Billing

Purpose: reconcile Stripe and entitlements.

Views:

* billing events (received/processed/failed)  
* subscription snapshots  
* entitlements snapshot  
* ledger entries

Actions:

* reprocess a billing event  
* run entitlements reconciliation  
* apply override (with expiry)

### 8\) Regions

Purpose: region gating operations.

Views:

* region list with status  
* waitlist counts  
* density metrics

Actions:

* set region status (closed/opening/open/paused)  
* trigger region activation workflow  
* send launch notification batch (idempotent)

### 9\) System Logs / Audit

#### Admin Audit Log

* immutable list of all admin actions  
* filter by admin, user, action type, date

#### Domain Events (Optional)

* show domain event stream entries

### 10\) Settings

* keyword lists version  
* feature flags  
* messaging templates version  
* rate limits

## Design Requirements

### General UI

* fast search everywhere  
* pagination for all lists  
* filters persist in URL  
* optimistic UI avoided for critical mutations (prefer confirmed writes)  
* show loading/error states for all panels

### Data Safety

* redact message content by default  
* show only last 50 messages, paginated  
* never display raw phone numbers unless role permits

### Action Confirmations

* destructive actions require typed confirmation and reason  
* show preview of affected entities

## API Contracts

Admin dashboard must use explicit admin APIs (not public APIs).

### Auth

* admin auth separate from user auth or user role claims  
* require MFA if possible (future)

### Endpoints (Representative)

* `GET /admin/users?query=&filters=`  
* `GET /admin/users/{id}`  
* `POST /admin/users/{id}/holds`  
* `POST /admin/users/{id}/entitlements/override`  
* `GET /admin/linkups` / `GET /admin/linkups/{id}`  
* `POST /admin/linkups/{id}/cancel`  
* `GET /admin/match-runs` / `POST /admin/match-runs/trigger`  
* `GET /admin/messages/outbound-jobs`  
* `POST /admin/outbound-jobs/{id}/retry`  
* `GET /admin/safety/incidents` / `POST /admin/safety/incidents/{id}/resolve`  
* `GET /admin/billing/events` / `POST /admin/billing/events/{id}/reprocess`  
* `GET /admin/regions` / `POST /admin/regions/{id}/status`

All POST endpoints must:

* validate role  
* require reason  
* write audit log

## Audit Logging

Every admin mutation writes:

* admin\_id  
* action type  
* target entity  
* before/after snapshot (bounded)  
* reason  
* correlation\_id

Audit log is append-only.

## Error Handling And Resilience

* If data is missing, show empty state with hint.  
* Do not crash pages if APIs return 404/empty.  
* Ensure all pages function without real production data.

## Testing Plan

### Unit Tests

* RBAC guards  
* audit log write on mutations  
* input validation

### Integration Tests

* end-to-end admin flows for:  
  * apply hold  
  * retry outbound job  
  * reprocess billing event  
  * open region

### Manual Smoke Tests

* login as each role and verify nav and permissions  
* verify audit log entries  
* verify error states

## Production Readiness

* Admin dashboard deployed with environment separation (staging/prod).  
* Separate admin base URL or path.  
* Logging and Sentry tags include admin context.

## Implementation Checklist

* Implement RBAC roles and route guards.  
* Build admin APIs with strict validation.  
* Build user list and user detail pages.  
* Build LinkUp list/detail pages.  
* Build safety queue and incident detail.  
* Build billing reconciliation pages.  
* Build regions ops pages.  
* Implement outbound jobs monitoring and retry.  
* Add audit log and admin activity tracking.  
* Add smoke test checklist.