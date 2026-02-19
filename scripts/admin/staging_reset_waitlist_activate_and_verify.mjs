import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SCRIPT_TAG = "staging-onboarding-e2e";

const STAGING_PROJECT_REF = "rcqlnfywwfsixznrmzmv";
const TEST_USER_ID = "221956bd-c214-4e61-bb95-223d2136b60a";
const TEST_PHONE_E164 = "+19073159859";
const WAITLIST_REGION_ID = "aedb39cc-f6e1-4b8d-82e8-8c5ff33d47a5";
const WAITLIST_REGION_SLUG = "waitlist";
const WAITLIST_ENTRY_ANCHOR_ISO = "1970-01-01T00:00:00.000Z";

const WAITLIST_SHARED_CONTRACT_PATH = path.join(
  process.cwd(),
  "supabase/functions/_shared/waitlist/admin-waitlist-batch-notify.ts",
);
const ONBOARDING_CONSTANTS_PATH = path.join(
  process.cwd(),
  "packages/core/src/onboarding/onboarding-engine.ts",
);

loadDotEnv(".env.local");

const supabaseUrl = requiredEnv("SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const adminSecret = requiredEnv("QSTASH_RUNNER_SECRET");

assertValidUrl(supabaseUrl, "SUPABASE_URL");

const eligibleWaitlistStatuses = loadStringArrayConstant({
  filePath: WAITLIST_SHARED_CONTRACT_PATH,
  constName: "ELIGIBLE_WAITLIST_STATUSES",
});
const eligibleWaitlistStatus = eligibleWaitlistStatuses[0] ?? null;
if (!eligibleWaitlistStatus) {
  fail("Unable to resolve at least one eligible waitlist status.");
}

const onboardingOpeningStateToken = loadStringConstant({
  filePath: ONBOARDING_CONSTANTS_PATH,
  constName: "ONBOARDING_AWAITING_OPENING_RESPONSE",
});

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

await main();

async function main() {
  await assertStagingContext();
  await assertTestUser();
  await assertWaitlistRegion();

  await resetUserState();
  await verifyResetCounts();

  const profile = await ensureProfileForUser();
  await ensureEligibleWaitlistEntry({
    profileId: profile.id,
    eligibleStatus: eligibleWaitlistStatus,
  });

  const activationSummary = await invokeWaitlistBatchNotify();
  const activatedWaitlistEntry = await verifyActivatedWaitlistEntry();
  const session = await verifyConversationSession({
    expectedStateToken: onboardingOpeningStateToken,
  });
  const outboundSmsCount = await countOutboundSmsSinceActivation({
    activatedAtIso: activatedWaitlistEntry.activated_at,
  });

  if (outboundSmsCount < 1) {
    fail("Expected at least one outbound sms_messages row after activation.");
  }

  printReport({
    activationSummary,
    sessionStateToken: session.state_token,
    outboundSmsCount,
    activatedAtIso: activatedWaitlistEntry.activated_at,
  });
}

async function assertStagingContext() {
  let parsedUrl;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    fail("SUPABASE_URL is not a valid URL.");
  }

  if (!parsedUrl.hostname.includes(STAGING_PROJECT_REF)) {
    fail(
      `SUPABASE_URL hostname does not include expected staging project ref '${STAGING_PROJECT_REF}'.`,
    );
  }
}

async function assertTestUser() {
  const { data, error } = await supabase
    .from("users")
    .select("id,phone_e164")
    .eq("id", TEST_USER_ID)
    .maybeSingle();

  if (error) {
    fail(`Unable to load test user: ${formatSupabaseError(error)}`);
  }
  if (!data?.id) {
    fail(`Test user '${TEST_USER_ID}' was not found in public.users.`);
  }
  if (data.phone_e164 !== TEST_PHONE_E164) {
    fail(
      `Test user phone mismatch. Expected '${TEST_PHONE_E164}', got '${String(data.phone_e164 ?? "")}'.`,
    );
  }
}

