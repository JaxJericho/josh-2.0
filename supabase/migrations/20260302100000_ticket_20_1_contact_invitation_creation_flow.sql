-- Ticket 20.1: Contact invitation creation flow idempotency constraints
-- Additive, replay-safe guards for invitation and outbound-job uniqueness.

create unique index if not exists contact_invitations_pending_inviter_invitee_uniq
  on public.contact_invitations (inviter_user_id, invitee_phone_hash)
  where status = 'pending';

create unique index if not exists sms_outbound_jobs_contact_invitation_corr_purpose_uniq
  on public.sms_outbound_jobs (correlation_id, purpose)
  where correlation_id is not null
    and purpose like 'contact_invitation_%';
