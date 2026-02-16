import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const E2E_USER_A_ID = "44444444-4444-4444-8444-444444444444";
const E2E_USER_B_ID = "55555555-5555-4555-8555-555555555555";
const E2E_PROFILE_A_ID = "c4444444-4444-4444-8444-444444444444";
const E2E_PROFILE_B_ID = "c5555555-5555-4555-8555-555555555555";

const E2E_SIGNAL_HASH_A = "compat_e2e_seed_hash_user_a_v1";
const E2E_SIGNAL_HASH_B = "compat_e2e_seed_hash_user_b_v1";

loadDotEnv(".env.local");

const stagingDbDsn = requiredEnv("STAGING_DB_DSN");

const seedSql = buildSeedSql();
runPsqlMutation({
  dsn: stagingDbDsn,
  sql: seedSql,
});

const seededUsers = querySingleValue({
  dsn: stagingDbDsn,
  sql: `
    select count(*)
    from public.users
    where id in ('${E2E_USER_A_ID}', '${E2E_USER_B_ID}');
  `,
});

const seededProfiles = querySingleValue({
  dsn: stagingDbDsn,
  sql: `
    select count(*)
    from public.profiles
    where user_id in ('${E2E_USER_A_ID}', '${E2E_USER_B_ID}');
  `,
});

const seededSignals = querySingleValue({
  dsn: stagingDbDsn,
  sql: `
    select count(*)
    from public.profile_compatibility_signals
    where user_id in ('${E2E_USER_A_ID}', '${E2E_USER_B_ID}');
  `,
});

console.log(`[seed-compatibility-e2e] users_ready=${seededUsers}`);
console.log(`[seed-compatibility-e2e] profiles_ready=${seededProfiles}`);
console.log(`[seed-compatibility-e2e] signals_ready=${seededSignals}`);
console.log(`[seed-compatibility-e2e] user_a_id=${E2E_USER_A_ID}`);
console.log(`[seed-compatibility-e2e] user_b_id=${E2E_USER_B_ID}`);
console.log("[seed-compatibility-e2e] done=true");

function buildSeedSql() {
  return `
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
      suspended_at,
      deleted_at
    )
    values
      (
        '${E2E_USER_A_ID}',
        '+15559870001',
        'compat_e2e_phone_hash_a',
        'Compat',
        'E2EA',
        '1990-01-01',
        null,
        'active',
        true,
        true,
        true,
        true,
        null,
        null,
        null
      ),
      (
        '${E2E_USER_B_ID}',
        '+15559870002',
        'compat_e2e_phone_hash_b',
        'Compat',
        'E2EB',
        '1991-02-02',
        null,
        'active',
        true,
        true,
        true,
        true,
        null,
        null,
        null
      )
    on conflict (id) do update set
      state = excluded.state,
      suspended_at = null,
      deleted_at = null,
      sms_consent = true,
      age_consent = true,
      terms_consent = true,
      privacy_consent = true,
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
      last_interview_step,
      completed_at,
      stale_at,
      is_complete_mvp,
      completeness_percent,
      status_reason,
      state_changed_at
    )
    values
      (
        '${E2E_PROFILE_A_ID}',
        '${E2E_USER_A_ID}',
        'complete_mvp',
        '{}'::jsonb,
        '[]'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        null,
        null,
        now(),
        null,
        true,
        100,
        null,
        now()
      ),
      (
        '${E2E_PROFILE_B_ID}',
        '${E2E_USER_B_ID}',
        'complete_mvp',
        '{}'::jsonb,
        '[]'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        null,
        null,
        now(),
        null,
        true,
        100,
        null,
        now()
      )
    on conflict (user_id) do update set
      state = 'complete_mvp',
      is_complete_mvp = true,
      completeness_percent = 100,
      completed_at = now(),
      state_changed_at = now(),
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
      expires_at,
      version
    )
    values
      (
        '${E2E_USER_A_ID}',
        true,
        true,
        true,
        5,
        5,
        'admin_override',
        now(),
        null,
        1
      ),
      (
        '${E2E_USER_B_ID}',
        true,
        true,
        true,
        5,
        5,
        'admin_override',
        now(),
        null,
        1
      )
    on conflict (user_id) do update set
      can_receive_intro = true,
      can_initiate_linkup = true,
      can_participate_linkup = true,
      computed_at = now(),
      updated_at = now();

    update public.safety_holds
    set
      status = 'lifted',
      updated_at = now()
    where user_id in ('${E2E_USER_A_ID}', '${E2E_USER_B_ID}')
      and status = 'active';

    with seeded_profiles as (
      select user_id, id as profile_id
      from public.profiles
      where user_id in ('${E2E_USER_A_ID}', '${E2E_USER_B_ID}')
    ),
    seeded_signals as (
      select
        '${E2E_USER_A_ID}'::uuid as user_id,
        '${E2E_SIGNAL_HASH_A}'::text as content_hash,
        array[0.72, 0.48, 0.22, 0.10, 0.20, 0.05, 0.80, 0.30, 0.18]::double precision[] as interest_vector,
        array[0.75, 1, 0, 0, 1, 0, 1, 0, 0, 0.60]::double precision[] as trait_vector,
        array[0.62, 0.41, 0.18, 0.25, 0.77, 1, 0, 0]::double precision[] as intent_vector,
        array[1, 0, 1, 0, 1, 0, 1]::double precision[] as availability_vector
      union all
      select
        '${E2E_USER_B_ID}'::uuid as user_id,
        '${E2E_SIGNAL_HASH_B}'::text as content_hash,
        array[0.61, 0.56, 0.14, 0.35, 0.11, 0.04, 0.73, 0.40, 0.26]::double precision[] as interest_vector,
        array[0.64, 1, 0, 0, 0, 1, 0, 1, 0, 0.60]::double precision[] as trait_vector,
        array[0.58, 0.48, 0.24, 0.21, 0.70, 1, 0, 0]::double precision[] as intent_vector,
        array[1, 0, 0, 1, 0, 0, 1]::double precision[] as availability_vector
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
      s.user_id,
      p.profile_id,
      'v1',
      s.interest_vector,
      s.trait_vector,
      s.intent_vector,
      s.availability_vector,
      jsonb_build_object('seed_source', 'ticket-4-5-e2e'),
      'complete_mvp'::public.profile_state,
      now(),
      now(),
      s.content_hash
    from seeded_signals s
    join seeded_profiles p
      on p.user_id = s.user_id
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
    fail(
      `psql query failed: ${truncate(result.stderr || result.stdout || "unknown error", 500)}`,
    );
  }

  return (result.stdout || "").trim();
}

function runPsqlMutation(params) {
  const result = spawnSync(
    "psql",
    [params.dsn, "-X", "-v", "ON_ERROR_STOP=1", "-q", "-c", params.sql],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  if (result.status !== 0) {
    fail(
      `psql mutation failed: ${truncate(result.stderr || result.stdout || "unknown error", 500)}`,
    );
  }
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

function truncate(value, max) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
}

function fail(message) {
  console.error(`[seed-compatibility-e2e] ERROR: ${message}`);
  process.exit(1);
}
