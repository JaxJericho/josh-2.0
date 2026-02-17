-- Deterministic seed data for local dev + E2E
-- Safe to run multiple times (upserts by deterministic IDs)

begin;

set timezone = 'UTC';

-- Regions
insert into public.regions (
  id,
  slug,
  display_name,
  state,
  geometry,
  rules,
  name,
  country_code,
  state_code,
  is_active,
  is_launch_region
) values
  (
    '00000000-0000-0000-0000-000000000101'::uuid,
    'bay-area',
    'Bay Area',
    'open',
    '{"type":"region","name":"Bay Area"}'::jsonb,
    '{"density_thresholds":{"eligible_min":50}}'::jsonb,
    'Bay Area',
    'US',
    'CA',
    true,
    true
  ),
  (
    '00000000-0000-0000-0000-000000000102'::uuid,
    'austin',
    'Austin',
    'waitlisted',
    '{"type":"region","name":"Austin"}'::jsonb,
    '{"density_thresholds":{"eligible_min":40}}'::jsonb,
    'Austin',
    'US',
    'TX',
    false,
    false
  )
on conflict (id) do update set
  slug = excluded.slug,
  display_name = excluded.display_name,
  state = excluded.state,
  geometry = excluded.geometry,
  rules = excluded.rules,
  name = excluded.name,
  country_code = excluded.country_code,
  state_code = excluded.state_code,
  is_active = excluded.is_active,
  is_launch_region = excluded.is_launch_region;

-- Users
with seed_users as (
  select * from (values
    ('00000000-0000-0000-0000-000000000201'::uuid, 'Ava',  'Reed',   '+15550000001', '1992-01-03'::date, 'ava.reed@example.com',  'active'::public.user_state, '00000000-0000-0000-0000-000000000101'::uuid),
    ('00000000-0000-0000-0000-000000000202'::uuid, 'Ben',  'Hale',   '+15550000002', '1990-05-12'::date, 'ben.hale@example.com',  'active'::public.user_state, '00000000-0000-0000-0000-000000000101'::uuid),
    ('00000000-0000-0000-0000-000000000203'::uuid, 'Cora', 'Lin',    '+15550000003', '1993-08-21'::date, 'cora.lin@example.com',  'active'::public.user_state, '00000000-0000-0000-0000-000000000101'::uuid),
    ('00000000-0000-0000-0000-000000000204'::uuid, 'Dean', 'Park',   '+15550000004', '1989-11-09'::date, 'dean.park@example.com', 'active'::public.user_state, '00000000-0000-0000-0000-000000000101'::uuid),
    ('00000000-0000-0000-0000-000000000205'::uuid, 'Eli',  'Stone',  '+15550000005', '1991-02-17'::date, 'eli.stone@example.com', 'active'::public.user_state, '00000000-0000-0000-0000-000000000101'::uuid),
    ('00000000-0000-0000-0000-000000000206'::uuid, 'Faye', 'Cruz',   '+15550000006', '1994-06-30'::date, 'faye.cruz@example.com', 'interviewing'::public.user_state, '00000000-0000-0000-0000-000000000101'::uuid),
    ('00000000-0000-0000-0000-000000000207'::uuid, 'Gus',  'Kim',    '+15550000007', '1988-12-01'::date, 'gus.kim@example.com',   'active'::public.user_state, '00000000-0000-0000-0000-000000000101'::uuid),
    ('00000000-0000-0000-0000-000000000208'::uuid, 'Hana', 'Ortiz',  '+15550000008', '1995-04-25'::date, 'hana.ortiz@example.com','verified'::public.user_state, '00000000-0000-0000-0000-000000000101'::uuid),
    ('00000000-0000-0000-0000-000000000209'::uuid, 'Ivy',  'Brooks', '+15550000009', '1992-09-14'::date, 'ivy.brooks@example.com','verified'::public.user_state, '00000000-0000-0000-0000-000000000102'::uuid),
    ('00000000-0000-0000-0000-000000000210'::uuid, 'Jay',  'Malik',  '+15550000010', '1990-10-19'::date, 'jay.malik@example.com', 'interviewing'::public.user_state, '00000000-0000-0000-0000-000000000102'::uuid),
    ('00000000-0000-0000-0000-000000000211'::uuid, 'Kai',  'Turner', '+15550000011', '1987-03-06'::date, 'kai.turner@example.com','verified'::public.user_state, '00000000-0000-0000-0000-000000000102'::uuid),
    ('00000000-0000-0000-0000-000000000212'::uuid, 'Lila', 'Chen',   '+15550000012', '1991-07-08'::date, 'lila.chen@example.com', 'verified'::public.user_state, '00000000-0000-0000-0000-000000000102'::uuid)
  ) as t(id, first_name, last_name, phone_e164, birthday, email, state, region_id)
)
insert into public.users (
  id,
  phone_e164,
  phone_hash,
  first_name,
  last_name,
  birthday,
  email,
  state,
  sms_consent,
  age_consent,
  terms_consent,
  privacy_consent,
  region_id
)
select
  id,
  phone_e164,
  encode(digest(phone_e164, 'sha256'), 'hex'),
  first_name,
  last_name,
  birthday,
  email,
  state,
  true,
  true,
  true,
  true,
  region_id
