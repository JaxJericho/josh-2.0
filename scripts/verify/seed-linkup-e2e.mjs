import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const E2E_REGION_ID = "77777777-7777-4777-8777-777777777702";
const E2E_INITIATOR_USER_ID = "77777777-7777-4777-8777-777777777821";
const E2E_CANDIDATE_A_USER_ID = "77777777-7777-4777-8777-777777777822";
const E2E_CANDIDATE_B_USER_ID = "77777777-7777-4777-8777-777777777823";
const E2E_CANDIDATE_C_USER_ID = "77777777-7777-4777-8777-777777777824";
const E2E_CANDIDATE_D_USER_ID = "77777777-7777-4777-8777-777777777825";

const E2E_INITIATOR_PROFILE_ID = "c7777777-7777-4777-8777-777777777821";
const E2E_CANDIDATE_A_PROFILE_ID = "c7777777-7777-4777-8777-777777777822";
const E2E_CANDIDATE_B_PROFILE_ID = "c7777777-7777-4777-8777-777777777823";
const E2E_CANDIDATE_C_PROFILE_ID = "c7777777-7777-4777-8777-777777777824";
const E2E_CANDIDATE_D_PROFILE_ID = "c7777777-7777-4777-8777-777777777825";

const SEED_USER_IDS = [
  E2E_CANDIDATE_A_USER_ID,
  E2E_CANDIDATE_B_USER_ID,
  E2E_CANDIDATE_D_USER_ID,
  E2E_CANDIDATE_C_USER_ID,
];

const SEED_SCORES = [0.93, 0.88, 0.84, 0.80];

loadDotEnv(".env.local");

const stagingDbDsn = requiredEnvAny(["STAGING_DB_DSN", "STAGING_DB_URL"]);
const createKey = `ticket_7_2_linkup_e2e_${Date.now()}`;

runPsqlMutation({
  dsn: stagingDbDsn,
  sql: buildSeedSql(),
});

const createResultRaw = querySingleValue({
  dsn: stagingDbDsn,
  sql: `
    select public.linkup_create_from_seed(
      '${E2E_INITIATOR_USER_ID}'::uuid,
      '${E2E_REGION_ID}'::uuid,
      jsonb_build_object(
        'activity_key', 'coffee',
        'activity_label', 'Coffee',
        'time_window', 'SAT_MORNING',
        'time_window_options', jsonb_build_array('SAT_MORNING', 'SAT_AFTERNOON'),
        'region_id', '${E2E_REGION_ID}',
        'group_size', jsonb_build_object('min', 3, 'max', 4),
        'radius_miles', 5,
        'location_hint', 'Seattle'
      ),
      '${createKey}',
      array[
        '${SEED_USER_IDS[0]}'::uuid,
        '${SEED_USER_IDS[1]}'::uuid,
        '${SEED_USER_IDS[2]}'::uuid,
        '${SEED_USER_IDS[3]}'::uuid
      ],
      array[
        ${SEED_SCORES[0]}::double precision,
        ${SEED_SCORES[1]}::double precision,
        ${SEED_SCORES[2]}::double precision,
        ${SEED_SCORES[3]}::double precision
      ],
      null,
      3,
      array[3, 1, 1],
      now()
    )::text;
  `,
});

let createResult;
try {
  createResult = JSON.parse(createResultRaw);
} catch (error) {
  fail(`Unable to parse linkup_create_from_seed payload: ${createResultRaw}`);
}

const linkupId = createResult?.linkup_id;
if (!linkupId || typeof linkupId !== "string") {
  fail(`Missing linkup_id in create result: ${createResultRaw}`);
}

const initialState = querySingleValue({
  dsn: stagingDbDsn,
  sql: `
    select state::text
    from public.linkups
    where id = '${linkupId}'::uuid;
  `,
});

const waveOneInviteCount = querySingleValue({
  dsn: stagingDbDsn,
  sql: `
    select count(*)::text
    from public.linkup_invites
    where linkup_id = '${linkupId}'::uuid
      and wave_no = 1;
  `,
});

