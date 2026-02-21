import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Client as QStashClient } from "@upstash/qstash";
import { createDbClient } from "../packages/db/src/client-node.mjs";

const SCRIPT_TAG = "staging-onboarding-e2e";

const STAGING_PROJECT_REF = "rcqlnfywwfsixznrmzmv";
const TEST_USER_ID = "221956bd-c214-4e61-bb95-223d2136b60a";
const TEST_PHONE_E164 = "+19073159859";
const WAITLIST_REGION_ID = "aedb39cc-f6e1-4b8d-82e8-8c5ff33d47a5";
const WAITLIST_REGION_SLUG = "waitlist";
const WAITLIST_ENTRY_ANCHOR_ISO = "1970-01-01T00:00:00.000Z";
const ACCEPTED_WAITLIST_CLAIM_STATUSES = new Set(["activated", "notified"]);

const ONBOARDING_AWAITING_OPENING_RESPONSE = "onboarding:awaiting_opening_response";
const ONBOARDING_AWAITING_EXPLANATION_RESPONSE = "onboarding:awaiting_explanation_response";
const ONBOARDING_AWAITING_BURST = "onboarding:awaiting_burst";
const ONBOARDING_AWAITING_INTERVIEW_START = "onboarding:awaiting_interview_start";

const ONBOARDING_STEP_IDS = [
  "onboarding_message_1",
  "onboarding_message_2",
  "onboarding_message_3",
  "onboarding_message_4",
];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STEP_TIMEOUT_MS = 60_000;
const STEP_POLL_INTERVAL_MS = 1_000;
const MIN_REAL_GAP_MS = 6_000;
const BURST_DRAIN_WINDOW_MS = 120_000;

const HARNESS_MODE_VALUES = new Set(["stub", "real"]);

loadDotEnv(".env.local");

const harnessMode = parseHarnessMode(requiredEnv("HARNESS_QSTASH_MODE"));
const appEnv = readOptionalEnv("APP_ENV");
const supabaseUrl = requiredEnv("SUPABASE_URL");
requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const twilioAuthToken = requiredEnv("TWILIO_AUTH_TOKEN");
const adminSecret =
  readOptionalEnv("STAGING_RUNNER_SECRET") ??
  readOptionalEnv("QSTASH_RUNNER_SECRET") ??
  fail("Missing required env var: STAGING_RUNNER_SECRET or QSTASH_RUNNER_SECRET");

const appBaseUrl = resolveAppBaseUrl();
const qstashToken = harnessMode === "real" ? requiredEnv("QSTASH_TOKEN") : null;
let harnessQStashClient = null;

assertValidUrl(supabaseUrl, "SUPABASE_URL");
assertValidUrl(appBaseUrl, "APP_BASE_URL/VERCEL_URL");

const supabase = createDbClient({ role: "service" });

await main();

async function main() {
  assertEnvironmentContext();
  await assertTestUser();
  await assertWaitlistRegion();

  const cycleOne = await runHarnessCycle({ label: "cycle_1" });
  const cycleTwo = await runHarnessCycle({ label: "cycle_2" });

  assertNoStateBleed(cycleOne, cycleTwo);

  console.log(
    `[${SCRIPT_TAG}] PASS mode=${harnessMode} cycle_1_steps=${cycleOne.stepRows.length} cycle_2_steps=${cycleTwo.stepRows.length}`,
  );
  console.log(
    `[${SCRIPT_TAG}] PASS mode=${harnessMode} burst_sms_messages_cycle_1=${cycleOne.burstEvidenceCount} burst_sms_messages_cycle_2=${cycleTwo.burstEvidenceCount}`,
  );
  console.log(
    `[${SCRIPT_TAG}] PASS mode=${harnessMode} idempotency_rows_cycle_1=${cycleOne.idempotencyRowCount} idempotency_rows_cycle_2=${cycleTwo.idempotencyRowCount}`,
  );
  if (harnessMode === "real") {
    console.log(
      `[${SCRIPT_TAG}] PASS mode=real gaps_ms step1_to_2=${cycleOne.stepGapMs[0]} step2_to_3=${cycleOne.stepGapMs[1]} step3_to_4=${cycleOne.stepGapMs[2]}`,
    );
  }
}

