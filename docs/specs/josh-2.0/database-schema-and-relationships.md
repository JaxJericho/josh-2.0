# Database Schema And Relationships (JOSH 2.0)

## *Document \#3*

## Summary

This document defines the complete Supabase (Postgres) schema for JOSH 2.0. It is the system’s source of truth for user identity, interview signals, LinkUp formation, invites, entitlements, safety enforcement, and auditability.

The schema is designed for production realities: Twilio retries inbound webhooks, Stripe retries webhooks, and serverless workers can run concurrently. So every table that participates in “side effects” (invites, lock transitions, entitlement changes) includes idempotency keys, unique constraints, and indexing for fast lookups. Raw SMS text is treated as sensitive: it is stored encrypted with retention controls, while the system primarily relies on derived structured signals.

Everything here is implementation-ready: tables, columns, constraints, indexes, RLS policies, JSON structures, and a migration strategy.

---

## Scope, Out Of Scope, Deferred

### In Scope

* Complete schema for core flows: registration → interview → LinkUp formation → lock → contact exchange.  
* Tables for entitlements, Stripe event ingestion, Twilio message ingestion, and audit trails.  
* Row-level security policies (RLS) for user-visible tables.

### Out Of Scope

* Real-time participant chat or masked relay chat.  
* Full external venue provider integrations.

### Deferred

* Analytical warehouse (BigQuery/Snowflake) and streaming pipelines.  
* Highly optimized SQL-side scoring (materialized views for factor vectors).

---

## Key Decisions

1. Derived signals are primary, raw text is secondary  
   * Store structured profile signals long-term.  
   * Store raw message bodies encrypted with retention limits.  
2. Idempotency is enforced in the database  
   * Unique constraints prevent double-processing.  
   * Domain events and processing tables record external event IDs.  
3. RLS is enabled for user-owned tables, but server-side orchestration uses service role  
   * The app performs most reads/writes via server routes using the service role.  
   * RLS still protects against accidental exposure if client queries are introduced.  
4. Modular table groups match the architecture  
   * Identity, conversation, profile, LinkUps, billing, safety, admin, audit.

---

## Global Conventions

### Extensions

```sql
create extension if not exists pgcrypto;
create extension if not exists citext;
```

### Common Columns

* `id uuid primary key default gen_random_uuid()`  
* `created_at timestamptz not null default now()`  
* `updated_at timestamptz not null default now()`

Use a trigger to keep `updated_at` current.

```sql
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
```

### Soft Delete

For user deletion and compliance workflows:

* `deleted_at timestamptz`  
* Rows are retained per retention policy and excluded from normal queries.

### Correlation And Idempotency

* `correlation_id uuid` propagated across inbound → handlers → outbound.  
* Idempotency is enforced via unique constraints on:  
  * Twilio `message_sid`  
  * Stripe `event_id`  
  * Outbound job IDs  
  * LinkUp create keys

---

## Enum Types

Use enums for stability and correctness.

```sql
create type public.user_state as enum (
  'unverified',
  'verified',
  'interviewing',
  'active',
  'suspended',
  'deleted'
);

create type public.profile_state as enum (
  'empty',
  'partial',
  'complete_mvp',
  'complete_full',
  'stale'
);

create type public.conversation_mode as enum (
  'idle',
  'interviewing',
  'linkup_forming',
  'awaiting_invite_reply',
  'safety_hold'
);

create type public.linkup_state as enum (
  'draft',
  'broadcasting',
  'locked',
  'completed',
  'expired',
  'canceled'
);

create type public.invite_state as enum (
  'pending',
  'accepted',
  'declined',
  'expired',
  'closed'
);

create type public.subscription_state as enum (
  'none',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid'
);

create type public.safety_hold_state as enum (
  'none',
  'soft_hold',
  'hard_hold'
);

create type public.region_state as enum (
  'open',
  'waitlisted',
  'closed'
);
```

---

## Identity And Registration Tables

### users

This is the core user record keyed by phone identity.

