-- Ticket 16.3: Profile schema expansion and activity_catalog
-- Phase 16 — Schema Foundation
-- Fully additive. Replay-safe.

-- =========================================
-- Add columns to profiles
-- =========================================

alter table if exists public.profiles
  add column if not exists scheduling_availability jsonb;

alter table if exists public.profiles
  add column if not exists notice_preference text;

alter table if exists public.profiles
  add column if not exists coordination_style text;

-- Layer B placeholders (not used at MVP)

alter table if exists public.profiles
  add column if not exists personality_substrate jsonb;

alter table if exists public.profiles
  add column if not exists relational_style jsonb;

alter table if exists public.profiles
  add column if not exists values_orientation jsonb;


-- =========================================
-- Add column to users
-- =========================================

alter table if exists public.users
  add column if not exists registration_source text;


-- =========================================
-- activity_catalog
-- =========================================

create table if not exists public.activity_catalog (
  id uuid primary key default gen_random_uuid(),

  activity_key text not null unique,
  display_name text not null,
  category text not null,
  short_description text not null,
  regional_availability text not null,

  motive_weights jsonb not null,
  constraints jsonb not null,

  preferred_windows text[] not null,
  group_size_fit text[] not null,

  tags text[],

  created_at timestamptz not null default now()
);