async function runHarnessCycle(params) {
  console.log(`[${SCRIPT_TAG}] start ${params.label} mode=${harnessMode}`);

  const profile = await requireProfileForUser();

  await resetUserState({ profileId: profile.id });
  await verifyResetCounts();

  const waitlistEntry = await ensureEligibleWaitlistEntry({ profileId: profile.id });
  const cycleReferenceIso = new Date().toISOString();
  const activationSummary = await triggerWaitlistActivation();

  await verifyClaimedWaitlistEntry({ waitlistEntryId: waitlistEntry.id });

  await ensureOnboardingSessionAfterActivation({
    expectedToken: ONBOARDING_AWAITING_OPENING_RESPONSE,
    referenceTimestampIso: cycleReferenceIso,
    activationSummary,
  });

  await assertOpeningMessageExists({
    referenceTimestampIso: cycleReferenceIso,
    timeoutMs: 20_000,
  });

  await invokeSignedTwilioInbound({ body: "YES", twilioAuthToken });
  await pollSessionToken({
    expectedToken: ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
    timeoutMs: 20_000,
  });

  const explanationReplyAtIso = new Date().toISOString();
  await invokeSignedTwilioInbound({ body: "YES", twilioAuthToken });

  await assertBurstTransitionEvent({
    sinceIso: explanationReplyAtIso,
    timeoutMs: 20_000,
  });
  const sessionAfterExplanation = await pollSessionToken({
    expectedToken: ONBOARDING_AWAITING_BURST,
    timeoutMs: 20_000,
  });
  const profileAfterExplanation = await requireProfileForUser();

  const stepRows = await observeBurstStepMessages({
    profileId: profileAfterExplanation.id,
    sessionId: sessionAfterExplanation.id,
    referenceTimestampIso: explanationReplyAtIso,
    timeoutMsPerStep: STEP_TIMEOUT_MS,
  });
  const burstEvidenceRows = await listBurstEvidenceForSession({
    profileId: profileAfterExplanation.id,
    sessionId: sessionAfterExplanation.id,
    referenceTimestampIso: explanationReplyAtIso,
  });
  assertExactBurstEvidence({
    profileId: profileAfterExplanation.id,
    sessionId: sessionAfterExplanation.id,
    rows: burstEvidenceRows,
  });

  const stepGapMs = assertStepOrderingAndTiming({ stepRows, mode: harnessMode });

  await pollSessionToken({
    expectedToken: ONBOARDING_AWAITING_INTERVIEW_START,
    timeoutMs: 20_000,
  });

  const drainCheck = await runBurstDrainCheck({
    profileId: profileAfterExplanation.id,
    sessionId: sessionAfterExplanation.id,
    referenceTimestampIso: explanationReplyAtIso,
    baselineRows: burstEvidenceRows,
    waitMs: BURST_DRAIN_WINDOW_MS,
  });

  const idempotencyPayload = buildStepPayload({
    profileId: profileAfterExplanation.id,
    sessionId: sessionAfterExplanation.id,
    stepId: "onboarding_message_1",
    expectedStateToken: ONBOARDING_AWAITING_BURST,
  });

  await submitDuplicateStepPayloadTwice({ payload: idempotencyPayload });

  const idempotencyRowCount = await countDeliveredRowsByOutboundIdempotency({
    idempotencyKey: idempotencyPayload.idempotency_key,
  });
  if (idempotencyRowCount !== 1) {
    fail(
      `Expected exactly one delivered sms_messages row for idempotency key '${idempotencyPayload.idempotency_key}', found ${idempotencyRowCount}.`,
    );
  }

  console.log(
    `[${SCRIPT_TAG}] cycle=${params.label} selected=${activationSummary.selected_count} claimed=${activationSummary.claimed_count} sent=${activationSummary.sent_count} burst_steps_observed=${stepRows.length}`,
  );
  console.log(
    `[${SCRIPT_TAG}] SQL burst_evidence_query cycle=${params.label} sql=${buildBurstEvidenceQuerySql()}`,
  );
  console.log(
    `[${SCRIPT_TAG}] SQL burst_rows cycle=${params.label} rows=${JSON.stringify(burstEvidenceRows.map(toSqlEvidenceRow))}`,
  );
  console.log(
    `[${SCRIPT_TAG}] SQL idempotency_query cycle=${params.label} sql=${buildIdempotencyQuerySql()}`,
  );
  console.log(
    `[${SCRIPT_TAG}] SQL gaps cycle=${params.label} rows=${JSON.stringify(buildGapEvidenceRows(stepRows))}`,
  );
  console.log(
    `[${SCRIPT_TAG}] SQL drain_check cycle=${params.label} rows=${JSON.stringify(drainCheck)}`,
  );

  return {
    activationSummary,
    stepRows,
    stepGapMs,
    burstEvidenceCount: burstEvidenceRows.length,
    idempotencyRowCount,
    drainCheck,
  };
}