```sql
create table public.users (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  phone_hash text not null,
  first_name text not null,
  last_name text not null,
  birthday date not null,
  email citext,
  state public.user_state not null default 'unverified',
  sms_consent boolean not null,
  age_consent boolean not null,
  terms_consent boolean not null,
  privacy_consent boolean not null,
  region_id uuid,
  suspended_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_phone_hash_uniq unique (phone_hash),
  constraint users_phone_e164_uniq unique (phone_e164)
);

create index users_region_idx on public.users(region_id);
create index users_state_idx on public.users(state);
```

Notes:

* `phone_hash` is a stable join key used for logs and safety workflows.  
* The application should compute `phone_hash = sha256(e164 + pepper)`.

### otp\_sessions

Tracks Twilio OTP verification flows.

```sql
create table public.otp_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  otp_hash text not null,
  expires_at timestamptz not null,
  verified_at timestamptz,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint otp_one_active_per_user unique (user_id, verified_at)
);

create index otp_sessions_user_idx on public.otp_sessions(user_id);
create index otp_sessions_expires_idx on public.otp_sessions(expires_at);
```

Implementation detail:

* Use `otp_hash` (never store raw OTP).  
* Enforce max attempts in application logic.

---

## Regions And Waitlist

### regions

```sql
create table public.regions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  state public.region_state not null default 'waitlisted',
  geometry jsonb not null, -- polygon/zip definitions
  rules jsonb not null default '{}'::jsonb, -- border rules, min density thresholds
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index regions_state_idx on public.regions(state);
```

### region\_memberships

Represents a user’s primary region.

```sql
create table public.region_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  region_id uuid not null references public.regions(id) on delete restrict,
  status text not null check (status in ('active','waitlisted')),
  joined_at timestamptz not null default now(),
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint region_membership_one_active unique (user_id, status)
);

create index region_memberships_region_idx on public.region_memberships(region_id);
create index region_memberships_user_idx on public.region_memberships(user_id);
```

---

## Conversation And Messaging

### conversation\_sessions

This is the router pointer.

```sql
create table public.conversation_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  mode public.conversation_mode not null default 'idle',
  state_token text not null default 'idle',
  expires_at timestamptz,
  last_inbound_message_sid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_one_per_user unique (user_id)
);

create index conversation_sessions_mode_idx on public.conversation_sessions(mode);
```

### sms\_messages

Stores inbound and outbound messages. The body is encrypted.

```sql
create table public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  direction text not null check (direction in ('in','out')),
  from_e164 text not null,
  to_e164 text not null,
  twilio_message_sid text not null,
  body_ciphertext bytea,
  body_iv bytea,
  body_tag bytea,
  key_version int not null default 1,
  media_count int not null default 0,
  status text,
  last_status_at timestamptz,
  correlation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_messages_twilio_sid_uniq unique (twilio_message_sid)
);

create index sms_messages_user_idx on public.sms_messages(user_id);
create index sms_messages_created_idx on public.sms_messages(created_at);
create index sms_messages_direction_idx on public.sms_messages(direction);
```

Retention policy:

* Keep encrypted bodies for a limited window (example: 30–90 days).  
* After retention, set `body_ciphertext/body_iv/body_tag` to null but keep metadata.

### sms\_outbound\_jobs

Outbound SMS must be job-backed for retry safety.

```sql
create table public.sms_outbound_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  to_e164 text not null,
  body_ciphertext bytea,
  body_iv bytea,
  body_tag bytea,
  key_version int not null default 1,
  purpose text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  twilio_message_sid text,
  attempts int not null default 0,
  last_error text,
  correlation_id uuid,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_outbound_idem_uniq unique (idempotency_key)
);

create index sms_outbound_jobs_status_idx on public.sms_outbound_jobs(status);
create index sms_outbound_jobs_user_idx on public.sms_outbound_jobs(user_id);
```

### message\_events (audit)

This table captures normalized events for debugging.

```sql
create table public.message_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  event_type text not null,
  payload jsonb not null,
  correlation_id uuid,
  created_at timestamptz not null default now()
);

create index message_events_user_idx on public.message_events(user_id);
create index message_events_type_idx on public.message_events(event_type);
create index message_events_created_idx on public.message_events(created_at);
```

---

## Profile And Signals

