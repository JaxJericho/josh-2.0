import fs from "node:fs";
import path from "node:path";
import { createDbClient } from "../../packages/db/src/client-node.mjs";

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
requiredEnv("SUPABASE_URL");
requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createDbClient({ role: "service" });
const nowIso = new Date().toISOString();

await upsertOrFail(supabase, "regions", [
  {
    id: E2E_REGION_ID,
    slug: "matching-e2e-wa",
    display_name: "Matching E2E Region",
    state: "open",
    geometry: {},
    rules: {},
    name: "Matching E2E Region",
    country_code: "US",
    state_code: "WA",
    is_active: true,
    is_launch_region: true,
  },
], "id");

await upsertOrFail(supabase, "users", [
  {
    id: E2E_SOURCE_USER_ID,
    phone_e164: "+15559770001",
    phone_hash: "matching_e2e_hash_1",
    first_name: "Match",
    last_name: "Source",
    birthday: "1991-01-01",
    email: null,
    state: "active",
    sms_consent: true,
    age_consent: true,
    terms_consent: true,
    privacy_consent: true,
    region_id: E2E_REGION_ID,
    deleted_at: null,
  },
  {
    id: E2E_CANDIDATE_USER_IDS[0],
    phone_e164: "+15559770002",
    phone_hash: "matching_e2e_hash_2",
    first_name: "Match",
    last_name: "CandidateA",
    birthday: "1992-02-02",
    email: null,
    state: "active",
    sms_consent: true,
    age_consent: true,
    terms_consent: true,
    privacy_consent: true,
    region_id: E2E_REGION_ID,
    deleted_at: null,
  },
  {
    id: E2E_CANDIDATE_USER_IDS[1],
    phone_e164: "+15559770003",
    phone_hash: "matching_e2e_hash_3",
    first_name: "Match",
    last_name: "CandidateB",
    birthday: "1993-03-03",
    email: null,
    state: "active",
    sms_consent: true,
    age_consent: true,
    terms_consent: true,
    privacy_consent: true,
    region_id: E2E_REGION_ID,
    deleted_at: null,
  },
  {
    id: E2E_CANDIDATE_USER_IDS[2],
    phone_e164: "+15559770004",
    phone_hash: "matching_e2e_hash_4",
    first_name: "Match",
    last_name: "CandidateC",
    birthday: "1994-04-04",
    email: null,
    state: "active",
    sms_consent: true,
    age_consent: true,
    terms_consent: true,
    privacy_consent: true,
    region_id: E2E_REGION_ID,
    deleted_at: null,
  },
], "id");

await upsertOrFail(supabase, "profiles", [
  {
    id: E2E_PROFILE_IDS[0],
    user_id: E2E_SOURCE_USER_ID,
    state: "complete_mvp",
    fingerprint: {},
    coordination_dimensions: buildDimensions([0.72, 0.58, 0.69, 0.63, 0.46, 0.75], [0.91, 0.87, 0.9, 0.86, 0.82, 0.93]),
    activity_patterns: [],
    boundaries: {},
    preferences: {},
    active_intent: null,
    completed_at: nowIso,
    is_complete_mvp: true,
    completeness_percent: 100,
    state_changed_at: nowIso,
  },
  {
    id: E2E_PROFILE_IDS[1],
    user_id: E2E_CANDIDATE_USER_IDS[0],
    state: "complete_mvp",
    fingerprint: {},
    coordination_dimensions: buildDimensions([0.7, 0.56, 0.67, 0.61, 0.48, 0.73], [0.9, 0.86, 0.89, 0.85, 0.81, 0.92]),
    activity_patterns: [],
    boundaries: {},
    preferences: {},
    active_intent: null,
    completed_at: nowIso,
    is_complete_mvp: true,
    completeness_percent: 100,
    state_changed_at: nowIso,
  },
  {
    id: E2E_PROFILE_IDS[2],
    user_id: E2E_CANDIDATE_USER_IDS[1],
    state: "complete_mvp",
    fingerprint: {},
    coordination_dimensions: buildDimensions([0.54, 0.63, 0.45, 0.78, 0.4, 0.62], [0.88, 0.85, 0.87, 0.84, 0.8, 0.9]),
    activity_patterns: [],
    boundaries: {},
    preferences: {},
    active_intent: null,
    completed_at: nowIso,
    is_complete_mvp: true,
    completeness_percent: 100,
    state_changed_at: nowIso,
  },
  {
    id: E2E_PROFILE_IDS[3],
    user_id: E2E_CANDIDATE_USER_IDS[2],
    state: "complete_mvp",
    fingerprint: {},
    coordination_dimensions: buildDimensions([0.42, 0.72, 0.34, 0.81, 0.35, 0.57], [0.86, 0.83, 0.85, 0.82, 0.79, 0.88]),
    activity_patterns: [],
    boundaries: {},
    preferences: {},
    active_intent: null,
    completed_at: nowIso,
    is_complete_mvp: true,
    completeness_percent: 100,
    state_changed_at: nowIso,
  },
], "user_id");

await upsertOrFail(supabase, "profile_region_assignments", [
  {
    profile_id: E2E_PROFILE_IDS[0],
    region_id: E2E_REGION_ID,
    assignment_source: "matching_e2e_seed",
    assigned_at: nowIso,
  },
  {
    profile_id: E2E_PROFILE_IDS[1],
    region_id: E2E_REGION_ID,
    assignment_source: "matching_e2e_seed",
    assigned_at: nowIso,
  },
  {
    profile_id: E2E_PROFILE_IDS[2],
    region_id: E2E_REGION_ID,
    assignment_source: "matching_e2e_seed",
    assigned_at: nowIso,
  },
  {
    profile_id: E2E_PROFILE_IDS[3],
    region_id: E2E_REGION_ID,
    assignment_source: "matching_e2e_seed",
    assigned_at: nowIso,
  },
], "profile_id");