function assertEnvironmentContext() {
  if (appEnv === "staging") {
    const parsed = new URL(supabaseUrl);
    if (!parsed.hostname.includes(STAGING_PROJECT_REF)) {
      fail(
        `SUPABASE_URL hostname does not include expected staging project ref '${STAGING_PROJECT_REF}'.`,
      );
    }
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

async function requireProfileForUser() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,user_id")
    .eq("user_id", TEST_USER_ID)
    .maybeSingle();

  if (error) {
    fail(`Unable to resolve profile: ${formatSupabaseError(error)}`);
  }
  if (!data?.id) {
    fail(
      "Missing required profile anchor for test user. Create public.profiles row for TEST_USER_ID before running this harness.",
    );
  }

  return data;
}

async function resetUserState(params) {
  await resetProfileState({ profileId: params.profileId });
  await deleteRowsByUserId("conversation_events");
  await deleteRowsByUserId("profile_events");
  await deleteRowsByUserId("sms_messages");
  await deleteRowsByUserId("sms_outbound_jobs", { optionalTable: true });
  await deleteRowsByUserId("conversation_sessions");
  await deleteRowsByUserId("safety_holds", { optionalTable: true });
  await deleteSmsOptOutsByPhone();
}

async function resetProfileState(params) {
  const { error } = await supabase
    .from("profiles")
    .update({
      state: "partial",
      is_complete_mvp: false,
      last_interview_step: null,
      preferences: {},
      fingerprint: {},
      activity_patterns: [],
      boundaries: {},
      active_intent: null,
      completeness_percent: 0,
      completed_at: null,
      status_reason: null,
      stale_at: null,
    })
    .eq("id", params.profileId)
    .eq("user_id", TEST_USER_ID);

  if (error) {
    fail(`Unable to reset profile state: ${formatSupabaseError(error)}`);
  }
}

async function deleteSmsOptOutsByPhone() {
  const { error } = await supabase
    .from("sms_opt_outs")
    .delete()
    .eq("phone_e164", TEST_PHONE_E164);

  if (error) {
    fail(`Unable to clear sms_opt_outs: ${formatSupabaseError(error)}`);
  }
}

async function verifyResetCounts() {
  const requiredTables = [
    "conversation_sessions",
    "conversation_events",
    "sms_messages",
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

  const safetyHoldsCount = await countRowsByUserId("safety_holds", {
    optionalTable: true,
  });
  if (safetyHoldsCount !== null && safetyHoldsCount !== 0) {
    fail(
      `Expected 0 rows in public.safety_holds after reset, found ${safetyHoldsCount}.`,
    );
  }
}

async function ensureEligibleWaitlistEntry(params) {
  const resetPayload = {
    user_id: TEST_USER_ID,
    profile_id: params.profileId,
    region_id: WAITLIST_REGION_ID,
    status: "waiting",
    source: "sms",
    joined_at: WAITLIST_ENTRY_ANCHOR_ISO,
    created_at: WAITLIST_ENTRY_ANCHOR_ISO,
    updated_at: WAITLIST_ENTRY_ANCHOR_ISO,
    last_notified_at: null,
    notified_at: null,
    activated_at: null,
  };

  const { data: existing, error: existingError } = await supabase
    .from("waitlist_entries")
    .select("id")
    .eq("user_id", TEST_USER_ID)
    .eq("region_id", WAITLIST_REGION_ID)
    .order("created_at", { ascending: true })
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
      .insert(resetPayload);

  const { data, error } = await query
    .select("id,status,last_notified_at,notified_at,activated_at")
    .single();

  if (error || !data?.id) {
    fail(`Unable to ensure waitlist entry: ${formatSupabaseError(error)}`);
  }

  if (data.status !== "waiting") {
    fail(
      `Expected waitlist entry status 'waiting' after reset, got '${String(data.status ?? "")}'.`,
    );
  }
  if (data.last_notified_at || data.notified_at || data.activated_at) {
    fail("Waitlist entry was not reset to selectable state before activation.");
  }

  return data;
}

async function triggerWaitlistActivation() {
  const endpoint = `${stripTrailingSlash(supabaseUrl)}/functions/v1/admin-waitlist-batch-notify`;

  const payload = {
    region_slug: WAITLIST_REGION_SLUG,
    limit: 1,
    dry_run: false,
    open_region: false,
    notification_template_version: "onboarding_opening",
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-secret": adminSecret,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    fail(
      `waitlist activation trigger failed with HTTP ${response.status}: ${truncate(text, 500)}`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(`waitlist activation trigger returned non-JSON payload: ${truncate(text, 300)}`);
  }

  if (typeof parsed?.claimed_count !== "number" || parsed.claimed_count < 1) {
    fail(
      `waitlist activation trigger did not claim any entry for onboarding. response=${truncate(JSON.stringify(parsed), 300)}`,
    );
  }
  if (parsed.claimed_count !== 1) {
    fail(
      `waitlist activation trigger must claim exactly one entry. claimed_count=${String(parsed.claimed_count)} response=${truncate(JSON.stringify(parsed), 300)}`,
    );
  }
  if (typeof parsed.attempted_send_count !== "number" || parsed.attempted_send_count !== 1) {
    fail(
      `waitlist activation trigger must attempt exactly one onboarding send. attempted_send_count=${String(parsed.attempted_send_count)} response=${truncate(JSON.stringify(parsed), 300)}`,
    );
  }
  if (typeof parsed.sent_count !== "number" || parsed.sent_count !== 1) {
    fail(
      `waitlist activation trigger must report sent_count=1. sent_count=${String(parsed.sent_count)} response=${truncate(JSON.stringify(parsed), 300)}`,
    );
  }
  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    fail(
      `waitlist activation trigger returned errors: ${truncate(JSON.stringify(parsed.errors), 300)}`,
    );
  }

  return parsed;
}

async function verifyClaimedWaitlistEntry(params) {
  const { data, error } = await supabase
    .from("waitlist_entries")
    .select("id,status,last_notified_at,notified_at,activated_at")
    .eq("id", params.waitlistEntryId)
    .eq("user_id", TEST_USER_ID)
    .maybeSingle();

  if (error) {
    fail(`Unable to read claimed waitlist entry: ${formatSupabaseError(error)}`);
  }
  if (!data?.id) {
    fail("Claimed waitlist entry was not found after activation trigger.");
  }

  if (!ACCEPTED_WAITLIST_CLAIM_STATUSES.has(String(data.status ?? ""))) {
    fail(
      `Expected waitlist entry status to be one of [${Array.from(ACCEPTED_WAITLIST_CLAIM_STATUSES).join(", ")}], got '${String(data.status ?? "")}'.`,
    );
  }
  if (!data.last_notified_at) {
    fail("Expected claimed waitlist entry to have last_notified_at.");
  }
  if (data.status === "activated" && !data.activated_at) {
    fail("Expected activated waitlist entry to have activated_at.");
  }
}

async function requireConversationSession() {
  const data = await fetchConversationSessionOrNull();
  if (!data?.id) {
    fail("Conversation session was not found for test user.");
  }

  return data;
}

async function fetchConversationSessionOrNull() {
  const { data, error } = await supabase
    .from("conversation_sessions")
    .select("id,mode,state_token")
    .eq("user_id", TEST_USER_ID)
    .maybeSingle();

  if (error) {
    fail(`Unable to read conversation session: ${formatSupabaseError(error)}`);
  }

  return data;
}

async function pollSessionToken(params) {
  const session = await pollSessionTokenOrNull(params);
  if (session) {
    return session;
  }

  const latest = await fetchConversationSessionOrNull();
  fail(
    `Timed out waiting for state_token='${params.expectedToken}'. Last observed='${String(latest?.state_token ?? "null")}'.`,
  );
}

async function pollSessionTokenOrNull(params) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= params.timeoutMs) {
    const session = await fetchConversationSessionOrNull();
    if (session?.state_token === params.expectedToken) {
      return session;
    }

    await sleep(500);
  }

  return null;
}