### profiles

This table stores the Friend Fingerprint and activity patterns.

```sql
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  state public.profile_state not null default 'empty',
  fingerprint jsonb not null default '{}'::jsonb,
  activity_patterns jsonb not null default '[]'::jsonb,
  boundaries jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  active_intent jsonb,
  last_interview_step text,
  completed_at timestamptz,
  stale_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_user_uniq unique (user_id)
);

create index profiles_state_idx on public.profiles(state);
create index profiles_user_idx on public.profiles(user_id);
```

#### JSON Structures

Friend Fingerprint example (12 factors):

```json
{
  "connection_depth": {"range_value": 0.72, "confidence": 0.64, "freshness_days": 3, "sources": {"interview": 0.9}},
  "social_pace": {"range_value": 0.40, "confidence": 0.55, "freshness_days": 10, "sources": {"interview": 0.8, "invite_accept": 0.2}}
}
```

Activity patterns example:

```json
[
  {
    "activity_key": "coffee",
    "motive_weights": {"connection": 0.7, "comfort": 0.6},
    "constraints": {"quiet": true, "indoor": true},
    "preferred_windows": ["morning", "day"],
    "confidence": 0.7,
    "freshness_days": 5
  }
]
```

Boundaries example:

```json
{
  "no_thanks": ["bars", "late_night"],
  "hard_constraints": {"smoking": false}
}
```

### profile\_events

Every profile update should write an event for audit and learning.

```sql
create table public.profile_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  event_type text not null,
  source text not null,
  payload jsonb not null,
  idempotency_key text not null,
  correlation_id uuid,
  created_at timestamptz not null default now(),
  constraint profile_events_idem_uniq unique (idempotency_key)
);

create index profile_events_user_idx on public.profile_events(user_id);
create index profile_events_type_idx on public.profile_events(event_type);
```

---

## LinkUps And Invites

### linkups

```sql
create table public.linkups (
  id uuid primary key default gen_random_uuid(),
  initiator_user_id uuid not null references public.users(id) on delete restrict,
  region_id uuid not null references public.regions(id) on delete restrict,
  state public.linkup_state not null default 'draft',
  brief jsonb not null,
  acceptance_window_ends_at timestamptz,
  event_time timestamptz,
  venue jsonb,
  min_size int not null default 2,
  max_size int not null default 6,
  lock_version int not null default 0,
  locked_at timestamptz,
  canceled_reason text,
  correlation_id uuid,
  linkup_create_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkups_create_key_uniq unique (linkup_create_key)
);

create index linkups_region_state_idx on public.linkups(region_id, state);
create index linkups_initiator_idx on public.linkups(initiator_user_id);
create index linkups_window_idx on public.linkups(acceptance_window_ends_at);
```

Brief example:

```json
{
  "activity_key": "coffee",
  "time_window": "SAT_MORNING",
  "motive_emphasis": {"connection": 0.7, "comfort": 0.6},
  "constraints": {"quiet": true},
  "group_size": {"min": 2, "max": 6}
}
```

### linkup\_invites

```sql
create table public.linkup_invites (
  id uuid primary key default gen_random_uuid(),
  linkup_id uuid not null references public.linkups(id) on delete cascade,
  invited_user_id uuid not null references public.users(id) on delete cascade,
  state public.invite_state not null default 'pending',
  offered_options jsonb,
  selected_option text,
  sent_at timestamptz,
  responded_at timestamptz,
  expires_at timestamptz,
  closed_at timestamptz,
  response_message_sid text,
  idempotency_key text not null,
  explainability jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkup_invites_once unique (linkup_id, invited_user_id),
  constraint linkup_invites_idem_uniq unique (idempotency_key)
);

create index linkup_invites_user_state_idx on public.linkup_invites(invited_user_id, state);
create index linkup_invites_linkup_idx on public.linkup_invites(linkup_id);
```

Explainability example:

```json
{
  "friend_score": 0.71,
  "moment_fit": 0.66,
  "final_score": 0.69,
  "filters": {"passed": ["region","entitled","not_on_hold"], "failed": []},
  "top_reasons": ["similar social pace", "shared restorative motive"]
}
```