async function assertWaitlistRegion() {
  const { data, error } = await supabase
    .from("regions")
    .select("id,slug")
    .eq("id", WAITLIST_REGION_ID)
    .maybeSingle();

  if (error) {
    fail(`Unable to load waitlist region: ${formatSupabaseError(error)}`);
  }
  if (!data?.id) {
    fail(`Waitlist region '${WAITLIST_REGION_ID}' was not found in public.regions.`);
  }
  if (data.slug !== WAITLIST_REGION_SLUG) {
    fail(
      `Waitlist region slug mismatch. Expected '${WAITLIST_REGION_SLUG}', got '${String(data.slug ?? "")}'.`,
    );
  }
}

async function resetUserState() {
  await deleteRowsByUserId("profile_events");
  await deleteRowsByUserId("sms_messages");
  await deleteRowsByUserId("sms_outbound_jobs", { optionalTable: true });
  await deleteRowsByUserId("conversation_sessions");
  await deleteRowsByUserId("profiles");
}

async function verifyResetCounts() {
  const requiredTables = [
    "conversation_sessions",
    "sms_messages",
    "profiles",
    "profile_events",
  ];

  for (const table of requiredTables) {
    const count = await countRowsByUserId(table);
    if (count !== 0) {
      fail(`Expected 0 rows in public.${table} after reset, found ${count}.`);
    }
  }

  const outboundJobsCount = await countRowsByUserId("sms_outbound_jobs", {
    optionalTable: true,
  });
  if (outboundJobsCount !== null && outboundJobsCount !== 0) {
    fail(
      `Expected 0 rows in public.sms_outbound_jobs after reset, found ${outboundJobsCount}.`,
    );
  }
}

async function ensureProfileForUser() {
  const { data: existing, error: existingError } = await supabase
    .from("profiles")
    .select("id,user_id")
    .eq("user_id", TEST_USER_ID)
    .maybeSingle();

  if (existingError) {
    fail(`Unable to check profile existence: ${formatSupabaseError(existingError)}`);
  }

  if (existing?.id) {
    return existing;
  }

  const { data, error } = await supabase
    .from("profiles")
    .insert({
      user_id: TEST_USER_ID,
    })
    .select("id,user_id")
    .single();

  if (error || !data?.id) {
    fail(`Unable to create profile for test user: ${formatSupabaseError(error)}`);
  }
  return data;
}

async function ensureEligibleWaitlistEntry(params) {
  const resetPayload = {
    user_id: TEST_USER_ID,
    profile_id: params.profileId,
    region_id: WAITLIST_REGION_ID,
    status: params.eligibleStatus,
    source: "sms",
    last_notified_at: null,
    notified_at: null,
    activated_at: null,
  };

  const { data: existing, error: existingError } = await supabase
    .from("waitlist_entries")
    .select("id")
    .eq("user_id", TEST_USER_ID)
    .eq("region_id", WAITLIST_REGION_ID)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    fail(`Unable to select existing waitlist entry: ${formatSupabaseError(existingError)}`);
  }

  const query = existing?.id
    ? supabase
      .from("waitlist_entries")
      .update(resetPayload)
      .eq("id", existing.id)
    : supabase
      .from("waitlist_entries")
      .insert({
        ...resetPayload,
        joined_at: WAITLIST_ENTRY_ANCHOR_ISO,
        created_at: WAITLIST_ENTRY_ANCHOR_ISO,
      });

  const { data, error } = await query
    .select(
      "id,user_id,profile_id,region_id,status,last_notified_at,notified_at,activated_at",
    )
    .single();

  if (error || !data?.id) {
    fail(`Unable to ensure waitlist entry: ${formatSupabaseError(error)}`);
  }
  if (data.status !== params.eligibleStatus) {
    fail(
      `Waitlist entry was not set to an eligible status. Expected '${params.eligibleStatus}', got '${String(data.status ?? "")}'.`,
    );
  }
  if (data.last_notified_at || data.notified_at || data.activated_at) {
    fail("Waitlist entry was not reset to selectable state before activation.");
  }
}

