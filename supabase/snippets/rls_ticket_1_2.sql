-- RLS verification (Ticket 1.2)
-- Run after: supabase db reset --debug
-- Then execute with psql against the local DB as a superuser.

-- Seed data as service_role (bypass RLS)
reset role;
set role service_role;

insert into public.regions (id, slug, display_name, state, geometry, rules)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'test', 'Test Region', 'open', '{}'::jsonb, '{}'::jsonb);

insert into public.users (
  id, phone_e164, phone_hash, first_name, last_name, birthday,
  sms_consent, age_consent, terms_consent, privacy_consent
)
values
  ('11111111-1111-1111-1111-111111111111', '+15550000001', 'hash1', 'Alice', 'A', '1990-01-01', true, true, true, true),
  ('22222222-2222-2222-2222-222222222222', '+15550000002', 'hash2', 'Bob', 'B', '1990-01-02', true, true, true, true);

insert into public.profiles (user_id)
values ('11111111-1111-1111-1111-111111111111'),
       ('22222222-2222-2222-2222-222222222222');

insert into public.linkups (
  id, initiator_user_id, region_id, state, brief, linkup_create_key
)
values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'draft', '{}'::jsonb, 'linkup-a'),
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'draft', '{}'::jsonb, 'linkup-b');

insert into public.linkup_participants (linkup_id, user_id, role)
values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'initiator'),
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'participant'),
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'initiator');

insert into public.sms_messages (user_id, direction, from_e164, to_e164)
values
  ('11111111-1111-1111-1111-111111111111', 'in', '+15550000001', '+15551234567'),
  ('22222222-2222-2222-2222-222222222222', 'in', '+15550000002', '+15551234567');

-- As user A (authenticated)
reset role;
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select current_user as current_role, auth.uid() as auth_uid;

-- Expect 1 (own profile only)
select count(*) as profiles_visible_to_user_a from public.profiles;

-- Expect 0 (cannot read user B profile)
select count(*) as user_b_profile_visible_to_user_a
from public.profiles
where user_id = '22222222-2222-2222-2222-222222222222';

-- Expect 1 (only linkup A visible)
select count(*) as linkups_visible_to_user_a from public.linkups;

-- Expect 0 (linkup B hidden)
select count(*) as user_b_linkup_visible_to_user_a
from public.linkups
where initiator_user_id = '22222222-2222-2222-2222-222222222222';

-- Expect 0 (sms_messages table not readable by end users)
select count(*) as sms_messages_visible_to_user_a from public.sms_messages;

-- As user B (authenticated)
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select current_user as current_role, auth.uid() as auth_uid;

-- Expect 1 (own profile only)
select count(*) as profiles_visible_to_user_b from public.profiles;

-- Expect 0 (cannot read user A profile)
select count(*) as user_a_profile_visible_to_user_b
from public.profiles
where user_id = '11111111-1111-1111-1111-111111111111';

-- Expect 2 (linkup A via participant + linkup B as initiator)
select count(*) as linkups_visible_to_user_b from public.linkups;

-- Service role can read everything
reset role;
set role service_role;
select count(*) as linkups_visible_to_service_role from public.linkups;