from seed_users
on conflict (id) do update set
  phone_e164 = excluded.phone_e164,
  phone_hash = excluded.phone_hash,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  birthday = excluded.birthday,
  email = excluded.email,
  state = excluded.state,
  sms_consent = excluded.sms_consent,
  age_consent = excluded.age_consent,
  terms_consent = excluded.terms_consent,
  privacy_consent = excluded.privacy_consent,
  region_id = excluded.region_id;

-- Region memberships
insert into public.region_memberships (
  id,
  user_id,
  region_id,
  status,
  joined_at
) values
  ('00000000-0000-0000-0000-000000000401'::uuid, '00000000-0000-0000-0000-000000000201'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'active',     '2026-01-02 12:00:00+00'),
  ('00000000-0000-0000-0000-000000000402'::uuid, '00000000-0000-0000-0000-000000000202'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'active',     '2026-01-02 12:00:00+00'),
  ('00000000-0000-0000-0000-000000000403'::uuid, '00000000-0000-0000-0000-000000000203'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'active',     '2026-01-02 12:00:00+00'),
  ('00000000-0000-0000-0000-000000000404'::uuid, '00000000-0000-0000-0000-000000000204'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'active',     '2026-01-02 12:00:00+00'),
  ('00000000-0000-0000-0000-000000000405'::uuid, '00000000-0000-0000-0000-000000000205'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'active',     '2026-01-02 12:00:00+00'),
  ('00000000-0000-0000-0000-000000000406'::uuid, '00000000-0000-0000-0000-000000000206'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'active',     '2026-01-02 12:00:00+00'),
  ('00000000-0000-0000-0000-000000000407'::uuid, '00000000-0000-0000-0000-000000000207'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'active',     '2026-01-02 12:00:00+00'),
  ('00000000-0000-0000-0000-000000000408'::uuid, '00000000-0000-0000-0000-000000000208'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'active',     '2026-01-02 12:00:00+00'),
  ('00000000-0000-0000-0000-000000000409'::uuid, '00000000-0000-0000-0000-000000000209'::uuid, '00000000-0000-0000-0000-000000000102'::uuid, 'waitlisted', '2026-01-02 12:00:00+00'),
  ('00000000-0000-0000-0000-000000000410'::uuid, '00000000-0000-0000-0000-000000000210'::uuid, '00000000-0000-0000-0000-000000000102'::uuid, 'waitlisted', '2026-01-02 12:00:00+00'),
  ('00000000-0000-0000-0000-000000000411'::uuid, '00000000-0000-0000-0000-000000000211'::uuid, '00000000-0000-0000-0000-000000000102'::uuid, 'waitlisted', '2026-01-02 12:00:00+00'),
  ('00000000-0000-0000-0000-000000000412'::uuid, '00000000-0000-0000-0000-000000000212'::uuid, '00000000-0000-0000-0000-000000000102'::uuid, 'waitlisted', '2026-01-02 12:00:00+00')
on conflict (id) do update set
  user_id = excluded.user_id,
  region_id = excluded.region_id,
  status = excluded.status,
  joined_at = excluded.joined_at,
  released_at = excluded.released_at;

-- Waitlist entries (closed region)
insert into public.waitlist_entries (
  id,
  profile_id,
  user_id,
  region_id,
  status,
  joined_at,
  onboarded_at,
  source,
  reason
) values
  ('00000000-0000-0000-0000-000000000901'::uuid, '00000000-0000-0000-0000-000000000309'::uuid, '00000000-0000-0000-0000-000000000209'::uuid, '00000000-0000-0000-0000-000000000102'::uuid, 'waiting',   '2026-01-03 16:00:00+00', null,                    'seed', 'region_not_supported'),
  ('00000000-0000-0000-0000-000000000902'::uuid, '00000000-0000-0000-0000-000000000310'::uuid, '00000000-0000-0000-0000-000000000210'::uuid, '00000000-0000-0000-0000-000000000102'::uuid, 'onboarded', '2026-01-03 16:00:00+00', '2026-01-04 10:00:00+00', 'seed', 'region_not_supported'),
  ('00000000-0000-0000-0000-000000000903'::uuid, '00000000-0000-0000-0000-000000000311'::uuid, '00000000-0000-0000-0000-000000000211'::uuid, '00000000-0000-0000-0000-000000000102'::uuid, 'waiting',   '2026-01-03 16:00:00+00', null,                    'seed', 'region_not_supported'),
  ('00000000-0000-0000-0000-000000000904'::uuid, '00000000-0000-0000-0000-000000000312'::uuid, '00000000-0000-0000-0000-000000000212'::uuid, '00000000-0000-0000-0000-000000000102'::uuid, 'onboarded', '2026-01-03 16:00:00+00', '2026-01-04 10:00:00+00', 'seed', 'region_not_supported')
