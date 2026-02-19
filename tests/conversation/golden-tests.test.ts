import { describe, expect, it, vi } from "vitest";
import {
  ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
  handleOnboardingInbound,
  sendOnboardingBurst,
  type SendOnboardingMessageInput,
} from "../../packages/core/src/onboarding/onboarding-engine";
import {
  ONBOARDING_MESSAGE_1,
  ONBOARDING_MESSAGE_2,
  ONBOARDING_MESSAGE_3,
  ONBOARDING_MESSAGE_4,
} from "../../packages/core/src/onboarding/messages";
import { INTERVIEW_WRAP } from "../../packages/core/src/interview/messages";
import {
  buildInterviewTransitionPlan,
  type InterviewSessionSnapshot,
} from "../../packages/core/src/interview/state";
import type { ProfileRowForInterview, ProfileUpdatePatch } from "../../packages/core/src/profile/profile-writer";
import type { InterviewExtractInput } from "../../packages/llm/src/interview-extractor";
import type { InterviewExtractOutput } from "../../packages/llm/src/schemas/interview-extract-output.schema";
import { CONVERSATION_PROHIBITED_PATTERNS } from "../../packages/llm/src/output-validator";

type InterviewHarnessState = {
  session: InterviewSessionSnapshot;
  profile: ProfileRowForInterview;
};

const ANSWER_BY_STEP: Record<string, string> = {
  activity_01: "coffee, walk, museum",
  activity_02: "coffee",
  motive_01: "deeper conversation and calm reset",
  motive_02: "A",
  style_01: "B",
  style_02: "ideas and stories",
  pace_01: "B",
  group_01: "A",
  values_01: "B",
  boundaries_01: "bars and late nights",
  constraints_01: "C",
  location_01: "US-WA",
};

function createFingerprint(keys: string[]): Record<string, unknown> {
  return keys.reduce((accumulator, key) => {
    accumulator[key] = {
      value: 0.72,
      confidence: 0.7,
      source: "interview",
    };
    return accumulator;
  }, {} as Record<string, unknown>);
}

function createProfile(overrides: Partial<ProfileRowForInterview> = {}): ProfileRowForInterview {
  return {
    id: "pro_golden_1",
    user_id: "usr_golden_1",
    country_code: null,
    state_code: null,
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
    state_changed_at: "2026-02-18T00:00:00.000Z",
    ...overrides,
  };
}

function applyProfilePatch(
  current: ProfileRowForInterview,
  patch: ProfileUpdatePatch,
): ProfileRowForInterview {
  return {
    ...current,
    ...patch,
  };
}

function applyTransition(
  state: InterviewHarnessState,
  transition: Awaited<ReturnType<typeof buildInterviewTransitionPlan>>,
): void {
  state.session = {
    mode: transition.next_session.mode,
    state_token: transition.next_session.state_token,
    current_step_id: transition.next_session.current_step_id,
    last_inbound_message_sid: transition.next_session.last_inbound_message_sid,
    dropout_nudge_sent_at: transition.next_session.dropout_nudge_sent_at,
  };

  if (transition.profile_patch) {
    state.profile = applyProfilePatch(state.profile, transition.profile_patch);
  }
}

function createInterviewHarnessState(): InterviewHarnessState {
  return {
    session: {
      mode: "interviewing",
      state_token: "interview:activity_01",
      current_step_id: "activity_01",
      last_inbound_message_sid: null,
      dropout_nudge_sent_at: null,
    },
    profile: createProfile(),
  };
}

async function runInterviewSimulation(params: {
  llmExtractor: (input: InterviewExtractInput) => Promise<InterviewExtractOutput>;
  maxTurns?: number;
}): Promise<{ exchanges: number; outboundMessages: string[]; completed: boolean }> {
  const state = createInterviewHarnessState();
  const maxTurns = params.maxTurns ?? 20;
  const outboundMessages: string[] = [];

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const currentStepId = state.session.current_step_id;
    if (!currentStepId) {
      break;
    }

    const transition = await buildInterviewTransitionPlan({
      inbound_message_sid: `SM_GOLDEN_${String(turn).padStart(4, "0")}`,
      inbound_message_text: ANSWER_BY_STEP[currentStepId] ?? "A",
      now_iso: `2026-02-18T00:${String(turn).padStart(2, "0")}:00.000Z`,
      session: state.session,
      profile: state.profile,
      llm_extractor: params.llmExtractor,
    });

    outboundMessages.push(transition.reply_message);
    applyTransition(state, transition);

    if (transition.action === "complete") {
      return { exchanges: turn, outboundMessages, completed: true };
    }
  }

  return { exchanges: maxTurns, outboundMessages, completed: false };
}

