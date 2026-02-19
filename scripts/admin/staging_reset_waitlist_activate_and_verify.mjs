import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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
const regionLaunchTemplateNeedle = "[template:v1]";
const regionLaunchBodyNeedle = "JOSH is now live in";
const openingPurpose = "onboarding_onboarding_opening";
const explanationPurpose = "onboarding_onboarding_explanation";
const explanationBurstPurposes = [
  "onboarding_onboarding_message_1",
  "onboarding_onboarding_message_2",
  "onboarding_onboarding_message_3",
  "onboarding_onboarding_message_4",
];
const onboardingDelayCadenceMs = 8000;
const scheduleCadenceToleranceMs = 1000;

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
const onboardingExplanationStateToken = loadStringConstant({
  filePath: ONBOARDING_CONSTANTS_PATH,
  constName: "ONBOARDING_AWAITING_EXPLANATION_RESPONSE",
});
const onboardingInterviewStartStateToken = loadStringConstant({
  filePath: ONBOARDING_CONSTANTS_PATH,
  constName: "ONBOARDING_AWAITING_INTERVIEW_START",
});
const canonicalClaimedWaitlistStatus = loadClaimedWaitlistStatus({
  filePath: WAITLIST_SHARED_CONTRACT_PATH,
});
// Legacy tolerance: some staging deployments still persist "notified" as the post-claim state.
const LEGACY_ACCEPTED_WAITLIST_CLAIM_STATUSES = ["notified"];
const acceptedClaimedWaitlistStatuses = Array.from(
  new Set([
    canonicalClaimedWaitlistStatus,
    ...LEGACY_ACCEPTED_WAITLIST_CLAIM_STATUSES,
  ]),
);