await upsertOrFail(supabase, "profile_entitlements", [
  {
    profile_id: E2E_PROFILE_IDS[0],
    can_initiate: true,
    can_participate: true,
    can_exchange_contact: true,
    region_override: false,
    waitlist_override: false,
    safety_override: false,
    reason: "matching e2e seed",
  },
  {
    profile_id: E2E_PROFILE_IDS[1],
    can_initiate: true,
    can_participate: true,
    can_exchange_contact: true,
    region_override: false,
    waitlist_override: false,
    safety_override: false,
    reason: "matching e2e seed",
  },
  {
    profile_id: E2E_PROFILE_IDS[2],
    can_initiate: true,
    can_participate: true,
    can_exchange_contact: true,
    region_override: false,
    waitlist_override: false,
    safety_override: false,
    reason: "matching e2e seed",
  },
  {
    profile_id: E2E_PROFILE_IDS[3],
    can_initiate: true,
    can_participate: true,
    can_exchange_contact: true,
    region_override: false,
    waitlist_override: false,
    safety_override: false,
    reason: "matching e2e seed",
  },
], "profile_id");

await upsertOrFail(supabase, "entitlements", [
  {
    user_id: E2E_SOURCE_USER_ID,
    can_receive_intro: true,
    can_initiate_linkup: true,
    can_participate_linkup: true,
    intro_credits_remaining: 5,
    linkup_credits_remaining: 5,
    source: "admin_override",
    computed_at: nowIso,
    version: 1,
  },
  {
    user_id: E2E_CANDIDATE_USER_IDS[0],
    can_receive_intro: true,
    can_initiate_linkup: true,
    can_participate_linkup: true,
    intro_credits_remaining: 2,
    linkup_credits_remaining: 5,
    source: "admin_override",
    computed_at: nowIso,
    version: 1,
  },
  {
    user_id: E2E_CANDIDATE_USER_IDS[1],
    can_receive_intro: true,
    can_initiate_linkup: true,
    can_participate_linkup: true,
    intro_credits_remaining: 2,
    linkup_credits_remaining: 5,
    source: "admin_override",
    computed_at: nowIso,
    version: 1,
  },
  {
    user_id: E2E_CANDIDATE_USER_IDS[2],
    can_receive_intro: true,
    can_initiate_linkup: true,
    can_participate_linkup: true,
    intro_credits_remaining: 2,
    linkup_credits_remaining: 5,
    source: "admin_override",
    computed_at: nowIso,
    version: 1,
  },
], "user_id");

await updateOrFail(
  supabase,
  "safety_holds",
  {
    status: "lifted",
    updated_at: nowIso,
  },
  (query) => query.in("user_id", [E2E_SOURCE_USER_ID, ...E2E_CANDIDATE_USER_IDS]).eq("status", "active"),
);

await deleteOrFail(supabase, "user_blocks", (query) =>
  query
    .in("blocker_user_id", [E2E_SOURCE_USER_ID, ...E2E_CANDIDATE_USER_IDS])
    .in("blocked_user_id", [E2E_SOURCE_USER_ID, ...E2E_CANDIDATE_USER_IDS]),
);

const userCount = await countRows(supabase, "users", (query) =>
  query.in("id", [E2E_SOURCE_USER_ID, ...E2E_CANDIDATE_USER_IDS]),
);
const profileCount = await countRows(supabase, "profiles", (query) =>
  query.in("id", E2E_PROFILE_IDS),
);

console.log(`[seed-matching-e2e-rest] users_ready=${userCount}`);
console.log(`[seed-matching-e2e-rest] profiles_ready=${profileCount}`);
console.log(`[seed-matching-e2e-rest] source_user_id=${E2E_SOURCE_USER_ID}`);
console.log("[seed-matching-e2e-rest] done=true");

function buildDimensions(values, confidences) {
  return {
    social_energy: { value: values[0], confidence: confidences[0] },
    social_pace: { value: values[1], confidence: confidences[1] },
    conversation_depth: { value: values[2], confidence: confidences[2] },
    adventure_orientation: { value: values[3], confidence: confidences[3] },
    group_dynamic: { value: values[4], confidence: confidences[4] },
    values_proximity: { value: values[5], confidence: confidences[5] },
  };
}

async function upsertOrFail(supabaseClient, table, rows, onConflict) {
  const { error } = await supabaseClient
    .from(table)
    .upsert(rows, {
      onConflict,
      ignoreDuplicates: false,
    });

  if (error) {
    fail(`Failed to upsert '${table}': ${error.message}`);
  }
}

async function updateOrFail(supabaseClient, table, payload, mutator) {
  let query = supabaseClient.from(table).update(payload);
  query = mutator(query);

  const { error } = await query;
  if (error) {
    fail(`Failed to update '${table}': ${error.message}`);
  }
}

async function deleteOrFail(supabaseClient, table, mutator) {
  let query = supabaseClient.from(table).delete();
  query = mutator(query);

  const { error } = await query;
  if (error) {
    fail(`Failed to delete from '${table}': ${error.message}`);
  }
}

async function countRows(supabaseClient, table, mutator) {
  let query = supabaseClient
    .from(table)
    .select("id", {
      head: true,
      count: "exact",
    });

  query = mutator(query);

  const { count, error } = await query;
  if (error) {
    fail(`Failed to count '${table}': ${error.message}`);
  }
  return Number(count ?? 0);
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

function fail(message) {
  console.error(`[seed-matching-e2e-rest] ERROR: ${message}`);
  process.exit(1);
}