const inviteRows = querySingleValue({
  dsn: stagingDbDsn,
  sql: `
    select coalesce(
      string_agg(invited_user_id::text || ':' || wave_no::text || ':' || state::text, ';' order by wave_no, created_at, invited_user_id),
      ''
    )
    from public.linkup_invites
    where linkup_id = '${linkupId}'::uuid;
  `,
});

const outboundQueued = querySingleValue({
  dsn: stagingDbDsn,
  sql: `
    select count(*)::text
    from public.sms_outbound_jobs jobs
    where jobs.purpose = 'linkup_invite_wave'
      and jobs.idempotency_key like 'invite_sms:%'
      and exists (
        select 1
        from public.linkup_invites invites
        where invites.linkup_id = '${linkupId}'::uuid
          and jobs.idempotency_key = format('invite_sms:%s:v1', invites.id::text)
      );
  `,
});

console.log(`[seed-linkup-e2e] linkup_create_key=${createKey}`);
console.log(`[seed-linkup-e2e] linkup_id=${linkupId}`);
console.log(`[seed-linkup-e2e] linkup_state=${initialState}`);
console.log(`[seed-linkup-e2e] wave_1_invites=${waveOneInviteCount}`);
console.log(`[seed-linkup-e2e] outbound_jobs_queued=${outboundQueued}`);
console.log(`[seed-linkup-e2e] invite_rows=${encodeForSingleLine(inviteRows)}`);
console.log(`[seed-linkup-e2e] initiator_user_id=${E2E_INITIATOR_USER_ID}`);
console.log(`[seed-linkup-e2e] candidate_a_user_id=${E2E_CANDIDATE_A_USER_ID}`);
console.log(`[seed-linkup-e2e] candidate_b_user_id=${E2E_CANDIDATE_B_USER_ID}`);
console.log(`[seed-linkup-e2e] candidate_c_user_id=${E2E_CANDIDATE_C_USER_ID}`);
console.log(`[seed-linkup-e2e] candidate_d_user_id=${E2E_CANDIDATE_D_USER_ID}`);
console.log("[seed-linkup-e2e] done=true");