on conflict (profile_id) do update set
  user_id = excluded.user_id,
  region_id = excluded.region_id,
  status = excluded.status,
  joined_at = excluded.joined_at,
  onboarded_at = excluded.onboarded_at,
  notified_at = excluded.notified_at,
  activated_at = excluded.activated_at,
  source = excluded.source,
  reason = excluded.reason;

-- Profiles
with profile_templates as (
  select * from (values
    (
      'template_complete_a',
      'complete_mvp'::public.profile_state,
      '{
        "connection_depth":{"range_value":0.72,"confidence":0.64,"freshness_days":3,"sources":{"interview":0.9}},
        "social_energy":{"range_value":0.6,"confidence":0.6,"freshness_days":5,"sources":{"interview":0.8}},
        "social_pace":{"range_value":0.42,"confidence":0.58,"freshness_days":8,"sources":{"interview":0.7}},
        "novelty_seeking":{"range_value":0.55,"confidence":0.6,"freshness_days":7,"sources":{"interview":0.8}},
        "structure_preference":{"range_value":0.48,"confidence":0.57,"freshness_days":6,"sources":{"interview":0.7}},
        "humor_style":{"range_value":0.66,"confidence":0.6,"freshness_days":9,"sources":{"interview":0.7}},
        "conversation_style":{"range_value":0.7,"confidence":0.62,"freshness_days":6,"sources":{"interview":0.8}},
        "emotional_directness":{"range_value":0.58,"confidence":0.6,"freshness_days":6,"sources":{"interview":0.7}},
        "adventure_comfort":{"range_value":0.52,"confidence":0.57,"freshness_days":10,"sources":{"interview":0.7}},
        "conflict_tolerance":{"range_value":0.46,"confidence":0.56,"freshness_days":12,"sources":{"interview":0.6}},
        "values_alignment_importance":{"range_value":0.68,"confidence":0.6,"freshness_days":5,"sources":{"interview":0.8}},
        "group_vs_1on1_preference":{"range_value":0.5,"confidence":0.59,"freshness_days":6,"sources":{"interview":0.7}}
      }'::jsonb,
      '[
        {"activity_key":"coffee","motive_weights":{"connection":0.7,"comfort":0.6},"constraints":{"quiet":true,"indoor":true},"preferred_windows":["morning","day"],"confidence":0.72,"freshness_days":5},
        {"activity_key":"walk","motive_weights":{"comfort":0.5,"restorative":0.6},"constraints":{"outdoor":true},"preferred_windows":["day","weekend"],"confidence":0.68,"freshness_days":7},
        {"activity_key":"museum","motive_weights":{"growth":0.6,"connection":0.4},"constraints":{"indoor":true},"preferred_windows":["afternoon"],"confidence":0.62,"freshness_days":9}
      ]'::jsonb,
      '{"no_thanks":["bars"],"hard_constraints":{"smoking":false,"late_night":true},"social_safety":["meet_public","daytime_only"]}'::jsonb,
      '{"group_size_pref":{"min":2,"max":5},"time_preferences":["morning","weekend"],"noise_sensitivity":0.4,"outdoor_preference":0.6,"planning_style":"balanced"}'::jsonb,
      'wrap_01',
      '2026-01-06 10:00:00+00'::timestamptz
    ),
    (
      'template_complete_b',
      'complete_mvp'::public.profile_state,
      '{
        "connection_depth":{"range_value":0.6,"confidence":0.62,"freshness_days":4,"sources":{"interview":0.8}},
        "social_energy":{"range_value":0.52,"confidence":0.58,"freshness_days":6,"sources":{"interview":0.7}},
        "social_pace":{"range_value":0.5,"confidence":0.6,"freshness_days":7,"sources":{"interview":0.7}},
        "novelty_seeking":{"range_value":0.68,"confidence":0.6,"freshness_days":8,"sources":{"interview":0.8}},
        "structure_preference":{"range_value":0.4,"confidence":0.55,"freshness_days":7,"sources":{"interview":0.7}},
        "humor_style":{"range_value":0.58,"confidence":0.58,"freshness_days":7,"sources":{"interview":0.7}},
        "conversation_style":{"range_value":0.62,"confidence":0.6,"freshness_days":7,"sources":{"interview":0.7}},
        "emotional_directness":{"range_value":0.5,"confidence":0.56,"freshness_days":9,"sources":{"interview":0.6}},
        "adventure_comfort":{"range_value":0.66,"confidence":0.62,"freshness_days":9,"sources":{"interview":0.8}},
        "conflict_tolerance":{"range_value":0.5,"confidence":0.55,"freshness_days":11,"sources":{"interview":0.6}},
        "values_alignment_importance":{"range_value":0.62,"confidence":0.6,"freshness_days":7,"sources":{"interview":0.7}},
        "group_vs_1on1_preference":{"range_value":0.58,"confidence":0.6,"freshness_days":6,"sources":{"interview":0.7}}
      }'::jsonb,
      '[
        {"activity_key":"brunch","motive_weights":{"connection":0.6,"play":0.5},"constraints":{"indoor":true},"preferred_windows":["morning","weekend"],"confidence":0.7,"freshness_days":6},
        {"activity_key":"hike","motive_weights":{"adventure":0.7,"growth":0.4},"constraints":{"outdoor":true},"preferred_windows":["weekend"],"confidence":0.66,"freshness_days":8},
        {"activity_key":"games","motive_weights":{"play":0.7,"comfort":0.4},"constraints":{"indoor":true},"preferred_windows":["evening"],"confidence":0.6,"freshness_days":10}
      ]'::jsonb,
      '{"no_thanks":["late_night"],"hard_constraints":{"smoking":false},"social_safety":["meet_public"]}'::jsonb,
      '{"group_size_pref":{"min":3,"max":6},"time_preferences":["evening","weekend"],"noise_sensitivity":0.3,"outdoor_preference":0.7,"planning_style":"planned"}'::jsonb,
      'wrap_01',
      '2026-01-06 11:00:00+00'::timestamptz
    ),
    (
      'template_partial',
      'partial'::public.profile_state,
      '{
        "connection_depth":{"range_value":0.55,"confidence":0.4,"freshness_days":2,"sources":{"interview":0.5}},
        "social_energy":{"range_value":0.48,"confidence":0.42,"freshness_days":2,"sources":{"interview":0.5}},
        "social_pace":{"range_value":0.5,"confidence":0.45,"freshness_days":2,"sources":{"interview":0.5}}
      }'::jsonb,
      '[
        {"activity_key":"coffee","motive_weights":{"comfort":0.5},"constraints":{"quiet":true},"preferred_windows":["morning"],"confidence":0.48,"freshness_days":2}
      ]'::jsonb,
      '{"no_thanks":[],"hard_constraints":{}}'::jsonb,
      '{"group_size_pref":{"min":2,"max":4},"time_preferences":["morning"],"planning_style":"balanced"}'::jsonb,
      'style_01',
      null
    )
  ) as t(template_key, state, fingerprint, activity_patterns, boundaries, preferences, last_step, completed_at)
),
profiles_seed as (
  select * from (values
    ('00000000-0000-0000-0000-000000000301'::uuid, '00000000-0000-0000-0000-000000000201'::uuid, 'template_complete_a'),
    ('00000000-0000-0000-0000-000000000302'::uuid, '00000000-0000-0000-0000-000000000202'::uuid, 'template_complete_a'),
    ('00000000-0000-0000-0000-000000000303'::uuid, '00000000-0000-0000-0000-000000000203'::uuid, 'template_complete_b'),
    ('00000000-0000-0000-0000-000000000304'::uuid, '00000000-0000-0000-0000-000000000204'::uuid, 'template_complete_a'),
    ('00000000-0000-0000-0000-000000000305'::uuid, '00000000-0000-0000-0000-000000000205'::uuid, 'template_complete_b'),
    ('00000000-0000-0000-0000-000000000306'::uuid, '00000000-0000-0000-0000-000000000206'::uuid, 'template_partial'),
    ('00000000-0000-0000-0000-000000000307'::uuid, '00000000-0000-0000-0000-000000000207'::uuid, 'template_complete_b'),
    ('00000000-0000-0000-0000-000000000308'::uuid, '00000000-0000-0000-0000-000000000208'::uuid, 'template_partial'),
    ('00000000-0000-0000-0000-000000000309'::uuid, '00000000-0000-0000-0000-000000000209'::uuid, 'template_partial'),
    ('00000000-0000-0000-0000-000000000310'::uuid, '00000000-0000-0000-0000-000000000210'::uuid, 'template_partial'),
    ('00000000-0000-0000-0000-000000000311'::uuid, '00000000-0000-0000-0000-000000000211'::uuid, 'template_partial'),
    ('00000000-0000-0000-0000-000000000312'::uuid, '00000000-0000-0000-0000-000000000212'::uuid, 'template_partial')
  ) as t(id, user_id, template_key)
)
insert into public.profiles (
  id,
  user_id,
  state,
  fingerprint,
  activity_patterns,
  boundaries,
  preferences,
  last_interview_step,
  completed_at
)
select
  p.id,
  p.user_id,
  t.state,
  t.fingerprint,
  t.activity_patterns,
  t.boundaries,
  t.preferences,
  t.last_step,
  t.completed_at