async function ensureOnboardingSessionAfterActivation(params) {
  const existing = await pollSessionTokenOrNull({
    expectedToken: params.expectedToken,
    timeoutMs: 20_000,
  });
  if (existing) {
    return existing;
  }
  const latest = await fetchConversationSessionOrNull();
  const diagnostics = await collectActivationDiagnostics({
    referenceTimestampIso: params.referenceTimestampIso,
  });
  fail(
    `No onboarding session found after activation for expected state_token='${params.expectedToken}'. Last observed state_token='${String(latest?.state_token ?? "null")}'. activation_summary=${truncate(JSON.stringify(params.activationSummary), 400)} diagnostics=${truncate(JSON.stringify(diagnostics), 400)}`,
  );
}

async function collectActivationDiagnostics(params) {
  const [waitlistResult, openingEventResult, safetyHoldResult] = await Promise.all([
    supabase
      .from("waitlist_entries")
      .select("id,status,activated_at,last_notified_at,notified_at,updated_at")
      .eq("user_id", TEST_USER_ID)
      .eq("region_id", WAITLIST_REGION_ID)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("conversation_events")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", TEST_USER_ID)
      .eq("event_type", "onboarding_opening_sent")
      .gte("created_at", params.referenceTimestampIso),
    supabase
      .from("safety_holds")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", TEST_USER_ID)
      .eq("status", "active"),
  ]);

  return {
    waitlist_row: waitlistResult.error ? `error:${formatSupabaseError(waitlistResult.error)}` : waitlistResult.data,
    opening_event_count: openingEventResult.error
      ? `error:${formatSupabaseError(openingEventResult.error)}`
      : Number(openingEventResult.count ?? 0),
    active_safety_hold_count: safetyHoldResult.error
      ? `error:${formatSupabaseError(safetyHoldResult.error)}`
      : Number(safetyHoldResult.count ?? 0),
  };
}

async function assertOpeningMessageExists(params) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= params.timeoutMs) {
    const { count, error } = await supabase
      .from("sms_messages")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", TEST_USER_ID)
      .eq("direction", "out")
      .not("twilio_message_sid", "is", null)
      .gte("created_at", params.referenceTimestampIso);

    if (error) {
      fail(`Unable to validate opening message delivery: ${formatSupabaseError(error)}`);
    }
    if (Number(count ?? 0) >= 1) {
      return;
    }

    await sleep(500);
  }

  fail(
    `Opening message was not observed after waitlist activation within ${params.timeoutMs}ms.`,
  );
}

async function assertBurstTransitionEvent(params) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= params.timeoutMs) {
    const { data, error } = await supabase
      .from("conversation_events")
      .select("id")
      .eq("user_id", TEST_USER_ID)
      .eq("event_type", "onboarding_step_transition")
      .eq("step_token", ONBOARDING_AWAITING_BURST)
      .gte("created_at", params.sinceIso)
      .order("created_at", { ascending: true })
      .limit(1);

    if (error) {
      fail(`Unable to validate onboarding burst transition event: ${formatSupabaseError(error)}`);
    }

    if (Array.isArray(data) && data.length > 0) {
      return;
    }

    await sleep(500);
  }

  fail(
    "Did not observe onboarding burst transition event (event_type='onboarding_step_transition', step_token='onboarding:awaiting_burst') after explanation reply.",
  );
}