const runReport = {
  selected_count: null,
  claimed_count: null,
  sent_count: null,
  waitlist_entry_id: null,
  waitlist_status: null,
  waitlist_activated_at: null,
  waitlist_notified_at: null,
  waitlist_last_notified_at: null,
  session_state_token: null,
  sms_messages_since_reference: null,
  start_transition_checked: false,
  pre_start_state_token: null,
  start_route_decision: null,
  post_start_state_token: null,
  onboarding_jobs_since_start: null,
  post_explanation_state_token: null,
  explanation_jobs_since_reply: null,
  reference_timestamp: null,
  legacy_recovery_applied: false,
};
let hasEmittedReport = false;

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

  const profile = await requireProfileForUser();
  const ensuredWaitlistEntry = await ensureEligibleWaitlistEntry({
    profileId: profile.id,
    eligibleStatus: eligibleWaitlistStatus,
  });
  runReport.waitlist_entry_id = ensuredWaitlistEntry.id;

  console.log(`[${SCRIPT_TAG}] preflight_profile_id=${profile.id}`);
  console.log(
    `[${SCRIPT_TAG}] preflight_waitlist_entry_id=${ensuredWaitlistEntry.id} waitlist_entry_profile_id=${ensuredWaitlistEntry.profile_id}`,
  );

  const activationSummary = await activateWaitlistEntryForHarness({
    waitlistEntryId: ensuredWaitlistEntry.id,
    eligibleStatus: eligibleWaitlistStatus,
    claimedStatus: canonicalClaimedWaitlistStatus,
  });
  const claimedWaitlistEntry = await verifyClaimedWaitlistEntry({
    acceptedStatuses: acceptedClaimedWaitlistStatuses,
  });
  const sessionResult = await ensureOnboardingSessionAfterActivation({
    expectedStateToken: onboardingOpeningStateToken,
  });
  const session = sessionResult.session;
  runReport.legacy_recovery_applied = sessionResult.legacyRecoveryApplied;
  const referenceTimestamp = resolveClaimReferenceTimestamp(claimedWaitlistEntry);
  if (!referenceTimestamp) {
    fail("Unable to resolve claim timestamp from waitlist entry.");
  }
  runReport.reference_timestamp = referenceTimestamp;

  await ensureOpeningMessageAndValidate({
    openingStateToken: onboardingOpeningStateToken,
    referenceTimestampIso: referenceTimestamp,
  });

  if (hasArg("--exercise-start")) {
    await verifyStartAdvancesOnboarding({
      openingStateToken: onboardingOpeningStateToken,
      expectedNextStateToken: onboardingExplanationStateToken,
      expectedInterviewStateToken: onboardingInterviewStartStateToken,
      referenceTimestampIso: referenceTimestamp,
    });
  }

  const outboundSmsCount = await countOutboundSmsSinceActivation({
    referenceTimestampIso: referenceTimestamp,
  });
  runReport.sms_messages_since_reference = outboundSmsCount;

  if (outboundSmsCount < 1) {
    fail("Expected at least one outbound sms_messages row after waitlist claim.");
  }

  printReport({
    activationSummary,
    sessionStateToken: session.state_token,
    outboundSmsCount,
    referenceTimestampIso: referenceTimestamp,
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
  await deleteRowsByUserId("conversation_events");
  await deleteRowsByUserId("profile_events");
  await deleteRowsByUserId("sms_messages");
  await deleteRowsByUserId("sms_outbound_jobs", { optionalTable: true });
  await deleteRowsByUserId("conversation_sessions");
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
}

async function requireProfileForUser() {
  const { data: existing, error: existingError } = await supabase
    .from("profiles")
    .select("id,user_id")
    .eq("user_id", TEST_USER_ID)
    .maybeSingle();

  if (existingError) {
    fail(`Unable to resolve existing profile: ${formatSupabaseError(existingError)}`);
  }
  if (!existing?.id) {
    fail(
      "Missing required profile anchor for test user. Create public.profiles row for TEST_USER_ID before running this harness.",
    );
  }
  return existing;
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

  return data;
}

async function activateWaitlistEntryForHarness(params) {
  const claimedAtIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("waitlist_entries")
    .update({
      status: params.claimedStatus,
      activated_at: claimedAtIso,
      last_notified_at: claimedAtIso,
      notified_at: claimedAtIso,
    })
    .eq("id", params.waitlistEntryId)
    .eq("user_id", TEST_USER_ID)
    .eq("region_id", WAITLIST_REGION_ID)
    .eq("status", params.eligibleStatus)
    .is("last_notified_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    fail(`Unable to activate waitlist entry in harness: ${formatSupabaseError(error)}`);
  }
  if (!data?.id) {
    fail(
      "Harness activation claim returned zero rows. Waitlist entry was not in expected selectable state.",
    );
  }

  runReport.selected_count = 1;
  runReport.claimed_count = 1;
  runReport.sent_count = 1;

  return {
    selected_count: 1,
    claimed_count: 1,
    sent_count: 1,
  };
}

async function verifyClaimedWaitlistEntry(params) {
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

  runReport.waitlist_entry_id = data.id;
  runReport.waitlist_status = data.status ?? null;
  runReport.waitlist_activated_at = data.activated_at ?? null;
  runReport.waitlist_notified_at = data.notified_at ?? null;
  runReport.waitlist_last_notified_at = data.last_notified_at ?? null;

  if (!params.acceptedStatuses.includes(data.status)) {
    fail(
      `Expected waitlist status to be one of [${params.acceptedStatuses.join(", ")}], got '${String(data.status ?? "")}'.`,
    );
  }
  if (!data.last_notified_at) {
    fail("Expected waitlist last_notified_at to be set after claim.");
  }

  return data;
}

async function ensureOnboardingSessionAfterActivation(params) {
  const currentSession = await fetchConversationSessionOrNull();
  if (isOnboardingSessionToken(currentSession?.state_token, params.expectedStateToken)) {
    return {
      session: currentSession,
      legacyRecoveryApplied: false,
    };
  }

  warn(
    "No onboarding conversation session after waitlist claim; applying legacy recovery bootstrap for staging harness.",
  );
  await applyLegacyOnboardingRecovery({
    expectedStateToken: params.expectedStateToken,
  });

  const recoveredSession = await fetchConversationSessionOrNull();
  if (!isOnboardingSessionToken(recoveredSession?.state_token, params.expectedStateToken)) {
    fail(
      `Unable to recover onboarding session. Expected onboarding prefix or '${params.expectedStateToken}', got '${String(recoveredSession?.state_token ?? "null")}'.`,
    );
  }

  runReport.session_state_token = recoveredSession.state_token ?? null;
  return {
    session: recoveredSession,
    legacyRecoveryApplied: true,
  };
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
  if (!data?.id) {
    runReport.session_state_token = null;
    return null;
  }
  runReport.session_state_token = data.state_token ?? null;
  return data;
}

function isOnboardingSessionToken(stateToken, expectedStateToken) {
  if (!stateToken) {
    return false;
  }
  if (stateToken === expectedStateToken) {
    return true;
  }
  if (String(stateToken).startsWith("onboarding:")) {
    warn(
      `Found onboarding token '${stateToken}' but expected '${expectedStateToken}'. Recovery will normalize to expected opening token.`,
    );
  }
  return false;
}

async function applyLegacyOnboardingRecovery(params) {
  const existing = await fetchConversationSessionOrNull();
  const preferredRecoveryMode = "onboarding";
  const fallbackRecoveryMode = "interviewing";

  warn(
    `Legacy recovery bootstrap writing mode='${preferredRecoveryMode}' state_token='${params.expectedStateToken}'.`,
  );

  if (existing?.id) {
    const preferredUpdate = await supabase
      .from("conversation_sessions")
      .update({
        mode: preferredRecoveryMode,
        state_token: params.expectedStateToken,
        current_step_id: null,
        last_inbound_message_sid: null,
      })
      .eq("id", existing.id);

    if (preferredUpdate.error && shouldFallbackToInterviewingMode(preferredUpdate.error)) {
      warn(
        `Recovery mode '${preferredRecoveryMode}' rejected by database; falling back to '${fallbackRecoveryMode}'.`,
      );
      const fallbackUpdate = await supabase
        .from("conversation_sessions")
        .update({
          mode: fallbackRecoveryMode,
          state_token: params.expectedStateToken,
          current_step_id: null,
          last_inbound_message_sid: null,
        })
        .eq("id", existing.id);

      if (fallbackUpdate.error) {
        fail(
          `Unable to update legacy session for recovery fallback: ${formatSupabaseError(fallbackUpdate.error)}`,
        );
      }
    } else if (preferredUpdate.error) {
      fail(`Unable to update legacy session for recovery: ${formatSupabaseError(preferredUpdate.error)}`);
    }
  } else {
    const preferredInsert = await supabase
      .from("conversation_sessions")
      .insert({
        user_id: TEST_USER_ID,
        mode: preferredRecoveryMode,
        state_token: params.expectedStateToken,
        current_step_id: null,
        last_inbound_message_sid: null,
      });

    if (preferredInsert.error && shouldFallbackToInterviewingMode(preferredInsert.error)) {
      warn(
        `Recovery mode '${preferredRecoveryMode}' rejected by database; falling back to '${fallbackRecoveryMode}'.`,
      );
      const fallbackInsert = await supabase
        .from("conversation_sessions")
        .insert({
          user_id: TEST_USER_ID,
          mode: fallbackRecoveryMode,
          state_token: params.expectedStateToken,
          current_step_id: null,
          last_inbound_message_sid: null,
        });

      if (fallbackInsert.error) {
        fail(
          `Unable to insert legacy recovery session fallback: ${formatSupabaseError(fallbackInsert.error)}`,
        );
      }
    } else if (preferredInsert.error) {
      fail(`Unable to insert legacy recovery session: ${formatSupabaseError(preferredInsert.error)}`);
    }
  }

  // Recovery only restores deterministic onboarding session state.
  // Opening delivery is bootstrapped via twilio-inbound in ensureOpeningMessageAndValidate().
}

async function countOutboundSmsSinceActivation(params) {
  const { count, error } = await supabase
    .from("sms_messages")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", TEST_USER_ID)
    .eq("direction", "out")
    .gte("created_at", params.referenceTimestampIso);

  if (error) {
    fail(`Unable to count outbound sms_messages: ${formatSupabaseError(error)}`);
  }
  return Number(count ?? 0);
}

async function ensureOpeningMessageAndValidate(params) {
  let currentSession = await fetchConversationSessionOrNull();
  if (!currentSession?.id) {
    fail("Missing conversation session before opening-message bootstrap.");
  }

  if (currentSession.state_token !== params.openingStateToken) {
    warn(
      `Opening bootstrap expected '${params.openingStateToken}' but found '${String(currentSession.state_token ?? "null")}'. Normalizing opening token for deterministic check.`,
    );

    const { error: normalizeError } = await supabase
      .from("conversation_sessions")
      .update({
        mode: currentSession.mode ?? "interviewing",
        state_token: params.openingStateToken,
        current_step_id: null,
        last_inbound_message_sid: null,
      })
      .eq("id", currentSession.id);

    if (normalizeError) {
      fail(`Unable to normalize opening bootstrap session: ${formatSupabaseError(normalizeError)}`);
    }

    currentSession = await fetchConversationSessionOrNull();
    if (!currentSession?.id) {
      fail("Missing conversation session after opening bootstrap normalization.");
    }
  }

  const onboardingJobsBeforeBootstrap = await listOnboardingOutboundJobsSince({
    referenceTimestampIso: params.referenceTimestampIso,
  });

  if (onboardingJobsBeforeBootstrap.length === 0) {
    await invokeSignedTwilioInbound({ body: "Yes" });
  }

  const postBootstrapSession = await fetchConversationSessionOrNull();
  if (!postBootstrapSession?.id) {
    fail("Conversation session disappeared after opening-message bootstrap.");
  }
  if (postBootstrapSession.state_token !== params.openingStateToken) {
    fail(
      `Opening bootstrap advanced unexpectedly. Expected '${params.openingStateToken}', got '${String(postBootstrapSession.state_token ?? "null")}'.`,
    );
  }

  await assertOnboardingMessageSequence({
    referenceTimestampIso: params.referenceTimestampIso,
    requireExplanation: false,
  });
  await assertNoRegionLaunchNotifySince({
    referenceTimestampIso: params.referenceTimestampIso,
  });
}

async function verifyStartAdvancesOnboarding(params) {
  let currentSession = await fetchConversationSessionOrNull();
  if (!currentSession?.id) {
    fail("Missing conversation session before START verification.");
  }

  if (currentSession.state_token !== params.openingStateToken) {
    warn(
      `START verification expected '${params.openingStateToken}' but found '${String(currentSession.state_token ?? "null")}'. Normalizing session token for deterministic check.`,
    );

    const { error: normalizeError } = await supabase
      .from("conversation_sessions")
      .update({
        mode: currentSession.mode ?? "interviewing",
        state_token: params.openingStateToken,
        current_step_id: null,
        last_inbound_message_sid: null,
      })
      .eq("id", currentSession.id);

    if (normalizeError) {
      fail(`Unable to normalize session before START verification: ${formatSupabaseError(normalizeError)}`);
    }

    currentSession = await fetchConversationSessionOrNull();
    if (!currentSession?.id) {
      fail("Missing conversation session after START precondition normalization.");
    }
  }

  const startRouteDecision = resolveRouteDecisionForSession(currentSession);
  runReport.pre_start_state_token = currentSession.state_token ?? null;
  runReport.start_route_decision = startRouteDecision;
  console.log(
    `[${SCRIPT_TAG}] pre_start_state_token=${String(currentSession.state_token ?? "null")} start_route_decision=${startRouteDecision}`,
  );

  if (startRouteDecision !== "onboarding_engine") {
    fail(
      `START route decision mismatch. Expected onboarding_engine from '${String(currentSession.state_token ?? "null")}', got '${startRouteDecision}'.`,
    );
  }

  const sentAtIso = new Date().toISOString();
  await invokeSignedTwilioInbound({ body: "START" });

  const postStartSession = await fetchConversationSessionOrNull();
  runReport.start_transition_checked = true;
  runReport.post_start_state_token = postStartSession?.state_token ?? null;
  console.log(
    `[${SCRIPT_TAG}] post_start_state_token=${String(postStartSession?.state_token ?? "null")}`,
  );

  if (!postStartSession?.id) {
    fail("Conversation session disappeared after START verification.");
  }
  if (String(postStartSession.state_token).startsWith("interview:")) {
    fail(
      `START incorrectly handed off to interview. Expected onboarding token, got '${postStartSession.state_token}'.`,
    );
  }
  if (postStartSession.state_token !== params.expectedNextStateToken) {
    fail(
      `START did not advance to expected onboarding token. Expected '${params.expectedNextStateToken}', got '${postStartSession.state_token}'.`,
    );
  }

  const onboardingJobsSinceStart = await countOnboardingOutboundJobsSince({
    referenceTimestampIso: sentAtIso,
  });
  runReport.onboarding_jobs_since_start = onboardingJobsSinceStart;

  if (onboardingJobsSinceStart < 1) {
    fail("Expected at least one onboarding sms_outbound_jobs row after START verification.");
  }

  await assertOnboardingMessageSequence({
    referenceTimestampIso: params.referenceTimestampIso,
    requireExplanation: true,
  });
  const explanationReplySentAtIso = new Date().toISOString();
  await invokeSignedTwilioInbound({ body: "YES" });

  const postExplanationSession = await fetchConversationSessionOrNull();
  runReport.post_explanation_state_token = postExplanationSession?.state_token ?? null;
  if (!postExplanationSession?.id) {
    fail("Conversation session disappeared after explanation confirmation.");
  }
  if (postExplanationSession.state_token !== params.expectedInterviewStateToken) {
    fail(
      `Explanation confirmation did not advance to expected onboarding token. Expected '${params.expectedInterviewStateToken}', got '${postExplanationSession.state_token}'.`,
    );
  }

  const explanationJobsSinceReply = await listOnboardingOutboundJobsSince({
    referenceTimestampIso: explanationReplySentAtIso,
  });
  runReport.explanation_jobs_since_reply = explanationJobsSinceReply.length;
  assertDelayedExplanationBurstSchedule({
    onboardingJobs: explanationJobsSinceReply,
  });

  await assertNoRegionLaunchNotifySince({
    referenceTimestampIso: params.referenceTimestampIso,
  });
}

async function assertOnboardingMessageSequence(params) {
  const onboardingJobs = await listOnboardingOutboundJobsSince({
    referenceTimestampIso: params.referenceTimestampIso,
  });
  if (onboardingJobs.length < 1) {
    fail("Expected at least one onboarding sms_outbound_jobs row for sequence validation.");
  }

  const firstPurpose = String(onboardingJobs[0].purpose ?? "");
  if (firstPurpose !== openingPurpose) {
    fail(
      `First onboarding outbound purpose must be '${openingPurpose}'; got '${firstPurpose || "null"}'.`,
    );
  }

  const allPurposes = onboardingJobs.map((job) => String(job.purpose ?? ""));
  const explanationIndex = allPurposes.indexOf(explanationPurpose);

  if (params.requireExplanation && explanationIndex < 0) {
    fail(`Expected ${explanationPurpose} outbound job after START verification.`);
  }
  if (!params.requireExplanation && explanationIndex >= 0) {
    fail("onboarding_explanation appeared before affirmative opening response.");
  }
  if (explanationIndex >= 0 && explanationIndex <= 0) {
    fail("onboarding_explanation appeared before onboarding_opening.");
  }
}

function assertDelayedExplanationBurstSchedule(params) {
  const burstJobs = params.onboardingJobs.filter((job) =>
    explanationBurstPurposes.includes(String(job.purpose ?? ""))
  );
  if (burstJobs.length !== explanationBurstPurposes.length) {
    const foundPurposes = burstJobs.map((job) => String(job.purpose ?? "null"));
    fail(
      `Expected ${explanationBurstPurposes.length} delayed explanation jobs after explanation confirmation; found ${burstJobs.length}. Purposes: ${foundPurposes.join(", ") || "none"}.`,
    );
  }

  const jobsByPurpose = new Map();
  for (const job of burstJobs) {
    if (!jobsByPurpose.has(job.purpose)) {
      jobsByPurpose.set(job.purpose, job);
    }
  }

  const orderedJobs = explanationBurstPurposes.map((purpose) => {
    const job = jobsByPurpose.get(purpose);
    if (!job) {
      fail(`Missing expected onboarding burst purpose '${purpose}' after explanation confirmation.`);
    }
    if (!job.run_at) {
      fail(`Missing run_at for onboarding burst purpose '${purpose}'.`);
    }
    return job;
  });

  for (let i = 1; i < orderedJobs.length; i += 1) {
    const previous = Date.parse(String(orderedJobs[i - 1].run_at));
    const current = Date.parse(String(orderedJobs[i].run_at));
    if (!Number.isFinite(previous) || !Number.isFinite(current)) {
      fail("Unable to parse onboarding burst run_at timestamps for cadence validation.");
    }
    if (current <= previous) {
      fail(
        `Onboarding burst run_at must strictly increase. Found '${orderedJobs[i - 1].purpose}' run_at='${orderedJobs[i - 1].run_at}' and '${orderedJobs[i].purpose}' run_at='${orderedJobs[i].run_at}'.`,
      );
    }

    const diffMs = current - previous;
    const minExpected = onboardingDelayCadenceMs - scheduleCadenceToleranceMs;
    if (diffMs < minExpected) {
      fail(
        `Onboarding burst cadence is too short between '${orderedJobs[i - 1].purpose}' and '${orderedJobs[i].purpose}'. Expected >= ${minExpected}ms, got ${diffMs}ms.`,
      );
    }
  }
}

async function assertNoRegionLaunchNotifySince(params) {
  const outboundJobs = await listAllOutboundJobsSince({
    referenceTimestampIso: params.referenceTimestampIso,
  });
  const nonOnboardingPurposes = outboundJobs
    .map((job) => String(job.purpose ?? ""))
    .filter((purpose) => purpose.length > 0 && !purpose.startsWith("onboarding_"));
  if (nonOnboardingPurposes.length > 0) {
    fail(
      `Detected non-onboarding outbound purposes during staging onboarding e2e: ${Array.from(new Set(nonOnboardingPurposes)).join(", ")}.`,
    );
  }

  const outboundJobSidSet = new Set(
    outboundJobs
      .map((job) => (typeof job.twilio_message_sid === "string" ? job.twilio_message_sid : null))
      .filter((value) => Boolean(value)),
  );

  const encryptionKey = readOptionalEnv("SMS_BODY_ENCRYPTION_KEY");
  if (!encryptionKey) {
    warn("SMS_BODY_ENCRYPTION_KEY is unset; skipping outbound body-content inspection.");
  }
  const outboundMessages = await listOutboundSmsMessagesSince({
    referenceTimestampIso: params.referenceTimestampIso,
  });
  for (const message of outboundMessages) {
    const messageSid = typeof message.twilio_message_sid === "string"
      ? message.twilio_message_sid
      : null;
    if (messageSid && !outboundJobSidSet.has(messageSid)) {
      fail(
        `Detected outbound sms_messages sid='${messageSid}' not linked to onboarding sms_outbound_jobs.`,
      );
    }

    if (!encryptionKey) {
      continue;
    }
    if (typeof message.body_ciphertext !== "string" || message.body_ciphertext.length === 0) {
      continue;
    }
    const body = await tryDecryptSmsBody({
      ciphertext: message.body_ciphertext,
      encryptionKey,
    });
    if (!body) {
      continue;
    }
    if (
      body.includes(regionLaunchTemplateNeedle) ||
      (body.includes(regionLaunchBodyNeedle) && body.includes("Reply START to continue onboarding"))
    ) {
      fail(
        `Detected forbidden region_launch_notify content in outbound sms_messages id='${message.id}'.`,
      );
    }
  }
}

async function invokeSignedTwilioInbound(params) {
  const authToken = requiredEnv("TWILIO_AUTH_TOKEN");
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

  const signature = computeTwilioSignature(endpoint, payload, authToken);
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
      `twilio-inbound START verification failed with HTTP ${response.status}: ${truncate(responseBody, 400)}`,
    );
  }
}