function buildSeedSql() {
  return `
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
    )
    values (
      '${E2E_REGION_ID}',
      'linkup-e2e-wa',
      'LinkUp E2E Region',
      'open',
      '{}'::jsonb,
      '{}'::jsonb,
      'LinkUp E2E Region',
      'US',
      'WA',
      true,
      true
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
      is_launch_region = excluded.is_launch_region,
      updated_at = now();

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
      region_id,
      deleted_at
    )
    values
      ('${E2E_INITIATOR_USER_ID}', '+15559772001', 'linkup_e2e_hash_1', 'Linkup', 'Initiator', '1991-01-01', null, 'active', true, true, true, true, '${E2E_REGION_ID}', null),
      ('${E2E_CANDIDATE_A_USER_ID}', '+15559772002', 'linkup_e2e_hash_2', 'Linkup', 'CandidateA', '1992-02-02', null, 'active', true, true, true, true, '${E2E_REGION_ID}', null),
      ('${E2E_CANDIDATE_B_USER_ID}', '+15559772003', 'linkup_e2e_hash_3', 'Linkup', 'CandidateB', '1993-03-03', null, 'active', true, true, true, true, '${E2E_REGION_ID}', null),
      ('${E2E_CANDIDATE_C_USER_ID}', '+15559772004', 'linkup_e2e_hash_4', 'Linkup', 'CandidateC', '1994-04-04', null, 'active', true, true, true, true, '${E2E_REGION_ID}', null),
      ('${E2E_CANDIDATE_D_USER_ID}', '+15559772005', 'linkup_e2e_hash_5', 'Linkup', 'CandidateD', '1995-05-05', null, 'active', true, true, true, true, '${E2E_REGION_ID}', null)
    on conflict (id) do update set
      state = excluded.state,
      region_id = excluded.region_id,
      deleted_at = null,
      updated_at = now();

    insert into public.profiles (
      id,
      user_id,
      state,
      fingerprint,
      activity_patterns,
      boundaries,
      preferences,
      active_intent,
      completed_at,
      is_complete_mvp,
      completeness_percent,
      state_changed_at
    )
    values
      ('${E2E_INITIATOR_PROFILE_ID}', '${E2E_INITIATOR_USER_ID}', 'complete_mvp', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, null, now(), true, 100, now()),
      ('${E2E_CANDIDATE_A_PROFILE_ID}', '${E2E_CANDIDATE_A_USER_ID}', 'complete_mvp', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, null, now(), true, 100, now()),
      ('${E2E_CANDIDATE_B_PROFILE_ID}', '${E2E_CANDIDATE_B_USER_ID}', 'complete_mvp', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, null, now(), true, 100, now()),
      ('${E2E_CANDIDATE_C_PROFILE_ID}', '${E2E_CANDIDATE_C_USER_ID}', 'complete_mvp', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, null, now(), true, 100, now()),
      ('${E2E_CANDIDATE_D_PROFILE_ID}', '${E2E_CANDIDATE_D_USER_ID}', 'complete_mvp', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, null, now(), true, 100, now())
    on conflict (user_id) do update set
      state = 'complete_mvp',
      is_complete_mvp = true,
      completeness_percent = 100,
      completed_at = now(),
      state_changed_at = now(),
      updated_at = now();

    insert into public.profile_region_assignments (
      profile_id,
      region_id,
      assignment_source,
      assigned_at
    )
    values
      ('${E2E_INITIATOR_PROFILE_ID}', '${E2E_REGION_ID}', 'linkup_e2e_seed', now()),
      ('${E2E_CANDIDATE_A_PROFILE_ID}', '${E2E_REGION_ID}', 'linkup_e2e_seed', now()),
      ('${E2E_CANDIDATE_B_PROFILE_ID}', '${E2E_REGION_ID}', 'linkup_e2e_seed', now()),
      ('${E2E_CANDIDATE_C_PROFILE_ID}', '${E2E_REGION_ID}', 'linkup_e2e_seed', now()),
      ('${E2E_CANDIDATE_D_PROFILE_ID}', '${E2E_REGION_ID}', 'linkup_e2e_seed', now())
    on conflict (profile_id) do update set
      region_id = excluded.region_id,
      assignment_source = excluded.assignment_source,
      assigned_at = excluded.assigned_at,
      updated_at = now();

    insert into public.profile_entitlements (
      profile_id,
      can_initiate,
      can_participate,
      can_exchange_contact,
      region_override,
      waitlist_override,
      safety_override,
      reason
    )
    values
      ('${E2E_INITIATOR_PROFILE_ID}', true, true, true, false, false, false, 'linkup e2e seed'),
      ('${E2E_CANDIDATE_A_PROFILE_ID}', true, true, true, false, false, false, 'linkup e2e seed'),
      ('${E2E_CANDIDATE_B_PROFILE_ID}', true, true, true, false, false, false, 'linkup e2e seed'),
      ('${E2E_CANDIDATE_C_PROFILE_ID}', true, true, true, false, false, false, 'linkup e2e seed'),
      ('${E2E_CANDIDATE_D_PROFILE_ID}', true, true, true, false, false, false, 'linkup e2e seed')
    on conflict (profile_id) do update set
      can_initiate = excluded.can_initiate,
      can_participate = excluded.can_participate,
      can_exchange_contact = excluded.can_exchange_contact,
      region_override = excluded.region_override,
      waitlist_override = excluded.waitlist_override,
      safety_override = excluded.safety_override,
      reason = excluded.reason,
      updated_at = now();

    insert into public.entitlements (
      user_id,
      can_receive_intro,
      can_initiate_linkup,
      can_participate_linkup,
      intro_credits_remaining,
      linkup_credits_remaining,
      source,
      computed_at,
      version
    )
    values
      ('${E2E_INITIATOR_USER_ID}', true, true, true, 5, 5, 'admin_override', now(), 1),
      ('${E2E_CANDIDATE_A_USER_ID}', true, true, true, 5, 5, 'admin_override', now(), 1),
      ('${E2E_CANDIDATE_B_USER_ID}', true, true, true, 5, 5, 'admin_override', now(), 1),
      ('${E2E_CANDIDATE_C_USER_ID}', true, true, true, 5, 5, 'admin_override', now(), 1),
      ('${E2E_CANDIDATE_D_USER_ID}', true, true, true, 5, 5, 'admin_override', now(), 1)
    on conflict (user_id) do update set
      can_receive_intro = excluded.can_receive_intro,
      can_initiate_linkup = excluded.can_initiate_linkup,
      can_participate_linkup = excluded.can_participate_linkup,
      intro_credits_remaining = excluded.intro_credits_remaining,
      linkup_credits_remaining = excluded.linkup_credits_remaining,
      source = excluded.source,
      computed_at = excluded.computed_at,
      updated_at = now();

    update public.safety_holds
    set
      status = 'lifted',
      updated_at = now()
    where user_id in (
      '${E2E_INITIATOR_USER_ID}',
      '${E2E_CANDIDATE_A_USER_ID}',
      '${E2E_CANDIDATE_B_USER_ID}',
      '${E2E_CANDIDATE_C_USER_ID}',
      '${E2E_CANDIDATE_D_USER_ID}'
    )
      and status = 'active';

    delete from public.user_blocks
    where blocker_user_id in (
      '${E2E_INITIATOR_USER_ID}',
      '${E2E_CANDIDATE_A_USER_ID}',
      '${E2E_CANDIDATE_B_USER_ID}',
      '${E2E_CANDIDATE_C_USER_ID}',
      '${E2E_CANDIDATE_D_USER_ID}'
    )
      and blocked_user_id in (
        '${E2E_INITIATOR_USER_ID}',
        '${E2E_CANDIDATE_A_USER_ID}',
        '${E2E_CANDIDATE_B_USER_ID}',
        '${E2E_CANDIDATE_C_USER_ID}',
        '${E2E_CANDIDATE_D_USER_ID}'
      );
  `;
}