from profiles_seed p
join profile_templates t on t.template_key = p.template_key
on conflict (id) do update set
  user_id = excluded.user_id,
  state = excluded.state,
  fingerprint = excluded.fingerprint,
  activity_patterns = excluded.activity_patterns,
  boundaries = excluded.boundaries,
  preferences = excluded.preferences,
  last_interview_step = excluded.last_interview_step,
  completed_at = excluded.completed_at;

-- Conversation sessions (sample)
insert into public.conversation_sessions (
  id,
  user_id,
  mode,
  state_token,
  last_inbound_message_sid
) values
  ('00000000-0000-0000-0000-000000000501'::uuid, '00000000-0000-0000-0000-000000000201'::uuid, 'idle',              'idle',             null),
  ('00000000-0000-0000-0000-000000000502'::uuid, '00000000-0000-0000-0000-000000000204'::uuid, 'awaiting_invite_reply', 'invite_reply',  null),
  ('00000000-0000-0000-0000-000000000503'::uuid, '00000000-0000-0000-0000-000000000206'::uuid, 'interviewing',      'style_01',         null),
  ('00000000-0000-0000-0000-000000000504'::uuid, '00000000-0000-0000-0000-000000000210'::uuid, 'interviewing',      'activity_02',      null)
on conflict (id) do update set
  user_id = excluded.user_id,
  mode = excluded.mode,
  state_token = excluded.state_token,
  last_inbound_message_sid = excluded.last_inbound_message_sid;

