-- Enums explicitly specified in docs/specs/josh-2.0

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_state') then
    create type public.user_state as enum (
      'unverified',
      'verified',
      'interviewing',
      'active',
      'suspended',
      'deleted'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'profile_state') then
    create type public.profile_state as enum (
      'empty',
      'partial',
      'complete_mvp',
      'complete_full',
      'stale'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'conversation_mode') then
    create type public.conversation_mode as enum (
      'idle',
      'interviewing',
      'linkup_forming',
      'awaiting_invite_reply',
      'safety_hold'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'linkup_state') then
    create type public.linkup_state as enum (
      'draft',
      'broadcasting',
      'locked',
      'completed',
      'expired',
      'canceled'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'invite_state') then
    create type public.invite_state as enum (
      'pending',
      'accepted',
      'declined',
      'expired',
      'closed'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'subscription_state') then
    create type public.subscription_state as enum (
      'none',
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'region_state') then
    create type public.region_state as enum (
      'open',
      'waitlisted',
      'closed'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'entitlement_source') then
    create type public.entitlement_source as enum (
      'stripe',
      'admin_override',
      'reconciled'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'safety_incident_status') then
    create type public.safety_incident_status as enum (
      'open',
      'triaged',
      'resolved',
      'escalated'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'safety_hold_status') then
    create type public.safety_hold_status as enum (
      'active',
      'lifted',
      'expired'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'waitlist_status') then
    create type public.waitlist_status as enum (
      'waiting',
      'onboarded',
      'notified',
      'activated',
      'removed'
    );
  end if;
end $$;
