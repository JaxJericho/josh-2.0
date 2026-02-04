# Safety And Abuse Prevention Playbook (JOSH 2.0)

## *Document \#13*

## Summary

This document defines JOSH 2.0’s safety and abuse prevention system: detection, user-facing controls, escalation ladders, holds, admin review workflows, and enforcement hooks across SMS and dashboard. The goal is to prevent harm, respond quickly to risk, and ensure the platform remains operationally safe at launch.

Safety in JOSH 2.0 is implemented as a layered system:

1. Immediate safeguards: STOP/HELP precedence, keyword triggers, rate limits, and safe messaging.  
2. Risk containment: safety holds that suppress matching, LinkUps, and contact exchange.  
3. User control: block and report flows that immediately cut future interactions.  
4. Admin escalation: queues, severity policies, audit logs, and appeals.

All safety actions must be retry-safe, auditable, and privacy-preserving.

## Goals

* Detect and respond to safety risks in SMS-first interactions.  
* Provide clear user controls: block, report, stop.  
* Suppress sensitive actions (matching, LinkUps, contact exchange) under risk.  
* Create an operationally workable admin review system.  
* Minimize false positives while maintaining conservative safety behavior.

## Non-Goals

* Building a full trust-and-safety ML model (deferred).  
* Human identity verification or background checks (deferred).  
* Real-time content moderation at scale beyond keyword \+ reporting (deferred).

## Key Decisions And Trade-Offs

* Keyword-based triggers \+ user reporting: implementable and reliable; less nuanced than ML.  
* Hold-based containment: prevents harm escalation; can cause user frustration if overused.  
* “Deny by default” on safety holds: reduces risk; must include clear user messaging and admin resolution paths.  
* Minimal storage of message content: improves privacy; reduces moderation context.

## Definitions

* Safety Trigger: An event that indicates potential harm (keyword, report, repeated harassment).  
* Safety Hold: A restriction applied to a user or conversation that suppresses product actions.  
* Severity: A level (low/medium/high/critical) determining required response.  
* Incident: A structured record representing a potential safety issue.

## Safety Principles

* User safety overrides product growth.  
* Explainable enforcement. Users receive plain-language messages when blocked by safety.  
* Privacy-by-design. Store only what’s necessary, encrypt sensitive fields, and restrict access.  
* Least privilege. Only authorized admin roles can view safety data.  
* No silent bypass. Safety gates are enforced at all critical boundaries.

## Threat Model (MVP)

Primary risks at launch:

* Harassment or unwanted contact after LinkUp  
* Stalking or pressure to share personal info  
* Hate speech  
* Sexual harassment  
* Threats of violence  
* Self-harm or crisis disclosures  
* Spam and automated abuse  
* Fraudulent identity claims

## Safety Surfaces And Entry Points

* Inbound SMS (Twilio webhook)  
* Dashboard: profile updates, contact exchange, support requests  
* Post-event feedback text (Doc 08\)  
* Admin actions

## Core Components

### 1\) STOP/START/HELP Precedence

STOP behavior (carrier compliance):

* If inbound message is STOP-like, immediately:  
  * mark user as opted-out  
  * suppress all outbound except confirmation  
  * record event

START behavior:

* Allow opt back in.

HELP behavior:

* Send support instructions.

These precedence rules bypass LLMs and all other flows.

### 2\) Keyword Detection

A deterministic keyword detector runs before intent classification.

#### Categories

* Violence / threats  
* Self-harm  
* Hate speech  
* Sexual harassment  
* Doxxing / personal info requests  
* Scam/spam markers

#### Matching Rules

* Use normalized text (lowercase, strip punctuation).  
* Use bounded keyword list with versioning.  
* Avoid overly broad terms.

#### Response Rules

* For low/medium triggers:  
  * record an incident  
  * optionally warn user  
  * if repeated, escalate to hold  
* For high/critical triggers:  
  * immediate hold  
  * user-facing crisis routing message if self-harm  
  * admin alert

### 3\) Rate Limiting

Rate limits reduce spam and abuse:

* inbound messages per user per minute  
* outbound messages per user per minute  
* linkup initiation attempts per day  
* repeated unknown intents