-- Sample SMS messages (optional)
insert into public.sms_messages (
  id,
  user_id,
  direction,
  from_e164,
  to_e164,
  twilio_message_sid,
  status
) values
  ('00000000-0000-0000-0000-000000000601'::uuid, '00000000-0000-0000-0000-000000000201'::uuid, 'in',  '+15550000001', '+15551112222', 'SMseed0001', 'received'),
  ('00000000-0000-0000-0000-000000000602'::uuid, '00000000-0000-0000-0000-000000000201'::uuid, 'out', '+15551112222', '+15550000001', 'SMseed0002', 'sent')
on conflict (id) do update set
  user_id = excluded.user_id,
  direction = excluded.direction,
  from_e164 = excluded.from_e164,
  to_e164 = excluded.to_e164,
  twilio_message_sid = excluded.twilio_message_sid,
  status = excluded.status;

-- LinkUps
insert into public.linkups (
  id,
  initiator_user_id,
  region_id,
  state,
  brief,
  acceptance_window_ends_at,
  event_time,
  venue,
  min_size,
  max_size,
  lock_version,
  locked_at,
  linkup_create_key
) values
  (
    '00000000-0000-0000-0000-000000000701'::uuid,
    '00000000-0000-0000-0000-000000000204'::uuid,
    '00000000-0000-0000-0000-000000000101'::uuid,
    'completed',
    '{"activity_key":"coffee","activity_label":"Coffee","time_window":"SAT_MORNING","time_window_options":["SAT_MORNING","SAT_AFTERNOON"],"region_id":"00000000-0000-0000-0000-000000000101","radius_miles":5,"constraints":{"quiet":true,"indoor":true},"motive_emphasis":{"connection":0.7,"comfort":0.6},"group_size":{"min":2,"max":6},"location_hint":"Oakland"}'::jsonb,
    '2026-01-08 18:00:00+00',
    '2026-01-12 17:00:00+00',
    '{"suggestion":"Coffee shop near Oakland"}'::jsonb,
    2,
    6,
    1,
    '2026-01-08 20:00:00+00',
    'seed-linkup-001'
  ),
  (
    '00000000-0000-0000-0000-000000000702'::uuid,
    '00000000-0000-0000-0000-000000000205'::uuid,
    '00000000-0000-0000-0000-000000000101'::uuid,
    'expired',
    '{"activity_key":"museum","activity_label":"Museum","time_window":"SUN_AFTERNOON","region_id":"00000000-0000-0000-0000-000000000101","radius_miles":8,"constraints":{"indoor":true},"motive_emphasis":{"growth":0.6},"group_size":{"min":2,"max":5},"location_hint":"SF"}'::jsonb,
    '2026-01-05 18:00:00+00',
    null,
    null,
    2,
    5,
    0,
    null,
    'seed-linkup-002'
  )
on conflict (id) do update set
  initiator_user_id = excluded.initiator_user_id,
  region_id = excluded.region_id,
  state = excluded.state,
  brief = excluded.brief,
  acceptance_window_ends_at = excluded.acceptance_window_ends_at,
  event_time = excluded.event_time,
  venue = excluded.venue,
  min_size = excluded.min_size,
  max_size = excluded.max_size,
  lock_version = excluded.lock_version,
  locked_at = excluded.locked_at,
  linkup_create_key = excluded.linkup_create_key;