async function invokeWaitlistBatchNotify() {
  const endpoint = `${stripTrailingSlash(supabaseUrl)}/functions/v1/admin-waitlist-batch-notify`;
  const requestBody = {
    region_slug: WAITLIST_REGION_SLUG,
    limit: 1,
    dry_run: false,
    open_region: false,
    notification_template_version: "v1",
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "x-admin-secret": adminSecret,
    },
    body: JSON.stringify(requestBody),
  });

  const rawBody = await response.text();
  const parsedBody = parseJson(rawBody);

  if (!response.ok) {
    fail(
      `admin-waitlist-batch-notify failed with HTTP ${response.status}: ${truncate(rawBody, 400)}`,
    );
  }

  if (!parsedBody || typeof parsedBody !== "object") {
    fail("admin-waitlist-batch-notify returned a non-JSON object response.");
  }

  const summary = parsedBody;
  const selectedCount = Number(summary.selected_count ?? Number.NaN);
  const claimedCount = Number(summary.claimed_count ?? Number.NaN);
  const sentCount = Number(summary.sent_count ?? Number.NaN);

  if (!Number.isFinite(selectedCount) || !Number.isFinite(claimedCount) || !Number.isFinite(sentCount)) {
    fail(`Unexpected summary payload from admin-waitlist-batch-notify: ${truncate(rawBody, 400)}`);
  }

  const errors = Array.isArray(summary.errors) ? summary.errors : [];
  if (errors.length > 0) {
    fail(`admin-waitlist-batch-notify returned ${errors.length} error(s): ${JSON.stringify(errors)}`);
  }

  if (selectedCount < 1 || claimedCount < 1 || sentCount < 1) {
    fail(
      `Unexpected activation summary values: selected_count=${selectedCount}, claimed_count=${claimedCount}, sent_count=${sentCount}.`,
    );
  }

  return {
    selected_count: selectedCount,
    claimed_count: claimedCount,
    sent_count: sentCount,
  };
}

async function verifyActivatedWaitlistEntry() {
  const { data, error } = await supabase
    .from("waitlist_entries")
    .select("id,status,activated_at,notified_at,last_notified_at")
    .eq("user_id", TEST_USER_ID)
    .eq("region_id", WAITLIST_REGION_ID)
    .maybeSingle();

  if (error) {
    fail(`Unable to read activated waitlist entry: ${formatSupabaseError(error)}`);
  }
  if (!data?.id) {
    fail("Activated waitlist entry was not found for the test user.");
  }
  if (data.status !== "activated") {
    fail(`Expected waitlist status 'activated', got '${String(data.status ?? "")}'.`);
  }
  if (!data.activated_at || !data.notified_at || !data.last_notified_at) {
    fail("Expected activated_at/notified_at/last_notified_at to be set after activation.");
  }

  return data;
}

async function verifyConversationSession(params) {
  const { data, error } = await supabase
    .from("conversation_sessions")
    .select("id,mode,state_token")
    .eq("user_id", TEST_USER_ID)
    .maybeSingle();

  if (error) {
    fail(`Unable to read conversation session: ${formatSupabaseError(error)}`);
  }
  if (!data?.id) {
    fail("No conversation_sessions row was created for the activated user.");
  }
  if (data.state_token !== params.expectedStateToken) {
    fail(
      `Unexpected conversation state token. Expected '${params.expectedStateToken}', got '${String(data.state_token ?? "")}'.`,
    );
  }
  return data;
}