async function observeBurstStepMessages(params) {
  const rows = [];

  for (const stepId of ONBOARDING_STEP_IDS) {
    const idempotencyKey = buildStepIdempotencyKey({
      profileId: params.profileId,
      sessionId: params.sessionId,
      stepId,
    });
    const purpose = `onboarding_${stepId}`;

    const row = await pollBurstStepEvidence({
      stepId,
      purpose,
      idempotencyKey,
      referenceTimestampIso: params.referenceTimestampIso,
      timeoutMs: params.timeoutMsPerStep,
      pollIntervalMs: STEP_POLL_INTERVAL_MS,
    });

    rows.push(row);

    await pollSessionToken({
      expectedToken: resolveExpectedStateTokenAfterStep(stepId),
      timeoutMs: 20_000,
    });
  }

  return rows;
}

function assertStepOrderingAndTiming(params) {
  const timestamps = params.stepRows.map((row) => {
    const parsed = Date.parse(row.messageCreatedAt);
    if (!Number.isFinite(parsed)) {
      fail(`Unable to parse message_created_at for ${row.stepId}: '${String(row.messageCreatedAt)}'.`);
    }
    return parsed;
  });

  for (let i = 1; i < timestamps.length; i += 1) {
    if (timestamps[i] <= timestamps[i - 1]) {
      fail(
        `Out-of-order onboarding step delivery: ${params.stepRows[i - 1].stepId} at ${params.stepRows[i - 1].messageCreatedAt}, ${params.stepRows[i].stepId} at ${params.stepRows[i].messageCreatedAt}.`,
      );
    }
  }

  const gapOneTwo = timestamps[1] - timestamps[0];
  const gapTwoThree = timestamps[2] - timestamps[1];
  const gapThreeFour = timestamps[3] - timestamps[2];

  if (params.mode === "real") {
    if (gapOneTwo < MIN_REAL_GAP_MS) {
      fail(
        `Real-mode timing assertion failed: onboarding_message_2 arrived ${gapOneTwo}ms after onboarding_message_1 (expected >= ${MIN_REAL_GAP_MS}ms).`,
      );
    }
    if (gapTwoThree < MIN_REAL_GAP_MS) {
      fail(
        `Real-mode timing assertion failed: onboarding_message_3 arrived ${gapTwoThree}ms after onboarding_message_2 (expected >= ${MIN_REAL_GAP_MS}ms).`,
      );
    }
  }

  return [gapOneTwo, gapTwoThree, gapThreeFour];
}

async function pollBurstStepEvidence(params) {
  const correlationId = normalizeIdempotencyKeyForSmsCorrelation(params.idempotencyKey);
  const startedAt = Date.now();
  while (Date.now() - startedAt <= params.timeoutMs) {
    const messageRows = await fetchOutboundSmsMessagesByCorrelationId({
      correlationId,
      referenceTimestampIso: params.referenceTimestampIso,
    });

    if (messageRows.length > 1) {
      fail(
        `Duplicate sms_messages rows detected for idempotency_key='${params.idempotencyKey}' (correlation_id='${correlationId}'). Rows=${messageRows.length}.`,
      );
    }

    if (messageRows.length === 1) {
      const message = messageRows[0];
      const twilioMessageSid =
        typeof message.twilio_message_sid === "string" ? message.twilio_message_sid.trim() : "";
      if (twilioMessageSid) {
        return {
          stepId: params.stepId,
          purpose: params.purpose,
          idempotencyKey: params.idempotencyKey,
          correlationId,
          twilioMessageSid,
          messageId: message.id,
          messageCreatedAt: message.created_at,
          messageStatus: message.status ?? null,
          messageLastStatusAt: message.last_status_at ?? null,
        };
      }
    }

    await sleep(params.pollIntervalMs);
  }

  const diagnostics = await collectBurstEvidenceDiagnostics({
    referenceTimestampIso: params.referenceTimestampIso,
    correlationId,
  });
  fail(
    `Timed out waiting for onboarding burst evidence (purpose='${params.purpose}', idempotency_key='${params.idempotencyKey}', correlation_id='${correlationId}') via sms_messages.correlation_id. diagnostics=${truncate(JSON.stringify(diagnostics), 1200)}`,
  );
}

async function fetchOutboundSmsMessagesByCorrelationId(params) {
  const query = supabase
    .from("sms_messages")
    .select("id,created_at,correlation_id,twilio_message_sid,status,last_status_at")
    .eq("user_id", TEST_USER_ID)
    .eq("direction", "out")
    .eq("correlation_id", params.correlationId)
    .order("created_at", { ascending: true });

  if (params.referenceTimestampIso) {
    query.gte("created_at", params.referenceTimestampIso);
  }

  const { data, error } = await query;

  if (error) {
    fail(
      `Unable to read sms_messages for correlation_id='${params.correlationId}': ${formatSupabaseError(error)}`,
    );
  }

  return Array.isArray(data) ? data : [];
}