-- LinkUp events
insert into public.linkup_events (
  id,
  linkup_id,
  event_type,
  from_state,
  to_state,
  idempotency_key,
  payload
) values
  ('00000000-0000-0000-0000-000000001101'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, 'broadcast_started', 'draft', 'broadcasting', 'seed-linkup-001-broadcast', '{"wave":1}'::jsonb),
  ('00000000-0000-0000-0000-000000001102'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, 'locked',           'broadcasting', 'locked',      'seed-linkup-001-locked',    '{"accepted":3}'::jsonb),
  ('00000000-0000-0000-0000-000000001103'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, 'completed',        'locked', 'completed',         'seed-linkup-001-completed', '{"outcomes":4}'::jsonb),
  ('00000000-0000-0000-0000-000000001104'::uuid, '00000000-0000-0000-0000-000000000702'::uuid, 'expired',          'broadcasting', 'expired',     'seed-linkup-002-expired',   '{"reason":"timeout"}'::jsonb)
on conflict (id) do update set
  linkup_id = excluded.linkup_id,
  event_type = excluded.event_type,
  from_state = excluded.from_state,
  to_state = excluded.to_state,
  idempotency_key = excluded.idempotency_key,
  payload = excluded.payload;

-- LinkUp invites
insert into public.linkup_invites (
  id,
  linkup_id,
  invited_user_id,
  state,
  offered_options,
  selected_option,
  sent_at,
  responded_at,
  expires_at,
  idempotency_key,
  explainability
) values
  ('00000000-0000-0000-0000-000000000801'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, '00000000-0000-0000-0000-000000000201'::uuid, 'accepted', '{"options":["SAT_MORNING","SAT_AFTERNOON"]}'::jsonb, 'SAT_MORNING', '2026-01-08 18:10:00+00', '2026-01-08 18:30:00+00', '2026-01-09 18:00:00+00', 'seed-invite-001', '{"friend_score":0.71,"moment_fit":0.66,"final_score":0.69,"filters":{"passed":["region","entitled"],"failed":[]},"top_reasons":["shared comfort motive"]}'::jsonb),
  ('00000000-0000-0000-0000-000000000802'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, '00000000-0000-0000-0000-000000000202'::uuid, 'accepted', '{"options":["SAT_MORNING","SAT_AFTERNOON"]}'::jsonb, 'SAT_MORNING', '2026-01-08 18:12:00+00', '2026-01-08 18:45:00+00', '2026-01-09 18:00:00+00', 'seed-invite-002', '{"friend_score":0.7,"moment_fit":0.64,"final_score":0.68,"filters":{"passed":["region","entitled"],"failed":[]},"top_reasons":["similar social pace"]}'::jsonb),
  ('00000000-0000-0000-0000-000000000803'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, '00000000-0000-0000-0000-000000000203'::uuid, 'accepted', '{"options":["SAT_MORNING","SAT_AFTERNOON"]}'::jsonb, 'SAT_MORNING', '2026-01-08 18:15:00+00', '2026-01-08 19:00:00+00', '2026-01-09 18:00:00+00', 'seed-invite-003', '{"friend_score":0.73,"moment_fit":0.65,"final_score":0.7,"filters":{"passed":["region","entitled"],"failed":[]},"top_reasons":["shared connection motive"]}'::jsonb),
  ('00000000-0000-0000-0000-000000000804'::uuid, '00000000-0000-0000-0000-000000000702'::uuid, '00000000-0000-0000-0000-000000000206'::uuid, 'declined', '{"options":["SUN_AFTERNOON"]}'::jsonb, null,        '2026-01-04 18:10:00+00', '2026-01-04 19:00:00+00', '2026-01-05 18:00:00+00', 'seed-invite-004', '{"friend_score":0.6,"moment_fit":0.5,"final_score":0.55,"filters":{"passed":["region"],"failed":["schedule"]},"top_reasons":["low time fit"]}'::jsonb),
  ('00000000-0000-0000-0000-000000000805'::uuid, '00000000-0000-0000-0000-000000000702'::uuid, '00000000-0000-0000-0000-000000000207'::uuid, 'pending',  '{"options":["SUN_AFTERNOON"]}'::jsonb, null,        '2026-01-04 18:12:00+00', null,                     '2026-01-05 18:00:00+00', 'seed-invite-005', '{"friend_score":0.58,"moment_fit":0.52,"final_score":0.55,"filters":{"passed":["region"],"failed":[]},"top_reasons":["shared growth motive"]}'::jsonb)
on conflict (id) do update set
  linkup_id = excluded.linkup_id,
  invited_user_id = excluded.invited_user_id,
  state = excluded.state,
  offered_options = excluded.offered_options,
  selected_option = excluded.selected_option,
  sent_at = excluded.sent_at,
  responded_at = excluded.responded_at,
  expires_at = excluded.expires_at,
  idempotency_key = excluded.idempotency_key,
  explainability = excluded.explainability;

