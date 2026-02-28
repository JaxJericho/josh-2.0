-- Ticket 16.2: New 3.0 tables (plan_briefs, contact_invitations, contact_circle)
-- Phase 16 — Schema Foundation
-- Fully additive. Replay-safe. No runtime changes.

-- =========================================
-- plan_briefs
-- =========================================

create table if not exists public.plan_briefs (
  id uuid primary key default gen_random_uuid(),

  creator_user_id uuid not null
    references public.users(id),

  activity_key text,
  proposed_time_window text,
  notes text,

  status text not null default 'draft',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_plan_briefs_creator_user_id
  on public.plan_briefs (creator_user_id);


-- =========================================
-- contact_invitations
-- =========================================

create table if not exists public.contact_invitations (
  id uuid primary key default gen_random_uuid(),

  inviter_user_id uuid not null
    references public.users(id),

  invitee_phone_hash text not null,

  plan_brief_id uuid
    references public.plan_briefs(id),

  status text not null default 'pending',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contact_invitations_invitee_phone_hash
  on public.contact_invitations (invitee_phone_hash);

create index if not exists idx_contact_invitations_inviter_user_id
  on public.contact_invitations (inviter_user_id);


-- =========================================
-- contact_circle
-- =========================================

create table if not exists public.contact_circle (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.users(id),

  contact_name text not null,
  contact_phone_hash text not null,
  contact_phone_e164 text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint contact_circle_user_phone_unique
    unique (user_id, contact_phone_hash)
);

create index if not exists idx_contact_circle_user_id
  on public.contact_circle (user_id);