async function listBurstEvidenceForSession(params) {
  const rows = [];
  for (const stepId of ONBOARDING_STEP_IDS) {
    const idempotencyKey = buildStepIdempotencyKey({
      profileId: params.profileId,
      sessionId: params.sessionId,
      stepId,
    });
    const correlationId = normalizeIdempotencyKeyForSmsCorrelation(idempotencyKey);
    const matches = await fetchOutboundSmsMessagesByCorrelationId({
      correlationId,
      referenceTimestampIso: params.referenceTimestampIso,
    });

    if (matches.length > 1) {
      fail(
        `Duplicate sms_messages rows detected for idempotency_key='${idempotencyKey}' (correlation_id='${correlationId}'). Rows=${matches.length}.`,
      );
    }
    if (matches.length === 0) {
      continue;
    }

    const message = matches[0];
    const twilioMessageSid =
      typeof message.twilio_message_sid === "string" ? message.twilio_message_sid.trim() : "";
    if (!twilioMessageSid) {
      fail(
        `Burst sms_messages row missing twilio_message_sid for idempotency_key='${idempotencyKey}' (correlation_id='${correlationId}').`,
      );
    }

    rows.push({
      stepId,
      purpose: `onboarding_${stepId}`,
      idempotencyKey,
      correlationId,
      twilioMessageSid,
      messageId: message.id,
      messageCreatedAt: message.created_at,
      messageStatus: message.status ?? null,
      messageLastStatusAt: message.last_status_at ?? null,
    });
  }

  rows.sort((a, b) => Date.parse(a.messageCreatedAt) - Date.parse(b.messageCreatedAt));
  return rows;
}

function assertExactBurstEvidence(params) {
  if (params.rows.length !== ONBOARDING_STEP_IDS.length) {
    fail(
      `Expected exactly ${ONBOARDING_STEP_IDS.length} onboarding burst message evidences, found ${params.rows.length}. rows=${truncate(JSON.stringify(params.rows.map(toSqlEvidenceRow)), 800)}`,
    );
  }

  const seenIdempotency = new Set();
  for (const row of params.rows) {
    if (seenIdempotency.has(row.idempotencyKey)) {
      fail(`Duplicate burst idempotency_key observed: '${row.idempotencyKey}'.`);
    }
    seenIdempotency.add(row.idempotencyKey);
  }

  for (const stepId of ONBOARDING_STEP_IDS) {
    const expectedIdempotencyKey = buildStepIdempotencyKey({
      profileId: params.profileId,
      sessionId: params.sessionId,
      stepId,
    });
    const expectedPurpose = `onboarding_${stepId}`;
    const row = params.rows.find((candidate) => candidate.idempotencyKey === expectedIdempotencyKey);
    if (!row) {
      fail(`Missing burst evidence row for idempotency_key='${expectedIdempotencyKey}'.`);
    }
    if (row.purpose !== expectedPurpose) {
      fail(
        `Burst purpose mismatch for idempotency_key='${expectedIdempotencyKey}'. Expected '${expectedPurpose}', got '${String(row.purpose ?? "")}'.`,
      );
    }
  }
}

async function runBurstDrainCheck(params) {
  await sleep(params.waitMs);
  const rowsAfterWait = await listBurstEvidenceForSession({
    profileId: params.profileId,
    sessionId: params.sessionId,
    referenceTimestampIso: params.referenceTimestampIso,
  });
  assertExactBurstEvidence({
    profileId: params.profileId,
    sessionId: params.sessionId,
    rows: rowsAfterWait,
  });

  const before = params.baselineRows.map((row) => `${row.idempotencyKey}:${row.twilioMessageSid}`).sort();
  const after = rowsAfterWait.map((row) => `${row.idempotencyKey}:${row.twilioMessageSid}`).sort();
  if (before.length !== after.length || before.some((value, index) => value !== after[index])) {
    fail(
      `Drain check failed: onboarding burst evidence changed after ${params.waitMs}ms. before=${truncate(JSON.stringify(before), 500)} after=${truncate(JSON.stringify(after), 500)}`,
    );
  }

  return {
    wait_ms: params.waitMs,
    baseline_burst_rows: before.length,
    burst_rows_after_wait: after.length,
    changed: false,
  };
}

async function countDeliveredRowsByOutboundIdempotency(params) {
  const rows = await fetchOutboundSmsMessagesByCorrelationId({
    correlationId: normalizeIdempotencyKeyForSmsCorrelation(params.idempotencyKey),
  });
  if (rows.length > 1) {
    fail(
      `Duplicate sms_messages rows detected for idempotency_key='${params.idempotencyKey}' during idempotency verification.`,
    );
  }
  if (rows.length === 0) {
    return 0;
  }

  const twilioMessageSid = typeof rows[0].twilio_message_sid === "string"
    ? rows[0].twilio_message_sid.trim()
    : "";
  if (twilioMessageSid.length === 0) {
    return 0;
  }

  return 1;
}

function buildGapEvidenceRows(stepRows) {
  const rows = [];
  for (let index = 1; index < stepRows.length; index += 1) {
    const previous = stepRows[index - 1];
    const current = stepRows[index];
    rows.push({
      from_step: previous.stepId,
      to_step: current.stepId,
      gap_ms: Date.parse(current.messageCreatedAt) - Date.parse(previous.messageCreatedAt),
      from_message_created_at: previous.messageCreatedAt,
      to_message_created_at: current.messageCreatedAt,
    });
  }
  return rows;
}

