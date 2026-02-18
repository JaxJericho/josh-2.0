import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const E2E_REGION_ID = "77777777-7777-4777-8777-777777777701";
const E2E_SOURCE_USER_ID = "77777777-7777-4777-8777-777777777801";
const E2E_CANDIDATE_USER_IDS = [
  "77777777-7777-4777-8777-777777777802",
  "77777777-7777-4777-8777-777777777803",
  "77777777-7777-4777-8777-777777777804",
];
const E2E_PROFILE_IDS = [
  "c7777777-7777-4777-8777-777777777801",
  "c7777777-7777-4777-8777-777777777802",
  "c7777777-7777-4777-8777-777777777803",
  "c7777777-7777-4777-8777-777777777804",
];

loadDotEnv(".env.local");

const stagingDbDsn = requiredEnv("STAGING_DB_DSN");

runPsqlMutation({
  dsn: stagingDbDsn,
  sql: buildSeedSql(),
});

const usersReady = querySingleValue({
  dsn: stagingDbDsn,
  sql: `
    select count(*)
    from public.users
    where id in (
      '${E2E_SOURCE_USER_ID}',
      '${E2E_CANDIDATE_USER_IDS[0]}',
      '${E2E_CANDIDATE_USER_IDS[1]}',
      '${E2E_CANDIDATE_USER_IDS[2]}'
    );
  `,
});

const profilesReady = querySingleValue({
  dsn: stagingDbDsn,
  sql: `
    select count(*)
    from public.profiles
    where id in (
      '${E2E_PROFILE_IDS[0]}',
      '${E2E_PROFILE_IDS[1]}',
      '${E2E_PROFILE_IDS[2]}',
      '${E2E_PROFILE_IDS[3]}'
    );
  `,
});

const signalsReady = querySingleValue({
  dsn: stagingDbDsn,
  sql: `
    select count(*)
    from public.profile_compatibility_signals
    where user_id in (
      '${E2E_SOURCE_USER_ID}',
      '${E2E_CANDIDATE_USER_IDS[0]}',
      '${E2E_CANDIDATE_USER_IDS[1]}',
      '${E2E_CANDIDATE_USER_IDS[2]}'
    );
  `,
});

const profileEntitlementsReady = querySingleValue({
  dsn: stagingDbDsn,
  sql: `
    select count(*)
    from public.profile_entitlements
    where profile_id in (
      '${E2E_PROFILE_IDS[0]}',
      '${E2E_PROFILE_IDS[1]}',
      '${E2E_PROFILE_IDS[2]}',
      '${E2E_PROFILE_IDS[3]}'
    );
  `,
});

