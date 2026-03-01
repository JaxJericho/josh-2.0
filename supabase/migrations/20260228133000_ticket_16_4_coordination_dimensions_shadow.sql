-- Ticket 16.4 — Add coordination_dimensions shadow column
-- Phase 16 — Schema Foundation
-- Fully additive. Replay-safe.

alter table if exists public.profiles
  add column if not exists coordination_dimensions jsonb;
