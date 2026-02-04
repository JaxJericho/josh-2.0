# Locations And Waitlist Operations (JOSH 2.0)

## *Document \#12*

## Summary

This document specifies how JOSH 2.0 handles location and region operations: collecting a user’s location in a privacy-preserving way, gating access based on region availability, operating the waitlist lifecycle, and safely transitioning a region from closed → open. It includes operational workflows, race-condition handling, and messaging rules for pre-launch users who text JOSH before their region opens.

Location handling in MVP uses coarse region membership (e.g., metro area or county cluster) rather than precise coordinates. The system must prevent “edge hopping” across regions, support border rules, and provide deterministic behavior when region status changes mid-flow.

## Goals

* Enforce region gating consistently across website, SMS, matching, and LinkUps.  
* Collect location with strong privacy constraints (coarse region, no precise storage required).  
* Operate a waitlist with clear user messaging and state transitions.  
* Provide a reliable region activation workflow with safety and load controls.  
* Handle common race conditions (user signs up while region flips open, duplicate signups, delayed SMS entry).

## Non-Goals

* Precise GPS tracking or continuous location updates.  
* Automatic venue routing or map integrations (venue suggestion is handled at a coarse level in Doc 07).  
* Multi-region subscription pricing or localized billing.

## Key Decisions And Trade-Offs

* Coarse regions (city/metro clusters): better privacy and simpler ops; less precise proximity matching.  
* Deterministic region membership: avoids user confusion; requires explicit border rules.  
* Waitlist onboarding allowed pre-launch: improves conversion and reduces launch-day friction; requires careful messaging and suppression of premium actions.

## Definitions

* Region: A coarse geographic area used for gating and pool formation.  
* Open Region: Users can fully onboard, match, and participate.  
* Closed Region: Users can register; they may complete partial onboarding and join waitlist.  
* Border Rules: Policies for users near region boundaries.  
* Activation: Operational process to open a region and begin messaging users.

## Region Model

### Region Attributes

Each region has:

* `region_id` (stable identifier)  
* `name` (display)  
* `status` enum: `open | closed | opening | paused`  
* `timezone`  
* `density_thresholds` (minimum eligible users for matching)  
* `settings` jsonb (matching cadence, LinkUp rollout flags)  
* `created_at`, `updated_at`

### Status Semantics

* `closed`: new users join waitlist; premium actions denied.  
* `opening`: transition state used during activation to prevent races.  
* `open`: full product enabled.  
* `paused`: temporarily stop matching/LinkUps (ops/safety). Existing users can still view dashboard.

## Location Collection

### Data Collected (MVP)

* User-provided city/zip OR a coarse area selection.  
* Derived region assignment.

Avoid storing exact lat/long unless explicitly required later.

### Methods

* Website registration: ask for ZIP or city.  
* SMS onboarding (fallback): ask “What city are you in?” and map via geocoding.

If geocoding is used:

* Store only the derived region and optionally the postal code.  
* Do not store full address.

### Region Assignment Algorithm

Given a user input (zip/city):

1. Normalize input.  
2. Map to a region using a deterministic lookup table.  
3. If ambiguous (multiple regions), ask exactly one clarifier:  
   * Provide up to 3 region options.  
   * Recommended default: closest/population-weighted.

### Border Rules

MVP rule:

* Each ZIP belongs to exactly one region.  
* If a city spans multiple regions, pick a default region and allow user to switch once within 24 hours.

Switching regions after that requires admin support to reduce abuse.

## Waitlist Lifecycle

### User States

A user in a closed region can be in:

* `registered_waitlist` (account created, OTP verified)  
* `onboarded_partial` (completed preferences interview)  
* `launch_notified` (received “region is open” message)  
* `activated` (eligible for matching)

These are represented via:

* `profiles.region_status` fields or a `waitlist_entries` table.

### Table: `waitlist_entries` (Recommended)

* `user_id` primary key  
* `region_id`  
* `status` enum: `waiting | onboarded | notified | activated | removed`  
* `joined_at`  
* `onboarded_at` nullable  
* `notified_at` nullable  
* `activated_at` nullable  
* `source` text (utm/ref)

## Pre-Launch Onboarding Behavior

In closed regions, JOSH may still run the onboarding interview and create a partial profile.

### Rules

* Allow onboarding interview steps that collect preferences and Friend Fingerprint.  
* Deny any action that initiates matching or LinkUps.  
* After onboarding completion, send a “saved progress” message:  
  * Confirm the profile is started.  
  * Explain JOSH will message again when the region opens.

### If User Texts During Pre-Launch Window

If region is closed and user sends any message not STOP/HELP:

* Respond politely:  
  * “We haven’t launched in your area yet. Your profile is saved. I’ll text you when we open.”

If the user has not completed onboarding, optionally offer to continue onboarding.

## Region Activation Workflow

Activation is a controlled process with explicit steps and safety checks.

### Preconditions

Before setting a region to open:

* Verify pool density thresholds:  
  * minimum number of eligible, onboarded users  
  * minimum ratio of verified accounts  
* Verify operational readiness:  
  * matching jobs configured  
  * SMS throughput capacity  
  * safety moderation queue staffed

### Activation Steps

1. Set region status: `closed → opening`.  
2. Run a consistency check:  
   * ensure waitlist entries map to region  
   * ensure profiles have required fields  
3. Batch notify waitlist users:  
   * send “we’re live” message  
   * rate limit sends  
4. Set region status: `opening → open`.  
5. Enable matching cadence gradually:  
   * ramp from small batch to full cadence

### Batch Notification Rate Limits

* Use outbound jobs with idempotency keys:  
  * `region_launch_notify:{region_id}:{user_id}`  
* Send in waves to avoid carrier filtering.

### Race Condition Handling

* If user registers while region is `opening`:  
  * Treat as waitlist but allow onboarding.  
  * Do not start matching until `open`.  
* If region flips to `open` while user is mid-onboarding:  
  * Let onboarding finish.  
  * Then proceed to active entry message.

## Region Pausing

A region may be paused due to:

* safety incident spike  
* carrier deliverability issues  
* ops constraints

Behavior:

* Stop new match runs and LinkUp broadcasts.  
* Allow users to access dashboard.  
* If users text JOSH, respond with:  
  * “We’re temporarily paused in your area. I’ll text you when we resume.”

## Decision Trees

### Decision Tree: Registration Entry

1. Determine region from input.  
2. If region.status \= open:  
   * proceed to active SMS onboarding entry.  
3. If region.status in {closed, opening, paused}:  
   * create waitlist entry.  
   * allow onboarding interview.  
   * suppress premium actions.

### Decision Tree: Inbound SMS In Closed Region

1. STOP/HELP precedence.  
2. If user is mid-onboarding:  
   * continue onboarding.  
3. Else:  
   * send pre-launch response and optionally offer onboarding.

### Decision Tree: Region Assignment Ambiguous

1. Attempt deterministic mapping.  
2. If multiple regions:  
   * ask one clarifier with up to 3 options.  
3. If still ambiguous:  
   * assign default and store a flag for admin review.

## Idempotency And Retry Safety

* Region assignment and waitlist entry creation must be idempotent:  
  * unique constraint `(user_id)` in waitlist\_entries  
* Region launch notifications idempotent by per-user key.  
* Activation workflow is stateful and must be resumable:  
  * store activation run record with checkpoints.

## Edge Cases

* User moves regions:  
  * Allow a single self-serve region change within 24 hours.  
  * After that, require admin.  
  * Changing region resets matching cadence and waitlist status appropriately.  
* Users near borders:  
  * Deterministic zip mapping prevents flip-flopping.  
* Duplicate signups:  
  * Phone number is unique; merging should be explicit.  
* Region density dips after opening:  
  * Matching relaxations (Doc 09\) apply; do not auto-close.

## Testing Plan

### Unit Tests

* Region mapping deterministic outputs.  
* Border rule logic.  
* Pre-launch inbound messaging paths.

### Integration Tests

* Waitlist entry creation idempotent.  
* Activation workflow transitions and resumability.  
* Launch notification job idempotency.

### End-To-End Tests

1. Register in closed region, complete onboarding, verify pre-launch messaging.  
2. Activate region, verify launch notification and transition to active status.  
3. Register during opening, verify correct gating.  
4. Pause region, verify suppression of matching and messaging.

## Production Readiness

### Observability

Emit events:

* `region_assignment_completed`  
* `waitlist_joined`  
* `waitlist_onboarded`  
* `region_activation_started/completed/failed`  
* `region_launch_notify_sent`  
* `region_paused`

### Operational Runbook

* Opening a region checklist  
* Pausing a region checklist  
* Common support scripts for “when will you launch?”

### Wiring Verification

* In staging, create a test region set to closed.  
* Register test users, complete onboarding.  
* Run activation, verify notifications.  
* Verify matching starts only after open.

## Implementation Checklist

* Create `regions` and `waitlist_entries` tables if not present.  
* Implement deterministic region mapping and clarifier.  
* Implement pre-launch onboarding policy.  
* Implement inbound SMS behavior for closed/paused regions.  
* Implement region activation workflow with checkpoints.  
* Implement launch notification job with rate limits.  
* Add admin tools to open/pause regions.  
* Add observability dashboards and alerts.