function countQuestions(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

describe("conversation golden tests", () => {
  it("onboarding burst keeps canonical sequence and deterministic 8000ms delays", async () => {
    const transitionPlan = handleOnboardingInbound({
      stateToken: ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
      inputText: "yes",
    });

    expect(transitionPlan.outboundPlan).toEqual([
      { kind: "send", message_key: "onboarding_message_1", body: ONBOARDING_MESSAGE_1 },
      { kind: "delay", ms: 8000 },
      { kind: "send", message_key: "onboarding_message_2", body: ONBOARDING_MESSAGE_2 },
      { kind: "delay", ms: 8000 },
      { kind: "send", message_key: "onboarding_message_3", body: ONBOARDING_MESSAGE_3 },
      { kind: "delay", ms: 8000 },
      { kind: "send", message_key: "onboarding_message_4", body: ONBOARDING_MESSAGE_4 },
    ]);

    const sendCalls: SendOnboardingMessageInput[] = [];
    const sendMessage = vi.fn(async (input: SendOnboardingMessageInput) => {
      sendCalls.push(input);
    });
    const delay = vi.fn(async () => undefined);

    await sendOnboardingBurst({
      currentStateToken: ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
      burstIdempotencyKeyPrefix: "golden-burst",
      sendMessage,
      persistState: async () => undefined,
      delay,
    });

    expect(sendCalls.map((entry) => entry.body)).toEqual([
      ONBOARDING_MESSAGE_1,
      ONBOARDING_MESSAGE_2,
      ONBOARDING_MESSAGE_3,
      ONBOARDING_MESSAGE_4,
    ]);
    expect(delay).toHaveBeenNthCalledWith(1, 8000);
    expect(delay).toHaveBeenNthCalledWith(2, 8000);
    expect(delay).toHaveBeenNthCalledWith(3, 8000);
  });

  it("rich interview path completes in fewer exchanges than sparse path", async () => {
    const sparse = await runInterviewSimulation({
      llmExtractor: async () => {
        throw new Error("llm_disabled_for_sparse_simulation");
      },
    });

    const rich = await runInterviewSimulation({
      llmExtractor: async (input) => ({
        stepId: input.stepId,
        extracted: {
          fingerprintPatches: [
            { key: "connection_depth", range_value: 0.72, confidence: 0.7 },
            { key: "social_energy", range_value: 0.7, confidence: 0.7 },
            { key: "social_pace", range_value: 0.7, confidence: 0.7 },
            { key: "novelty_seeking", range_value: 0.69, confidence: 0.7 },
            { key: "structure_preference", range_value: 0.68, confidence: 0.7 },
            { key: "humor_style", range_value: 0.66, confidence: 0.7 },
            { key: "conversation_style", range_value: 0.74, confidence: 0.7 },
            { key: "values_alignment_importance", range_value: 0.7, confidence: 0.7 },
          ],
          activityPatternsAdd: [
            {
              activity_key: "coffee",
              motive_weights: {
                comfort: 0.7,
                connection: 0.6,
                restorative: 0.4,
                growth: 0.3,
              },
              confidence: 0.72,
            },
            {
              activity_key: "walk",
              motive_weights: {
                comfort: 0.4,
                connection: 0.58,
                restorative: 0.68,
                growth: 0.3,
              },
              confidence: 0.71,
            },
            {
              activity_key: "museum",
              motive_weights: {
                comfort: 0.35,
                connection: 0.6,
                restorative: 0.3,
                growth: 0.64,
              },
              confidence: 0.7,
            },
          ],
          boundariesPatch: {
            no_thanks: ["late nights"],
            skipped: false,
          },
          preferencesPatch: {
            group_size_pref: "4-6",
            time_preferences: ["evenings"],
          },
        },
        notes: {
          needsFollowUp: false,
        },
      }),
    });

    expect(sparse.completed).toBe(true);
    expect(rich.completed).toBe(true);
    expect(rich.exchanges).toBeLessThan(sparse.exchanges);
  });

  it("prohibited language never appears in outbound conversation messages", async () => {
    const sparse = await runInterviewSimulation({
      llmExtractor: async () => {
        throw new Error("llm_disabled_for_language_scan");
      },
    });

    const onboardingMessages = [
      ONBOARDING_MESSAGE_1,
      ONBOARDING_MESSAGE_2,
      ONBOARDING_MESSAGE_3,
      ONBOARDING_MESSAGE_4,
    ];

    const outbound = [...onboardingMessages, ...sparse.outboundMessages, INTERVIEW_WRAP];
    for (const text of outbound) {
      for (const pattern of CONVERSATION_PROHIBITED_PATTERNS) {
        expect(pattern.pattern.test(text)).toBe(false);
      }
    }
  });

  it("mocked extraction inference writes activity and fingerprint signals", async () => {
    const transition = await buildInterviewTransitionPlan({
      inbound_message_sid: "SM_GOLDEN_INFER_0001",
      inbound_message_text: "I love climbing because it feels adventurous and new",
      now_iso: "2026-02-18T00:00:00.000Z",
      session: {
        mode: "interviewing",
        state_token: "interview:motive_01",
        current_step_id: "motive_01",
        last_inbound_message_sid: null,
        dropout_nudge_sent_at: null,
      },
      profile: createProfile({
        preferences: {
          interview_progress: {
            version: 1,
            status: "in_progress",
            step_index: 3,
            current_step_id: "motive_01",
            completed_step_ids: ["activity_01", "activity_02"],
            answers: {
              activity_01: { activity_keys: ["coffee", "walk", "museum"] },
              activity_02: { activity_key: "coffee" },
            },
            updated_at: "2026-02-18T00:00:00.000Z",
          },
        },
        activity_patterns: [
          { activity_key: "coffee", confidence: 0.65, source: "interview" },
        ],
      }),
      llm_extractor: async () => ({
        stepId: "motive_01",
        extracted: {
          fingerprintPatches: [
            { key: "adventure_comfort", range_value: 0.78, confidence: 0.67 },
            { key: "novelty_seeking", range_value: 0.74, confidence: 0.66 },
          ],
          activityPatternsAdd: [
            {
              activity_key: "climbing",
              motive_weights: { adventure: 0.84, growth: 0.61 },
              confidence: 0.73,
            },
          ],
        },
        notes: {
          needsFollowUp: false,
        },
      }),
    });

    expect(transition.profile_event_payload?.extraction_source).toBe("llm");
    const fingerprint = transition.profile_patch?.fingerprint as Record<string, unknown>;
    const adventureComfort = fingerprint.adventure_comfort as Record<string, unknown>;
    expect((adventureComfort.confidence as number) >= 0.66).toBe(true);

    const activityPatterns = transition.profile_patch?.activity_patterns as Array<Record<string, unknown>>;
    expect(activityPatterns.some((entry) => entry.activity_key === "climbing")).toBe(true);
  });

  it("ambiguous answers produce at most one clarifier per reply", async () => {
    const state = createInterviewHarnessState();

    const retryOne = await buildInterviewTransitionPlan({
      inbound_message_sid: "SM_GOLDEN_CLARIFIER_0001",
      inbound_message_text: "maybe",
      now_iso: "2026-02-18T00:00:00.000Z",
      session: state.session,
      profile: state.profile,
      llm_extractor: async () => {
        throw new Error("llm_disabled_for_clarifier_test");
      },
    });
    applyTransition(state, retryOne);

    const retryTwo = await buildInterviewTransitionPlan({
      inbound_message_sid: "SM_GOLDEN_CLARIFIER_0002",
      inbound_message_text: "not sure",
      now_iso: "2026-02-18T00:01:00.000Z",
      session: state.session,
      profile: state.profile,
      llm_extractor: async () => {
        throw new Error("llm_disabled_for_clarifier_test");
      },
    });

    expect(retryOne.action).toBe("retry");
    expect(retryTwo.action).toBe("retry");
    expect(countQuestions(retryOne.reply_message)).toBeLessThanOrEqual(1);
    expect(countQuestions(retryTwo.reply_message)).toBeLessThanOrEqual(1);
  });

  it("wrap triggers only when mvpComplete is true and matches verbatim constant", async () => {
    const incompleteTransition = await buildInterviewTransitionPlan({
      inbound_message_sid: "SM_GOLDEN_WRAP_0001",
      inbound_message_text: "coffee, walk, museum",
      now_iso: "2026-02-18T00:00:00.000Z",
      session: {
        mode: "interviewing",
        state_token: "interview:activity_01",
        current_step_id: "activity_01",
        last_inbound_message_sid: null,
        dropout_nudge_sent_at: null,
      },
      profile: createProfile(),
      llm_extractor: async () => {
        throw new Error("llm_disabled_for_wrap_test");
      },
    });

    const completeTransition = await buildInterviewTransitionPlan({
      inbound_message_sid: "SM_GOLDEN_WRAP_0002",
      inbound_message_text: "hello",
      now_iso: "2026-02-18T00:01:00.000Z",
      session: {
        mode: "interviewing",
        state_token: "interview:motive_01",
        current_step_id: "motive_01",
        last_inbound_message_sid: null,
        dropout_nudge_sent_at: null,
      },
      profile: createProfile({
        state: "complete_mvp",
        is_complete_mvp: true,
        fingerprint: createFingerprint([
          "connection_depth",
          "social_energy",
          "social_pace",
          "novelty_seeking",
          "structure_preference",
          "humor_style",
          "conversation_style",
          "values_alignment_importance",
        ]),
        activity_patterns: [
          { activity_key: "coffee", confidence: 0.65, source: "interview" },
          { activity_key: "walk", confidence: 0.65, source: "interview" },
          { activity_key: "museum", confidence: 0.65, source: "interview" },
        ],
        boundaries: {
          no_thanks: [],
          skipped: true,
        },
        preferences: {
          group_size_pref: "2-3",
          time_preferences: ["evenings"],
        },
      }),
      llm_extractor: async () => {
        throw new Error("llm_disabled_for_wrap_test");
      },
    });

    expect(incompleteTransition.action).not.toBe("complete");
    expect(incompleteTransition.reply_message).not.toBe(INTERVIEW_WRAP);
    expect(completeTransition.action).toBe("complete");
    expect(completeTransition.reply_message).toBe(INTERVIEW_WRAP);
  });
});