function toSqlEvidenceRow(row) {
  return {
    step_id: row.stepId,
    purpose: row.purpose,
    idempotency_key: row.idempotencyKey,
    correlation_id: row.correlationId,
    twilio_message_sid: row.twilioMessageSid,
    message_created_at: row.messageCreatedAt,
    status: row.messageStatus,
    last_status_at: row.messageLastStatusAt,
  };
}

function buildStepIdempotencyPrefix(params) {
  return `onboarding:${params.profileId}:${params.sessionId}:`;
}

function buildBurstEvidenceQuerySql() {
  return "select id, created_at, correlation_id, twilio_message_sid, status, last_status_at from public.sms_messages where user_id = :user_id and direction = 'out' and correlation_id = :correlation_id and created_at >= :reference_timestamp order by created_at asc;";
}

function buildIdempotencyQuerySql() {
  return "select id, created_at, correlation_id, twilio_message_sid, status from public.sms_messages where user_id = :user_id and direction = 'out' and correlation_id = :correlation_id order by created_at asc;";
}

async function collectBurstEvidenceDiagnostics(params) {
  const [messagesResult, jobsResult] = await Promise.all([
    supabase
      .from("sms_messages")
      .select("id,created_at,correlation_id,twilio_message_sid,status,last_status_at")
      .eq("user_id", TEST_USER_ID)
      .eq("direction", "out")
      .gte("created_at", params.referenceTimestampIso)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("sms_outbound_jobs")
      .select("id,created_at,purpose,idempotency_key,twilio_message_sid,status,last_status_at")
      .eq("user_id", TEST_USER_ID)
      .gte("created_at", params.referenceTimestampIso)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  return {
    expected_correlation_id: params.correlationId,
    sms_messages_query: buildBurstEvidenceQuerySql(),
    sms_outbound_jobs_query:
      "select id, created_at, purpose, idempotency_key, twilio_message_sid, status, last_status_at from public.sms_outbound_jobs where user_id = :user_id and created_at >= :reference_timestamp order by created_at desc limit 8;",
    sms_messages: messagesResult.error
      ? `error:${formatSupabaseError(messagesResult.error)}`
      : messagesResult.data,
    sms_outbound_jobs: jobsResult.error
      ? `error:${formatSupabaseError(jobsResult.error)}`
      : jobsResult.data,
  };
}

function normalizeIdempotencyKeyForSmsCorrelation(idempotencyKey) {
  const normalized = idempotencyKey.trim();
  if (UUID_PATTERN.test(normalized)) {
    return normalized;
  }

  return deterministicUuidFromString(normalized);
}

function deterministicUuidFromString(input) {
  const hex = [
    fnv1a32(`0:${input}`),
    fnv1a32(`1:${input}`),
    fnv1a32(`2:${input}`),
    fnv1a32(`3:${input}`),
  ]
    .map((part) => part.toString(16).padStart(8, "0"))
    .join("");

  const chars = hex.split("");
  chars[12] = "5";
  const variant = parseInt(chars[16] ?? "0", 16);
  chars[16] = ((variant & 0x3) | 0x8).toString(16);
  const canonical = chars.join("");

  return `${canonical.slice(0, 8)}-${canonical.slice(8, 12)}-${canonical.slice(12, 16)}-${
    canonical.slice(16, 20)
  }-${canonical.slice(20, 32)}`;
}

function fnv1a32(input) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}

async function submitDuplicateStepPayloadTwice(params) {
  if (harnessMode === "stub") {
    await invokeOnboardingStepDirect(params.payload);
    await invokeOnboardingStepDirect(params.payload);
    return;
  }

  await publishOnboardingStepViaQStash({ payload: params.payload, delayMs: 0 });
  await publishOnboardingStepViaQStash({ payload: params.payload, delayMs: 0 });

  await sleep(2_500);
}

async function invokeOnboardingStepDirect(payload) {
  const endpoint = new URL("/api/onboarding/step", appBaseUrl).toString();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-harness-qstash-stub": "1",
      "x-admin-secret": adminSecret,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.text();
  if (!response.ok) {
    fail(
      `Stub step invocation failed (HTTP ${response.status}) for step='${payload.step_id}': ${truncate(body, 500)}`,
    );
  }
}

async function publishOnboardingStepViaQStash(params) {
  try {
    await createHarnessQStashClient().publishJSON({
      url: new URL("/api/onboarding/step", appBaseUrl).toString(),
      body: params.payload,
      delay: Math.ceil(params.delayMs / 1000),
    });
  } catch (error) {
    fail(
      `QStash publish failed for step='${params.payload.step_id}': ${errorToMessage(error)}`,
    );
  }
}

function buildStepIdempotencyKey(params) {
  return `${buildStepIdempotencyPrefix({
    profileId: params.profileId,
    sessionId: params.sessionId,
  })}${params.stepId}`;
}

function buildStepPayload(params) {
  return {
    profile_id: params.profileId,
    session_id: params.sessionId,
    step_id: params.stepId,
    expected_state_token: params.expectedStateToken,
    idempotency_key: buildStepIdempotencyKey({
      profileId: params.profileId,
      sessionId: params.sessionId,
      stepId: params.stepId,
    }),
  };
}

function resolveExpectedStateTokenAfterStep(stepId) {
  if (stepId === "onboarding_message_4") {
    return ONBOARDING_AWAITING_INTERVIEW_START;
  }
  return ONBOARDING_AWAITING_BURST;
}

async function invokeSignedTwilioInbound(params) {
  const endpoint = `${stripTrailingSlash(supabaseUrl)}/functions/v1/twilio-inbound`;
  const toE164 = readOptionalEnv("TWILIO_FROM_NUMBER") ?? TEST_PHONE_E164;
  const messageSid = buildTwilioMessageSid();

  const payload = new URLSearchParams({
    From: TEST_PHONE_E164,
    To: toE164,
    Body: params.body,
    MessageSid: messageSid,
    NumMedia: "0",
  });

  const signature = computeTwilioSignature(endpoint, payload, params.twilioAuthToken);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
    body: payload.toString(),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    fail(
      `twilio-inbound invocation failed with HTTP ${response.status}: ${truncate(responseBody, 500)}`,
    );
  }
}