console.log(`[seed-matching-e2e] users_ready=${usersReady}`);
console.log(`[seed-matching-e2e] profiles_ready=${profilesReady}`);
console.log(`[seed-matching-e2e] signals_ready=${signalsReady}`);
console.log(`[seed-matching-e2e] profile_entitlements_ready=${profileEntitlementsReady}`);
console.log(`[seed-matching-e2e] source_user_id=${E2E_SOURCE_USER_ID}`);
console.log(`[seed-matching-e2e] region_id=${E2E_REGION_ID}`);
console.log("[seed-matching-e2e] done=true");

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
      'matching-e2e-wa',
      'Matching E2E Region',
      'open',
      '{}'::jsonb,
      '{}'::jsonb,
      'Matching E2E Region',
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
      is_launch_region = excluded.is_launch_region;

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
      ('${E2E_SOURCE_USER_ID}', '+15559770001', 'matching_e2e_hash_1', 'Match', 'Source', '1991-01-01', null, 'active', true, true, true, true, '${E2E_REGION_ID}', null),
      ('${E2E_CANDIDATE_USER_IDS[0]}', '+15559770002', 'matching_e2e_hash_2', 'Match', 'CandidateA', '1992-02-02', null, 'active', true, true, true, true, '${E2E_REGION_ID}', null),
      ('${E2E_CANDIDATE_USER_IDS[1]}', '+15559770003', 'matching_e2e_hash_3', 'Match', 'CandidateB', '1993-03-03', null, 'active', true, true, true, true, '${E2E_REGION_ID}', null),
      ('${E2E_CANDIDATE_USER_IDS[2]}', '+15559770004', 'matching_e2e_hash_4', 'Match', 'CandidateC', '1994-04-04', null, 'active', true, true, true, true, '${E2E_REGION_ID}', null)
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
      ('${E2E_PROFILE_IDS[0]}', '${E2E_SOURCE_USER_ID}', 'complete_mvp', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, null, now(), true, 100, now()),
      ('${E2E_PROFILE_IDS[1]}', '${E2E_CANDIDATE_USER_IDS[0]}', 'complete_mvp', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, null, now(), true, 100, now()),
      ('${E2E_PROFILE_IDS[2]}', '${E2E_CANDIDATE_USER_IDS[1]}', 'complete_mvp', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, null, now(), true, 100, now()),
      ('${E2E_PROFILE_IDS[3]}', '${E2E_CANDIDATE_USER_IDS[2]}', 'complete_mvp', '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, null, now(), true, 100, now())
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
      ('${E2E_PROFILE_IDS[0]}', '${E2E_REGION_ID}', 'matching_e2e_seed', now()),
      ('${E2E_PROFILE_IDS[1]}', '${E2E_REGION_ID}', 'matching_e2e_seed', now()),
      ('${E2E_PROFILE_IDS[2]}', '${E2E_REGION_ID}', 'matching_e2e_seed', now()),
      ('${E2E_PROFILE_IDS[3]}', '${E2E_REGION_ID}', 'matching_e2e_seed', now())
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
      ('${E2E_PROFILE_IDS[0]}', true, true, true, false, false, false, 'matching e2e seed'),
      ('${E2E_PROFILE_IDS[1]}', true, true, true, false, false, false, 'matching e2e seed'),
      ('${E2E_PROFILE_IDS[2]}', true, true, true, false, false, false, 'matching e2e seed'),
      ('${E2E_PROFILE_IDS[3]}', true, true, true, false, false, false, 'matching e2e seed')
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
      ('${E2E_SOURCE_USER_ID}', true, true, true, 5, 5, 'admin_override', now(), 1),
      ('${E2E_CANDIDATE_USER_IDS[0]}', true, true, true, 2, 5, 'admin_override', now(), 1),
      ('${E2E_CANDIDATE_USER_IDS[1]}', true, true, true, 2, 5, 'admin_override', now(), 1),
      ('${E2E_CANDIDATE_USER_IDS[2]}', true, true, true, 2, 5, 'admin_override', now(), 1)
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
      '${E2E_SOURCE_USER_ID}',
      '${E2E_CANDIDATE_USER_IDS[0]}',
      '${E2E_CANDIDATE_USER_IDS[1]}',
      '${E2E_CANDIDATE_USER_IDS[2]}'
    )
      and status = 'active';

    delete from public.user_blocks
    where blocker_user_id in (
      '${E2E_SOURCE_USER_ID}',
      '${E2E_CANDIDATE_USER_IDS[0]}',
      '${E2E_CANDIDATE_USER_IDS[1]}',
      '${E2E_CANDIDATE_USER_IDS[2]}'
    )
      and blocked_user_id in (
        '${E2E_SOURCE_USER_ID}',
        '${E2E_CANDIDATE_USER_IDS[0]}',
        '${E2E_CANDIDATE_USER_IDS[1]}',
        '${E2E_CANDIDATE_USER_IDS[2]}'
      );

    with seeded_signals as (
      select
        '${E2E_SOURCE_USER_ID}'::uuid as user_id,
        '${E2E_PROFILE_IDS[0]}'::uuid as profile_id,
        'matching_e2e_hash_source_v1'::text as content_hash,
        array[0.70, 0.42, 0.25, 0.12, 0.15, 0.05, 0.78, 0.35, 0.22]::double precision[] as interest_vector,
        array[0.74, 1, 0, 0, 1, 0, 1, 0, 0, 0.62]::double precision[] as trait_vector,
        array[0.63, 0.39, 0.15, 0.28, 0.81, 1, 0, 0]::double precision[] as intent_vector,
        array[1, 0, 1, 0, 1, 0, 1]::double precision[] as availability_vector
      union all
      select
        '${E2E_CANDIDATE_USER_IDS[0]}'::uuid,
        '${E2E_PROFILE_IDS[1]}'::uuid,
        'matching_e2e_hash_c1_v1',
        array[0.68, 0.40, 0.28, 0.10, 0.17, 0.04, 0.80, 0.30, 0.20]::double precision[],
        array[0.71, 1, 0, 0, 1, 0, 1, 0, 0, 0.58]::double precision[],
        array[0.60, 0.38, 0.16, 0.26, 0.77, 1, 0, 0]::double precision[],
        array[1, 0, 1, 0, 1, 0, 1]::double precision[]
      union all
      select
        '${E2E_CANDIDATE_USER_IDS[1]}'::uuid,
        '${E2E_PROFILE_IDS[2]}'::uuid,
        'matching_e2e_hash_c2_v1',
        array[0.59, 0.54, 0.18, 0.30, 0.10, 0.05, 0.70, 0.42, 0.28]::double precision[],
        array[0.66, 1, 0, 0, 0, 1, 0, 1, 0, 0.60]::double precision[],
        array[0.56, 0.49, 0.22, 0.22, 0.71, 1, 0, 0]::double precision[],
        array[1, 0, 0, 1, 0, 0, 1]::double precision[]
      union all
      select
        '${E2E_CANDIDATE_USER_IDS[2]}'::uuid,
        '${E2E_PROFILE_IDS[3]}'::uuid,
        'matching_e2e_hash_c3_v1',
        array[0.49, 0.60, 0.12, 0.38, 0.08, 0.07, 0.62, 0.46, 0.31]::double precision[],
        array[0.57, 1, 0, 0, 0, 1, 0, 1, 0, 0.56]::double precision[],
        array[0.52, 0.52, 0.26, 0.20, 0.66, 1, 0, 0]::double precision[],
        array[1, 0, 0, 1, 0, 0, 1]::double precision[]
    )
    insert into public.profile_compatibility_signals (
      user_id,
      profile_id,
      normalization_version,
      interest_vector,
      trait_vector,
      intent_vector,
      availability_vector,
      metadata,
      source_profile_state,
      source_profile_completed_at,
      source_profile_updated_at,
      content_hash
    )
    select
      user_id,
      profile_id,
      'v1',
      interest_vector,
      trait_vector,
      intent_vector,
      availability_vector,
      jsonb_build_object('seed_source', 'ticket-7-1-matching-e2e'),
      'complete_mvp'::public.profile_state,
      now(),
      now(),
      content_hash
    from seeded_signals
    on conflict (user_id) do update set
      profile_id = excluded.profile_id,
      normalization_version = excluded.normalization_version,
      interest_vector = excluded.interest_vector,
      trait_vector = excluded.trait_vector,
      intent_vector = excluded.intent_vector,
      availability_vector = excluded.availability_vector,
      metadata = excluded.metadata,
      source_profile_state = excluded.source_profile_state,
      source_profile_completed_at = excluded.source_profile_completed_at,
      source_profile_updated_at = excluded.source_profile_updated_at,
      content_hash = excluded.content_hash,
      updated_at = now();
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
    fail(`psql seed failed: ${truncate(result.stderr || result.stdout || "unknown error", 500)}`);
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
    fail(`psql query failed: ${truncate(result.stderr || result.stdout || "unknown error", 500)}`);
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

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function fail(message) {
  console.error(`[seed-matching-e2e] ERROR: ${message}`);
  process.exit(1);
}