On rate limit:

* respond with a short cooldown message  
* log

### 4\) User Block

Block is immediate and permanent unless user unblocks (MVP can be permanent).

Block semantics:

* A blocks B:  
  * B is excluded from A’s future matches and LinkUps  
  * contact exchange reveal is suppressed if pending  
  * future messaging between them is prevented

Block is a hard filter in matching (Doc 09\) and contact exchange (Doc 08).

### 5\) User Report

Report creates an incident and can optionally apply a hold.

Report flows:

* SMS command: “REPORT \[name/number\]” or guided prompts  
* Dashboard report button

Report requires:

* selecting a reason category  
* optional free text (bounded)

### 6\) Safety Holds

Holds are the containment mechanism.

#### Hold Types

* `match_hold`: suppress new previews  
* `linkup_hold`: suppress LinkUp participation  
* `contact_hold`: suppress contact exchange reveals  
* `global_hold`: suppress all premium actions

#### Hold Triggers

* critical keyword  
* repeated medium keywords  
* multiple reports  
* admin action

#### Hold Effects

When a hold is active:

* deny matching runs for that user  
* exclude from LinkUp candidate pools  
* suppress contact exchange reveal  
* optionally suppress inbound responses except support

### 7\) Escalation Ladder

Severity and actions:

* Low: log \+ monitor  
* Medium: warning message \+ incident \+ possible temporary hold  
* High: immediate hold \+ admin review required  
* Critical: immediate global hold \+ urgent admin alert \+ crisis routing if applicable

Severity is determined by:

* trigger category  
* repetition count  
* user history (strikes)

### 8\) Strikes And Reputation

Maintain a simple strike system:

* Each incident can contribute strikes.  
* Strikes decay over time.  
* Thresholds:  
  * 1 strike: warning  
  * 2 strikes: temporary hold  
  * 3 strikes: suspension review

Strikes must not be user-visible in MVP.

## Data Model

This doc assumes Doc 03 includes safety tables. Minimal set:

### Table: `safety_incidents`

* `id` uuid  
* `created_at`  
* `severity` enum  
* `category` enum  
* `reporter_user_id` nullable  
* `subject_user_id` nullable  
* `linkup_id` nullable  
* `message_id` nullable (inbound SMS)  
* `description` text nullable (bounded)  
* `status` enum: `open | triaged | resolved | escalated`  
* `assigned_admin_id` nullable  
* `resolution` jsonb nullable

### Table: `safety_holds`

* `id` uuid  
* `user_id`  
* `hold_type` enum  
* `reason` text  
* `status` enum: `active | lifted | expired`  
* `created_at`  
* `expires_at` nullable  
* `created_by_admin_id` nullable

### Table: `user_blocks`

* `blocker_user_id`  
* `blocked_user_id`  
* `created_at`

Unique on `(blocker_user_id, blocked_user_id)`.

### Table: `user_reports`

* `id`  
* `reporter_user_id`  
* `subject_user_id`  
* `reason_category`  
* `details` text nullable  
* `created_at`

## Safety Hooks Across The System

Safety checks MUST be enforced at:

* Conversation router (before LLM)  
* Matching candidate pool building  
* LinkUp invite selection  
* LinkUp lock transaction  
* Contact exchange reveal  
* Admin overrides

### Router Safety Behavior

On inbound message:

1. STOP/HELP precedence  
2. Rate limit  
3. Keyword detection  
4. If high/critical:  
   * write incident  
   * apply hold (idempotent)  
   * send safe response  
   * bypass other flows  
5. Else proceed to intent routing

### Matching Safety Behavior

* Exclude users on relevant holds.  
* Exclude blocked pairs.  
* If subject user on global hold, do not create previews.

### LinkUp Safety Behavior

* Exclude users with linkup\_hold or global\_hold.  
* At lock time, re-check all participants; if someone becomes unsafe, replace if possible (Doc 07).

### Contact Exchange Safety Behavior

* Before reveal:  
  * re-check blocks  
  * re-check holds

If suppressed:

* do not send numbers  
* create admin incident if needed

## Crisis Routing

If a message triggers self-harm/crisis keywords:

* Immediately respond with a crisis resource message appropriate for the user’s country if known (MVP can assume US if not known).  
* Apply a temporary global hold.  
* Create a critical incident.  
* Alert admin.

Important: Do not attempt to provide counseling. Provide resources and encourage seeking help.

## Admin Review Queues

Admin dashboard needs:

* Incident queue filtered by severity and status  
* Hold management  
* User history view (incidents, reports, strikes)  
* Audit log of admin actions

### Triage Workflow

1. New incident created.  
2. Auto-assigned severity.  
3. Admin triages:  
   * confirm severity  
   * decide action: warn, hold, suspend  
   * document resolution  
4. Resolution recorded, incident closed.

## Appeals And User Messaging

User messaging must be clear and non-accusatory.

If user is held:

* “Your account is temporarily paused while we review a safety concern. Reply HELP for support.”

Appeals process (MVP):

* user can reply HELP  
* support can review in admin

## Decision Trees

### Decision Tree: Keyword Trigger

1. Does message match any keyword category?  
   * No → proceed.  
   * Yes → compute severity.  
2. If severity high/critical:  
   * create incident  
   * apply hold  
   * send safe response  
   * stop  
3. Else:  
   * create incident  
   * if repetition threshold reached → apply temporary hold  
   * proceed (optional) or warn

### Decision Tree: Block Request

1. Identify target (from context: last LinkUp participants or last preview).  
2. Create block row (idempotent).  
3. Suppress future interactions.  
4. Confirm to user.

### Decision Tree: Report Request

1. Identify target.  
2. Ask reason category (one prompt).  
3. Create report and incident.  
4. Apply hold if policy dictates.  
5. Confirm receipt.

## Idempotency And Retry Safety

* Every incident creation uses an idempotency key:  
  * `incident:{message_sid}` for keyword triggers  
  * `report:{reporter}:{subject}:{timestamp_bucket}` for reports  
* Holds:  
  * `hold:{user_id}:{hold_type}:{reason_code}`  
* Blocks:  
  * unique constraint on pair prevents duplicates

## Edge Cases

* False positives from keywords:  
  * require repetition for medium categories  
  * allow admin lift  
* User tries to evade with spacing/typos:  
  * normalize text  
  * limited fuzzy matching allowed only for high-risk categories  
* Reports without clear target:  
  * fall back to “last LinkUp” context  
  * ask one clarifier  
* User is blocked during pending contact exchange:  
  * suppress reveal immediately  
* Users opt out (STOP) mid-safety flow:  
  * STOP wins, always

## Testing Plan

### Unit Tests

* Keyword detection category mapping.  
* Rate limiting thresholds.  
* Hold application idempotency.  
* Block/report parsing.

### Integration Tests

* Router precedence ordering.  
* Safety hold suppresses matching and LinkUps.  
* Block relationships excluded from candidate pools.  
* Contact reveal suppression when blocked/held.

### End-To-End Tests

1. Simulate harassment keyword inbound.  
2. Verify incident created, hold applied, and user receives safe message.  
3. Verify the held user cannot initiate LinkUp.  
4. Simulate block after a LinkUp; verify candidate exclusion.

## Production Readiness

### Observability

Emit:

* `safety_incident_created`  
* `safety_hold_applied/lifted`  
* `user_block_created`  
* `user_report_created`  
* `safety_keyword_triggered`  
* `rate_limit_triggered`

Alert thresholds:

* spike in incidents per hour per region  
* spike in holds  
* repeated keyword triggers from same user

### Operational Runbook

* How to respond to crisis triggers  
* How to triage incident queue  
* How to lift holds safely  
* How to handle false positives

### Wiring Verification

In staging:

* Send a test keyword message.  
* Confirm incident and hold creation.  
* Confirm downstream suppression of matching/linkups.  
* Confirm admin queue visibility.

## Implementation Checklist

* Implement STOP/HELP precedence.  
* Implement keyword detector with versioned lists.  
* Implement rate limits.  
* Implement incident creation and hold application.  
* Implement block and report flows via SMS \+ dashboard.  
* Enforce safety checks at all system boundaries.  
* Build admin safety queue views.  
* Add observability dashboards and alerts.