-- LinkUp participants (successful linkup)
insert into public.linkup_participants (
  id,
  linkup_id,
  user_id,
  role,
  status,
  joined_at
) values
  ('00000000-0000-0000-0000-000000000901'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, '00000000-0000-0000-0000-000000000204'::uuid, 'initiator',   'confirmed', '2026-01-08 20:00:00+00'),
  ('00000000-0000-0000-0000-000000000902'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, '00000000-0000-0000-0000-000000000201'::uuid, 'participant', 'confirmed', '2026-01-08 20:00:00+00'),
  ('00000000-0000-0000-0000-000000000903'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, '00000000-0000-0000-0000-000000000202'::uuid, 'participant', 'confirmed', '2026-01-08 20:00:00+00'),
  ('00000000-0000-0000-0000-000000000904'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, '00000000-0000-0000-0000-000000000203'::uuid, 'participant', 'confirmed', '2026-01-08 20:00:00+00')
on conflict (id) do update set
  linkup_id = excluded.linkup_id,
  user_id = excluded.user_id,
  role = excluded.role,
  status = excluded.status,
  joined_at = excluded.joined_at,
  left_at = excluded.left_at;

-- LinkUp outcomes (post-event)
insert into public.linkup_outcomes (
  id,
  linkup_id,
  user_id,
  attendance_response,
  do_again,
  feedback
) values
  ('00000000-0000-0000-0000-000000001001'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, '00000000-0000-0000-0000-000000000204'::uuid, 'attended', true,  'Great group. Morning worked well.'),
  ('00000000-0000-0000-0000-000000001002'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, '00000000-0000-0000-0000-000000000201'::uuid, 'attended', true,  'Would do this again.'),
  ('00000000-0000-0000-0000-000000001003'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, '00000000-0000-0000-0000-000000000202'::uuid, 'attended', true,  null),
  ('00000000-0000-0000-0000-000000001004'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, '00000000-0000-0000-0000-000000000203'::uuid, 'unsure',   false, 'Busy schedule this week.')
on conflict (id) do update set
  linkup_id = excluded.linkup_id,
  user_id = excluded.user_id,
  attendance_response = excluded.attendance_response,
  do_again = excluded.do_again,
  feedback = excluded.feedback;

-- Contact exchange choices + mutual exchange
insert into public.contact_exchange_choices (
  id,
  linkup_id,
  chooser_user_id,
  target_user_id,
  choice,
  captured_at
) values
  ('00000000-0000-0000-0000-000000001201'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, '00000000-0000-0000-0000-000000000201'::uuid, '00000000-0000-0000-0000-000000000202'::uuid, true,  '2026-01-12 20:00:00+00'),
  ('00000000-0000-0000-0000-000000001202'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, '00000000-0000-0000-0000-000000000202'::uuid, '00000000-0000-0000-0000-000000000201'::uuid, true,  '2026-01-12 20:05:00+00'),
  ('00000000-0000-0000-0000-000000001203'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, '00000000-0000-0000-0000-000000000201'::uuid, '00000000-0000-0000-0000-000000000203'::uuid, false, '2026-01-12 20:00:00+00'),
  ('00000000-0000-0000-0000-000000001204'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, '00000000-0000-0000-0000-000000000203'::uuid, '00000000-0000-0000-0000-000000000201'::uuid, false, '2026-01-12 20:05:00+00')
on conflict (id) do update set
  linkup_id = excluded.linkup_id,
  chooser_user_id = excluded.chooser_user_id,
  target_user_id = excluded.target_user_id,
  choice = excluded.choice,
  captured_at = excluded.captured_at;

insert into public.contact_exchanges (
  id,
  linkup_id,
  user_a_id,
  user_b_id,
  revealed_at
) values
  ('00000000-0000-0000-0000-000000001301'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, '00000000-0000-0000-0000-000000000201'::uuid, '00000000-0000-0000-0000-000000000202'::uuid, '2026-01-12 20:10:00+00')
on conflict (id) do update set
  linkup_id = excluded.linkup_id,
  user_a_id = excluded.user_a_id,
  user_b_id = excluded.user_b_id,
  revealed_at = excluded.revealed_at;