### linkup\_participants

Participants are “real membership” after accept/lock.

```sql
create table public.linkup_participants (
  id uuid primary key default gen_random_uuid(),
  linkup_id uuid not null references public.linkups(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('initiator','participant')),
  status text not null default 'confirmed' check (status in ('confirmed','canceled','no_show','attended')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkup_participants_once unique (linkup_id, user_id)
);

create index linkup_participants_linkup_idx on public.linkup_participants(linkup_id);
create index linkup_participants_user_idx on public.linkup_participants(user_id);
```

### linkup\_reminders

```sql
create table public.linkup_reminders (
  id uuid primary key default gen_random_uuid(),
  linkup_id uuid not null references public.linkups(id) on delete cascade,
  reminder_type text not null,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkup_reminders_idem_uniq unique (idempotency_key)
);

create index linkup_reminders_sched_idx on public.linkup_reminders(scheduled_for);
```

### linkup\_outcomes

Stores post-event learning signals.

```sql
create table public.linkup_outcomes (
  id uuid primary key default gen_random_uuid(),
  linkup_id uuid not null references public.linkups(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  attendance_response text check (attendance_response in ('attended','no_show','unsure')),
  do_again boolean,
  feedback text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkup_outcomes_once unique (linkup_id, user_id)
);

create index linkup_outcomes_linkup_idx on public.linkup_outcomes(linkup_id);
```

---

## Contact Exchange

### contact\_exchange\_choices

Each user chooses “yes/no” per attendee.

```sql
create table public.contact_exchange_choices (
  id uuid primary key default gen_random_uuid(),
  linkup_id uuid not null references public.linkups(id) on delete cascade,
  chooser_user_id uuid not null references public.users(id) on delete cascade,
  target_user_id uuid not null references public.users(id) on delete cascade,
  choice boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_choice_once unique (linkup_id, chooser_user_id, target_user_id)
);

create index contact_choices_chooser_idx on public.contact_exchange_choices(chooser_user_id);
```

### contact\_exchanges

Created only when both parties choose yes.

```sql
create table public.contact_exchanges (
  id uuid primary key default gen_random_uuid(),
  linkup_id uuid not null references public.linkups(id) on delete cascade,
  user_a_id uuid not null references public.users(id) on delete cascade,
  user_b_id uuid not null references public.users(id) on delete cascade,
  revealed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_exchange_pair_once unique (linkup_id, user_a_id, user_b_id)
);
```

Rule:

* Store pairs in canonical order (application ensures `user_a_id < user_b_id` lexicographically).

---

## Billing And Entitlements

### stripe\_customers

```sql
create table public.stripe_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  stripe_customer_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_customers_user_uniq unique (user_id),
  constraint stripe_customers_cust_uniq unique (stripe_customer_id)
);
```

### subscriptions

```sql
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  stripe_subscription_id text,
  state public.subscription_state not null default 'none',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  grace_until timestamptz,
  last_stripe_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_user_uniq unique (user_id)
);

create index subscriptions_state_idx on public.subscriptions(state);
```

### entitlements

```sql
create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  eligible_to_participate boolean not null default false,
  eligible_to_initiate boolean not null default false,
  source text not null default 'stripe',
  effective_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entitlements_user_uniq unique (user_id)
);

create index entitlements_participate_idx on public.entitlements(eligible_to_participate);
```

### stripe\_events

Idempotent webhook ingestion.

```sql
create table public.stripe_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  constraint stripe_events_event_uniq unique (stripe_event_id)
);

create index stripe_events_type_idx on public.stripe_events(event_type);
```

---

## Safety And Abuse Prevention

### safety\_holds

```sql
create table public.safety_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  state public.safety_hold_state not null default 'none',
  reason text,
  applied_at timestamptz,
  expires_at timestamptz,
  cleared_at timestamptz,
  applied_by_admin uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_holds_user_uniq unique (user_id)
);

create index safety_holds_state_idx on public.safety_holds(state);
```

### safety\_incidents