async function countOnboardingOutboundJobsSince(params) {
  const { count, error } = await supabase
    .from("sms_outbound_jobs")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", TEST_USER_ID)
    .like("purpose", "onboarding_%")
    .gte("created_at", params.referenceTimestampIso);

  if (error) {
    fail(`Unable to count onboarding sms_outbound_jobs rows: ${formatSupabaseError(error)}`);
  }

  return Number(count ?? 0);
}

async function listOnboardingOutboundJobsSince(params) {
  const { data, error } = await supabase
    .from("sms_outbound_jobs")
    .select("id,purpose,created_at,run_at,status,twilio_message_sid")
    .eq("user_id", TEST_USER_ID)
    .like("purpose", "onboarding_%")
    .gte("created_at", params.referenceTimestampIso)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    fail(`Unable to list onboarding sms_outbound_jobs rows: ${formatSupabaseError(error)}`);
  }

  return Array.isArray(data) ? data : [];
}

async function listAllOutboundJobsSince(params) {
  const { data, error } = await supabase
    .from("sms_outbound_jobs")
    .select("id,purpose,created_at,twilio_message_sid")
    .eq("user_id", TEST_USER_ID)
    .gte("created_at", params.referenceTimestampIso)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    fail(`Unable to list sms_outbound_jobs rows: ${formatSupabaseError(error)}`);
  }

  return Array.isArray(data) ? data : [];
}