function assertNoStateBleed(cycleOne, cycleTwo) {
  if (cycleOne.stepRows.length !== cycleTwo.stepRows.length) {
    fail(
      `State bleed detected: cycle step counts differ (${cycleOne.stepRows.length} vs ${cycleTwo.stepRows.length}).`,
    );
  }

  const cycleOneOrder = cycleOne.stepRows.map((row) => row.stepId).join(",");
  const cycleTwoOrder = cycleTwo.stepRows.map((row) => row.stepId).join(",");
  if (cycleOneOrder !== cycleTwoOrder) {
    fail(`State bleed detected: step order mismatch (${cycleOneOrder} vs ${cycleTwoOrder}).`);
  }

  if (
    cycleOne.burstEvidenceCount !== ONBOARDING_STEP_IDS.length ||
    cycleTwo.burstEvidenceCount !== ONBOARDING_STEP_IDS.length
  ) {
    fail(
      `State bleed detected: burst evidence counts mismatch (cycle_1=${cycleOne.burstEvidenceCount}, cycle_2=${cycleTwo.burstEvidenceCount}).`,
    );
  }

  if (cycleOne.idempotencyRowCount !== 1 || cycleTwo.idempotencyRowCount !== 1) {
    fail(
      `State bleed detected: idempotency counts mismatch (cycle_1=${cycleOne.idempotencyRowCount}, cycle_2=${cycleTwo.idempotencyRowCount}).`,
    );
  }

  if (cycleOne.drainCheck.changed || cycleTwo.drainCheck.changed) {
    fail(
      `State bleed detected: drain check changed flag unexpected (cycle_1=${String(cycleOne.drainCheck.changed)}, cycle_2=${String(cycleTwo.drainCheck.changed)}).`,
    );
  }
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

function parseHarnessMode(value) {
  const normalized = value.trim().toLowerCase();
  if (!HARNESS_MODE_VALUES.has(normalized)) {
    fail(
      `HARNESS_QSTASH_MODE must be one of: stub, real. Received '${value}'.`,
    );
  }
  return normalized;
}

function resolveAppBaseUrl() {
  const explicit = readOptionalEnv("APP_BASE_URL");
  if (explicit) {
    assertValidUrl(explicit, "APP_BASE_URL");
    return explicit;
  }

  const vercelUrl = readOptionalEnv("VERCEL_URL");
  if (vercelUrl) {
    const candidate = `https://${vercelUrl}`;
    assertValidUrl(candidate, "VERCEL_URL");
    return candidate;
  }

  if (appEnv === "staging") {
    return "https://josh-2-0-staging.vercel.app";
  }

  if (appEnv === "production") {
    return "https://www.callmejosh.ai";
  }

  fail("Missing required env var: APP_BASE_URL or VERCEL_URL");
}

function createHarnessQStashClient() {
  if (harnessQStashClient) {
    return harnessQStashClient;
  }

  const options = { token: qstashToken };
  const qstashUrl = readOptionalEnv("QSTASH_URL");
  if (qstashUrl) {
    options.baseUrl = qstashUrl.replace(/\/+$/, "");
  }

  harnessQStashClient = new QStashClient(options);
  return harnessQStashClient;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    fail(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function readOptionalEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return null;
  }
  return value.trim();
}

function assertValidUrl(value, envName) {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      fail(`${envName} must use http or https.`);
    }
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

function buildTwilioMessageSid() {
  const randomHex = crypto.randomBytes(16).toString("hex");
  return `SM${randomHex}`;
}

function computeTwilioSignature(url, params, authToken) {
  const keys = Array.from(new Set(params.keys())).sort();
  let base = url;
  for (const key of keys) {
    const values = params.getAll(key);
    for (const value of values) {
      base += key + value;
    }
  }

  return crypto.createHmac("sha1", authToken).update(base).digest("base64");
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
    (combined.includes("relation") && combined.includes("does not exist"))
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

function errorToMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