async function countOutboundSmsSinceActivation(params) {
  const { count, error } = await supabase
    .from("sms_messages")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", TEST_USER_ID)
    .eq("direction", "out")
    .gte("created_at", params.activatedAtIso);

  if (error) {
    fail(`Unable to count outbound sms_messages: ${formatSupabaseError(error)}`);
  }
  return Number(count ?? 0);
}

async function deleteRowsByUserId(table, options = {}) {
  const { error } = await supabase
    .from(table)
    .delete()
    .eq("user_id", TEST_USER_ID);

  if (!error) {
    return;
  }

  if (options.optionalTable && isMissingTableError(error)) {
    warn(`Optional table public.${table} not found; skipping reset for this table.`);
    return;
  }

  fail(`Failed deleting from public.${table}: ${formatSupabaseError(error)}`);
}

async function countRowsByUserId(table, options = {}) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { head: true, count: "exact" })
    .eq("user_id", TEST_USER_ID);

  if (!error) {
    return Number(count ?? 0);
  }

  if (options.optionalTable && isMissingTableError(error)) {
    return null;
  }

  fail(`Failed counting public.${table}: ${formatSupabaseError(error)}`);
}

function printReport(params) {
  console.log(
    `[${SCRIPT_TAG}] selected_count=${params.activationSummary.selected_count} claimed_count=${params.activationSummary.claimed_count} sent_count=${params.activationSummary.sent_count}`,
  );
  console.log(`[${SCRIPT_TAG}] session_state_token=${params.sessionStateToken}`);
  console.log(
    `[${SCRIPT_TAG}] sms_messages_since_activation=${params.outboundSmsCount} activated_at=${params.activatedAtIso}`,
  );
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    fail(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function assertValidUrl(value, envName) {
  try {
    new URL(value);
  } catch {
    fail(`Invalid URL in ${envName}.`);
  }
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
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function loadStringArrayConstant(params) {
  const source = readSourceFile(params.filePath);
  const pattern = new RegExp(
    `export\\s+const\\s+${escapeRegExp(params.constName)}\\s*=\\s*\\[([^\\]]+)\\]`,
  );
  const match = source.match(pattern);

  if (!match) {
    fail(`Unable to find constant '${params.constName}' in ${params.filePath}.`);
  }

  const values = Array.from(match[1].matchAll(/"([^"]+)"/g), (entry) => entry[1].trim())
    .filter((value) => value.length > 0);
  if (values.length === 0) {
    fail(`Constant '${params.constName}' in ${params.filePath} did not contain any string values.`);
  }
  return values;
}

function loadStringConstant(params) {
  const source = readSourceFile(params.filePath);
  const pattern = new RegExp(
    `export\\s+const\\s+${escapeRegExp(params.constName)}\\s*=\\s*"([^"]+)"`,
  );
  const match = source.match(pattern);

  if (!match?.[1]) {
    fail(`Unable to find constant '${params.constName}' in ${params.filePath}.`);
  }
  return match[1];
}

function readSourceFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`Required source file not found: ${filePath}`);
  }
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    fail(`Unable to read source file '${filePath}': ${errorToMessage(error)}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseJson(raw) {
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isMissingTableError(error) {
  const code = String(error?.code ?? "");
  const details = String(error?.details ?? "");
  const message = String(error?.message ?? "");
  const combined = `${code} ${details} ${message}`.toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    combined.includes("could not find the table") ||
    combined.includes("relation") && combined.includes("does not exist")
  );
}

function formatSupabaseError(error) {
  if (!error) {
    return "unknown error";
  }
  const code = error.code ? `code=${error.code}` : "code=unknown";
  const message = error.message ?? "unknown error";
  const details = error.details ? ` details=${error.details}` : "";
  return `${code} message=${message}${details}`;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function warn(message) {
  console.warn(`[${SCRIPT_TAG}] WARN: ${message}`);
}

function fail(message) {
  console.error(`[${SCRIPT_TAG}] ERROR: ${message}`);
  process.exit(1);
}

function errorToMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