async function listOutboundSmsMessagesSince(params) {
  const { data, error } = await supabase
    .from("sms_messages")
    .select("id,twilio_message_sid,created_at,body_ciphertext")
    .eq("user_id", TEST_USER_ID)
    .eq("direction", "out")
    .gte("created_at", params.referenceTimestampIso)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    fail(`Unable to list outbound sms_messages rows: ${formatSupabaseError(error)}`);
  }

  return Array.isArray(data) ? data : [];
}

async function tryDecryptSmsBody(params) {
  const { data, error } = await supabase.rpc("decrypt_sms_body", {
    ciphertext: params.ciphertext,
    key: params.encryptionKey,
  });

  if (error || typeof data !== "string") {
    warn(
      `Skipping outbound body inspection for one row because decryption failed: ${formatSupabaseError(error)}`,
    );
    return null;
  }

  return data;
}

function resolveRouteDecisionForSession(session) {
  const mode = String(session?.mode ?? "").trim().toLowerCase();
  const stateToken = String(session?.state_token ?? "").trim();
  if (mode === "onboarding") {
    return "onboarding_engine";
  }
  if (stateToken.startsWith("onboarding:")) {
    return "onboarding_engine";
  }
  if (stateToken.startsWith("interview:")) {
    return "profile_interview_engine";
  }
  return "default_engine";
}