```sql
create table public.safety_incidents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  reporter_user_id uuid references public.users(id) on delete set null,
  reporter_phone_hash text,
  incident_type text not null,
  severity int not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','reviewing','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index safety_incidents_status_idx on public.safety_incidents(status);
create index safety_incidents_user_idx on public.safety_incidents(user_id);
```

### safety\_reports

```sql
create table public.safety_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid references public.users(id) on delete set null,
  reported_user_id uuid references public.users(id) on delete set null,
  reporter_phone_hash text,
  report_type text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','reviewing','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index safety_reports_status_idx on public.safety_reports(status);
```

### user\_blocks

```sql
create table public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_user_id uuid not null references public.users(id) on delete cascade,
  blocked_user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint user_blocks_once unique (blocker_user_id, blocked_user_id)
);
```

### user\_strikes

```sql
create table public.user_strikes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  strike_type text not null,
  points int not null,
  reason text,
  window_start timestamptz not null,
  window_end timestamptz not null,
  created_at timestamptz not null default now()
);

create index user_strikes_user_idx on public.user_strikes(user_id);
```

---

## Admin And Audit

### admin\_users

```sql
create table public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  role text not null check (role in ('support','ops','engineering')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### admin\_audit\_log

```sql
create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references public.admin_users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_action_idx on public.admin_audit_log(action);
create index admin_audit_target_idx on public.admin_audit_log(target_type, target_id);
```

### domain\_events

Optional but recommended: one table for all domain transitions.

```sql
create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null,
  from_state text,
  to_state text,
  idempotency_key text,
  correlation_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint domain_events_idem_uniq unique (idempotency_key)
);

create index domain_events_entity_idx on public.domain_events(entity_type, entity_id);
create index domain_events_created_idx on public.domain_events(created_at);
```

---

## Magic Links For Dashboard Access

This supports “view in dashboard” links sent via SMS.

### magic\_links

```sql
create table public.magic_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null,
  purpose text not null,
  linkup_id uuid references public.linkups(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint magic_links_token_uniq unique (token_hash)
);

create index magic_links_user_idx on public.magic_links(user_id);
create index magic_links_expires_idx on public.magic_links(expires_at);
```

Rules:

* Store only `token_hash` (never raw token).  
* One-time consumption enforced by `consumed_at is null` guard.

---

## Row-Level Security Policies

Enable RLS on all user-owned tables.

### General Pattern

* Users can select their own records.  
* Users can update their own records.  
* Users can insert only where `user_id = auth.uid()`.

Because the MVP dashboard may rely on server-side reads, these policies are protective but not necessarily used by the UI today.

Example for `profiles`:

```sql
alter table public.profiles enable row level security;

create policy profiles_select_own
on public.profiles for select
using (user_id = auth.uid());

create policy profiles_update_own
on public.profiles for update
using (user_id = auth.uid())
with check (user_id = auth.uid());
```

Apply similarly to:

* `users` (if you map auth users to app users)  
* `linkups` (initiator and participants can read)  
* `linkup_participants` (members can read)  
* `contact_exchange_choices`  
* `contact_exchanges`

### LinkUp Read Policy (Concept)

Allow reads if:

* user is initiator OR  
* user is a participant OR  
* user has a pending invite

Implement as:

```sql
alter table public.linkups enable row level security;