function runPsqlMutation(params) {
  const result = spawnSync(
    "psql",
    [params.dsn, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", params.sql],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  if (result.status !== 0) {
    fail(`psql mutation failed: ${truncate(result.stderr || result.stdout || "unknown error", 800)}`);
  }
}

function querySingleValue(params) {
  const result = spawnSync(
    "psql",
    [params.dsn, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", params.sql],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  if (result.status !== 0) {
    fail(`psql query failed: ${truncate(result.stderr || result.stdout || "unknown error", 800)}`);
  }

  const value = (result.stdout || "").trim();
  if (value.length === 0) {
    fail("psql query returned empty output.");
  }

  return value;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    fail(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function requiredEnvAny(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  fail(`Missing required env var. Expected one of: ${names.join(", ")}`);
}

function loadDotEnv(relativePath) {
  const fullPath = path.join(process.cwd(), relativePath);
  if (!fs.existsSync(fullPath)) {
    return;
  }

  const raw = fs.readFileSync(fullPath, "utf8");
  for (const line of raw.split("\n")) {
    const parsed = parseDotEnvLine(line);
    if (!parsed) {
      continue;
    }
    if (!process.env[parsed.key]) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

function parseDotEnvLine(line) {
  if (!line || line.trim().length === 0 || line.trim().startsWith("#")) {
    return null;
  }

  const splitIndex = line.indexOf("=");
  if (splitIndex <= 0) {
    return null;
  }

  const key = line.slice(0, splitIndex).trim();
  if (!/^[A-Z0-9_]+$/.test(key)) {
    return null;
  }

  let value = line.slice(splitIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function encodeForSingleLine(value) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function fail(message) {
  console.error(`[seed-linkup-e2e] ERROR: ${message}`);
  process.exit(1);
}