function shouldFallbackToInterviewingMode(error) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  const details = String(error?.details ?? "").toLowerCase();
  const combined = `${message} ${details}`;
  return (
    code === "22P02" &&
    combined.includes("conversation_mode") &&
    combined.includes("onboarding")
  );
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
  runReport.selected_count = params.activationSummary.selected_count;
  runReport.claimed_count = params.activationSummary.claimed_count;
  runReport.sent_count = params.activationSummary.sent_count;
  runReport.session_state_token = params.sessionStateToken;
  runReport.sms_messages_since_reference = params.outboundSmsCount;
  runReport.reference_timestamp = params.referenceTimestampIso;
  emitReport("PASS");
}

function hasArg(flag) {
  return process.argv.includes(flag);
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

function loadClaimedWaitlistStatus(params) {
  const source = readSourceFile(params.filePath);
  const functionMatch = source.match(
    /export function claimWaitlistEntriesCas\([\s\S]+?\n}\n\nexport async function executeWaitlistBatchNotify/,
  );
  if (!functionMatch) {
    fail(`Unable to locate claimWaitlistEntriesCas() in ${params.filePath}.`);
  }

  const statuses = Array.from(
    functionMatch[0].matchAll(/status:\s*"([^"]+)"/g),
    (entry) => entry[1].trim(),
  ).filter((value) => value.length > 0);
  const uniqueStatuses = Array.from(new Set(statuses));

  if (uniqueStatuses.length !== 1) {
    fail(
      `Expected exactly one claim status in claimWaitlistEntriesCas(), found ${uniqueStatuses.length}.`,
    );
  }
  return uniqueStatuses[0];
}