create policy linkups_select_member
on public.linkups for select
using (
  exists (
    select 1 from public.linkup_participants p
    where p.linkup_id = linkups.id and p.user_id = auth.uid()
  )
  or exists (
    select 1 from public.linkup_invites i
    where i.linkup_id = linkups.id and i.invited_user_id = auth.uid()
  )
  or linkups.initiator_user_id = auth.uid()
);
```

Note:

* If you keep `public.users.id` separate from `auth.uid()`, introduce an `auth_user_map` table and use it in policies.

---

## Common Query Patterns And Indexing

### Patterns

* Find user by phone: `users.phone_hash` (unique)  
* Load a user’s latest conversation pointer: `conversation_sessions.user_id` (unique)  
* Find active LinkUps in a region: `linkups(region_id, state)`  
* Find a user’s pending invites: `linkup_invites(invited_user_id, state)`  
* Find locked LinkUps for dashboard: `linkup_participants(user_id)` join `linkups(state)`

### Composite Indexes (Recommended)

```sql
create index linkups_state_window_idx on public.linkups(state, acceptance_window_ends_at);
create index invites_linkup_state_idx on public.linkup_invites(linkup_id, state);
create index participants_linkup_status_idx on public.linkup_participants(linkup_id, status);
```

---

## Migration Strategy

### Versioning

* Use Supabase migrations in `supabase/migrations/`.  
* Filenames: `YYYYMMDDHHMMSS_<description>.sql`.  
* Every migration must be idempotent where possible (use `if exists` guards).

### Rollback

* Prefer forward-only migrations for production.  
* For high-risk changes, include a companion rollback migration that:  
  * restores old columns  
  * backfills from new columns

### Data Backfills

* Large backfills should be done in chunks with an admin job runner.  
* Record backfill completion in an admin audit log entry.

---

## Risks And Mitigation

1. Schema drift between code and DB types  
   * Mitigation: regenerate TS types on every schema change; CI checks for drift.  
2. RLS misconfiguration blocks production flows  
   * Mitigation: keep server-side writes under service role; add staging rehearsals.  
3. Encrypted body retention not enforced  
   * Mitigation: scheduled job that nulls ciphertext after retention window.  
4. Slow queries on LinkUp invite selection  
   * Mitigation: ensure region/state/user indexes exist; keep candidate pools bounded.

---

## Testing Approach

### Unit Tests

* Schema invariants: unique constraints and enum correctness.  
* JSON schema validators for fingerprint and activity patterns.

### Integration Tests

* Full inbound Twilio insert with unique `twilio_message_sid`.  
* Outbound job idempotency constraint.  
* LinkUp lock transaction with `lock_version`.  
* Stripe event idempotency constraint.

### E2E Scenarios

* Registration → OTP session verified.  
* Invite wave created → replies update invite state.  
* Lock creates participant rows.  
* Contact exchange creates pair rows only when mutual.

---

## Production Readiness

### 1\) Infrastructure Setup

#### Supabase Project Settings

* Enable RLS by default.  
* Confirm `pgcrypto` extension enabled.  
* If using connection pooling:  
  * use Supabase pooler for serverless.  
* Configure backups and PITR for production.

#### Key Management

* Encryption key material must never be stored in DB.  
* Store only `key_version` in message tables.  
* Rotate keys by bumping `key_version` and keeping decryption compatibility.

### 2\) Environment Parity

* Staging and production must have identical schema.  
* Only seed data differs (regions, test users).

### 3\) Deployment Procedure

1. Apply migrations to staging.  
2. Regenerate types and run CI.  
3. Apply migrations to production.  
4. Run schema verification queries:  
   * count tables  
   * check enums  
   * check indexes

### 4\) Wiring Verification

* Verify that:  
  * Twilio inbound inserts into `sms_messages` exactly once per MessageSid.  
  * Stripe webhook inserts into `stripe_events` exactly once per event.  
  * LinkUp lock updates exactly once under concurrency.

### 5\) Operational Readiness

* Add a “schema drift” check:  
  * compare generated TS types to expected commit.  
* Add alerts for:  
  * increasing DB error rates  
  * deadlocks (should be rare)  
  * webhook processing failures

---

## Implementation Checklist

1. Create enums.  
2. Create tables in this order:  
   * users, otp\_sessions  
   * regions, region\_memberships  
   * conversation\_sessions, sms\_messages, sms\_outbound\_jobs, message\_events  
   * profiles, profile\_events  
   * linkups, linkup\_invites, linkup\_participants, linkup\_reminders, linkup\_outcomes  
   * contact\_exchange\_choices, contact\_exchanges  
   * stripe\_customers, subscriptions, entitlements, stripe\_events  
   * safety\_holds, safety\_incidents, safety\_reports, user\_blocks, user\_strikes  
   * admin\_users, admin\_audit\_log, domain\_events  
   * magic\_links  
3. Add triggers for `updated_at`.  
4. Enable RLS and add policies.  
5. Add seed scripts for regions and activity catalog (if desired).  
6. Generate TS types and add CI drift check.