-- Entitlements
insert into public.entitlements (
  id,
  user_id,
  can_receive_intro,
  can_initiate_linkup,
  can_participate_linkup,
  intro_credits_remaining,
  linkup_credits_remaining,
  source,
  computed_at
) values
  ('00000000-0000-0000-0000-000000001401'::uuid, '00000000-0000-0000-0000-000000000201'::uuid, true,  true,  true,  3, 1, 'stripe', '2026-01-06 09:00:00+00'),
  ('00000000-0000-0000-0000-000000001402'::uuid, '00000000-0000-0000-0000-000000000202'::uuid, true,  true,  true,  3, 1, 'stripe', '2026-01-06 09:00:00+00'),
  ('00000000-0000-0000-0000-000000001403'::uuid, '00000000-0000-0000-0000-000000000203'::uuid, true,  true,  true,  3, 1, 'stripe', '2026-01-06 09:00:00+00'),
  ('00000000-0000-0000-0000-000000001404'::uuid, '00000000-0000-0000-0000-000000000204'::uuid, true,  true,  true,  3, 1, 'stripe', '2026-01-06 09:00:00+00'),
  ('00000000-0000-0000-0000-000000001405'::uuid, '00000000-0000-0000-0000-000000000205'::uuid, true,  true,  true,  3, 1, 'stripe', '2026-01-06 09:00:00+00'),
  ('00000000-0000-0000-0000-000000001406'::uuid, '00000000-0000-0000-0000-000000000206'::uuid, true,  false, true,  1, 0, 'stripe', '2026-01-06 09:00:00+00'),
  ('00000000-0000-0000-0000-000000001407'::uuid, '00000000-0000-0000-0000-000000000207'::uuid, true,  true,  true,  2, 1, 'stripe', '2026-01-06 09:00:00+00'),
  ('00000000-0000-0000-0000-000000001408'::uuid, '00000000-0000-0000-0000-000000000208'::uuid, false, false, false, 0, 0, 'stripe', '2026-01-06 09:00:00+00'),
  ('00000000-0000-0000-0000-000000001409'::uuid, '00000000-0000-0000-0000-000000000209'::uuid, true,  true,  true,  1, 1, 'stripe', '2026-01-06 09:00:00+00'),
  ('00000000-0000-0000-0000-000000001410'::uuid, '00000000-0000-0000-0000-000000000210'::uuid, true,  true,  true,  1, 1, 'stripe', '2026-01-06 09:00:00+00'),
  ('00000000-0000-0000-0000-000000001411'::uuid, '00000000-0000-0000-0000-000000000211'::uuid, true,  true,  true,  1, 1, 'stripe', '2026-01-06 09:00:00+00'),
  ('00000000-0000-0000-0000-000000001412'::uuid, '00000000-0000-0000-0000-000000000212'::uuid, false, false, false, 0, 0, 'stripe', '2026-01-06 09:00:00+00')
on conflict (id) do update set
  user_id = excluded.user_id,
  can_receive_intro = excluded.can_receive_intro,
  can_initiate_linkup = excluded.can_initiate_linkup,
  can_participate_linkup = excluded.can_participate_linkup,
  intro_credits_remaining = excluded.intro_credits_remaining,
  linkup_credits_remaining = excluded.linkup_credits_remaining,
  source = excluded.source,
  computed_at = excluded.computed_at;

-- Safety hold (active)
insert into public.safety_holds (
  id,
  user_id,
  hold_type,
  reason,
  status,
  created_at,
  expires_at,
  idempotency_key
) values
  ('00000000-0000-0000-0000-000000001501'::uuid, '00000000-0000-0000-0000-000000000212'::uuid, 'global_hold', 'seed_hold_example', 'active', '2026-01-07 09:00:00+00', null, 'seed-hold-001')
on conflict (id) do update set
  user_id = excluded.user_id,
  hold_type = excluded.hold_type,
  reason = excluded.reason,
  status = excluded.status,
  created_at = excluded.created_at,
  expires_at = excluded.expires_at,
  idempotency_key = excluded.idempotency_key;

-- Block pair
insert into public.user_blocks (
  id,
  blocker_user_id,
  blocked_user_id,
  created_at
) values
  ('00000000-0000-0000-0000-000000001601'::uuid, '00000000-0000-0000-0000-000000000207'::uuid, '00000000-0000-0000-0000-000000000205'::uuid, '2026-01-09 12:00:00+00')
on conflict (id) do update set
  blocker_user_id = excluded.blocker_user_id,
  blocked_user_id = excluded.blocked_user_id,
  created_at = excluded.created_at;

-- Optional safety incident
insert into public.safety_incidents (
  id,
  severity,
  category,
  reporter_user_id,
  subject_user_id,
  description,
  status,
  idempotency_key
) values
  ('00000000-0000-0000-0000-000000001701'::uuid, 'high', 'harassment', '00000000-0000-0000-0000-000000000201'::uuid, '00000000-0000-0000-0000-000000000212'::uuid, 'Seed incident example', 'open', 'seed-incident-001')
on conflict (id) do update set
  severity = excluded.severity,
  category = excluded.category,
  reporter_user_id = excluded.reporter_user_id,
  subject_user_id = excluded.subject_user_id,
  description = excluded.description,
  status = excluded.status,
  idempotency_key = excluded.idempotency_key;

commit;
