-- Ticket 1.1: Drop retired Plan Circle tables
-- plan_briefs and contact_circle are retired by the pivot to invitation-driven model.
-- contact_invitations is retained for member-to-member referrals.
-- No live data exists. Clean drop - no migration of rows required.

begin;

-- Step 1: Drop plan_brief_id FK column from contact_invitations.
-- This column references plan_briefs and must be removed before plan_briefs can be dropped.
alter table public.contact_invitations
  drop column if exists plan_brief_id;

-- Step 2: Drop plan_briefs.
-- contact_invitations.plan_brief_id (the only FK referencing this table) is dropped above.
drop table if exists public.plan_briefs;

-- Step 3: Drop contact_circle.
-- No other table holds a FK referencing contact_circle.
drop table if exists public.contact_circle;

commit;