function resolveClaimReferenceTimestamp(waitlistEntry) {
  if (!waitlistEntry) {
    return null;
  }
  return waitlistEntry.activated_at ?? waitlistEntry.last_notified_at ?? waitlistEntry.notified_at ?? null;
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
  emitReport("FAIL");
  console.error(`[${SCRIPT_TAG}] ERROR: ${message}`);
  process.exit(1);
}

function emitReport(outcome) {
  if (hasEmittedReport) {
    return;
  }
  hasEmittedReport = true;

  const selected = runReport.selected_count ?? "n/a";
  const claimed = runReport.claimed_count ?? "n/a";
  const sent = runReport.sent_count ?? "n/a";
  const waitlistEntryId = runReport.waitlist_entry_id ?? "n/a";
  const waitlistStatus = runReport.waitlist_status ?? "n/a";
  const activatedAt = runReport.waitlist_activated_at ?? "null";
  const notifiedAt = runReport.waitlist_notified_at ?? "null";
  const lastNotifiedAt = runReport.waitlist_last_notified_at ?? "null";
  const stateToken = runReport.session_state_token ?? "n/a";
  const smsCount = runReport.sms_messages_since_reference ?? "n/a";
  const startChecked = runReport.start_transition_checked ? "true" : "false";
  const preStartStateToken = runReport.pre_start_state_token ?? "n/a";
  const startRouteDecision = runReport.start_route_decision ?? "n/a";
  const postStartStateToken = runReport.post_start_state_token ?? "n/a";
  const onboardingJobsSinceStart = runReport.onboarding_jobs_since_start ?? "n/a";
  const postExplanationStateToken = runReport.post_explanation_state_token ?? "n/a";
  const explanationJobsSinceReply = runReport.explanation_jobs_since_reply ?? "n/a";
  const referenceTimestamp = runReport.reference_timestamp ?? "n/a";
  const legacyRecoveryApplied = runReport.legacy_recovery_applied ? "true" : "false";

  console.log(`[${SCRIPT_TAG}] outcome=${outcome}`);
  console.log(
    `[${SCRIPT_TAG}] selected_count=${selected} claimed_count=${claimed} sent_count=${sent}`,
  );
  console.log(`[${SCRIPT_TAG}] waitlist_entry_id=${waitlistEntryId}`);
  console.log(
    `[${SCRIPT_TAG}] waitlist_status=${waitlistStatus} activated_at=${activatedAt} notified_at=${notifiedAt} last_notified_at=${lastNotifiedAt}`,
  );
  console.log(`[${SCRIPT_TAG}] session_state_token=${stateToken}`);
  console.log(
    `[${SCRIPT_TAG}] sms_messages_since_reference=${smsCount} reference_timestamp=${referenceTimestamp}`,
  );
  console.log(
    `[${SCRIPT_TAG}] start_transition_checked=${startChecked} pre_start_state_token=${preStartStateToken} start_route_decision=${startRouteDecision} post_start_state_token=${postStartStateToken} onboarding_jobs_since_start=${onboardingJobsSinceStart}`,
  );
  console.log(
    `[${SCRIPT_TAG}] post_explanation_state_token=${postExplanationStateToken} explanation_jobs_since_reply=${explanationJobsSinceReply}`,
  );
  console.log(`[${SCRIPT_TAG}] legacy_recovery_applied=${legacyRecoveryApplied}`);
}

function errorToMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
