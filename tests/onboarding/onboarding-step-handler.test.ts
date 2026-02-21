import { describe, expect, it } from "vitest";

import {
  handleOnboardingStepRequest,
  type OnboardingStepHandlerDependencies,
  type OnboardingStepPayload,
} from "../../app/lib/onboarding-step-handler";

type HarnessOptions = {
  sessionExists?: boolean;
  sessionMode?: string;
  sessionStateToken?: string;
  safetyHold?: boolean;
  paused?: boolean;
  deliveredBeforeSend?: boolean;
  deliveredAfterSend?: boolean;
  sendFailsOnce?: boolean;
};

type HarnessState = {
  sendCount: number;
  stateUpdates: string[];
  scheduleCalls: Array<{ payload: OnboardingStepPayload; delayMs: number }>;
  logs: Array<{ event: string; payload: Record<string, unknown> }>;
  deliveredRows: string[];
};

type OnboardingStepCase = {
  stepId: OnboardingStepPayload["step_id"];
  nextStepId: OnboardingStepPayload["step_id"] | null;
  expectedDelayMs: number | null;
  expectedStateAfterStep: string;
};

const BASE_PAYLOAD: OnboardingStepPayload = {
  profile_id: "profile_123",
  session_id: "session_123",
  step_id: "onboarding_message_1",
  expected_state_token: "onboarding:awaiting_burst",
  idempotency_key: "onboarding:profile_123:session_123:onboarding_message_1",
};

const ONBOARDING_STEP_SCHEDULING_CASES: OnboardingStepCase[] = [
  {
    stepId: "onboarding_message_1",
    nextStepId: "onboarding_message_2",
    expectedDelayMs: 8_000,
    expectedStateAfterStep: "onboarding:awaiting_burst",
  },
  {
    stepId: "onboarding_message_2",
    nextStepId: "onboarding_message_3",
    expectedDelayMs: 8_000,
    expectedStateAfterStep: "onboarding:awaiting_burst",
  },
  {
    stepId: "onboarding_message_3",
    nextStepId: "onboarding_message_4",
    expectedDelayMs: 0,
    expectedStateAfterStep: "onboarding:awaiting_burst",
  },
  {
    stepId: "onboarding_message_4",
    nextStepId: null,
    expectedDelayMs: null,
    expectedStateAfterStep: "onboarding:awaiting_interview_start",
  },
];

function buildPayload(stepId: OnboardingStepPayload["step_id"]): OnboardingStepPayload {
  return {
    profile_id: BASE_PAYLOAD.profile_id,
    session_id: BASE_PAYLOAD.session_id,
    step_id: stepId,
    expected_state_token: "onboarding:awaiting_burst",
    idempotency_key: `onboarding:${BASE_PAYLOAD.profile_id}:${BASE_PAYLOAD.session_id}:${stepId}`,
  };
}

function buildRequest(payload: OnboardingStepPayload = BASE_PAYLOAD): Request {
  return new Request("https://example.test/api/onboarding/step", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "req_test_123",
    },
    body: JSON.stringify(payload),
  });
}

function createHarness(options: HarnessOptions = {}): {
  deps: OnboardingStepHandlerDependencies;
  state: HarnessState;
} {
  const state: HarnessState = {
    sendCount: 0,
    stateUpdates: [],
    scheduleCalls: [],
    logs: [],
    deliveredRows: options.deliveredBeforeSend ? [BASE_PAYLOAD.idempotency_key] : [],
  };

  let sessionToken = options.sessionStateToken ?? BASE_PAYLOAD.expected_state_token;
  let sendFailedOnce = false;
  let lastIdempotencyKey = BASE_PAYLOAD.idempotency_key;

  const deps: OnboardingStepHandlerDependencies = {
    verifyQStashSignature: async () => true,

    loadSession: async () => {
      if (options.sessionExists === false) {
        return null;
      }

      return {
        id: BASE_PAYLOAD.session_id,
        user_id: "user_123",
        mode: options.sessionMode ?? "interviewing",
        state_token: sessionToken,
      };
    },

    isSafetyHold: async () => Boolean(options.safetyHold),
    isSessionPaused: async () => Boolean(options.paused),

    hasDeliveredMessage: async (idempotencyKey: string) => {
      lastIdempotencyKey = idempotencyKey;
      return state.deliveredRows.includes(idempotencyKey);
    },

    sendStepMessage: async () => {
      if (options.sendFailsOnce && !sendFailedOnce) {
        sendFailedOnce = true;
        throw new Error("simulated send failure");
      }

      state.sendCount += 1;
      if (options.deliveredAfterSend !== false) {
        state.deliveredRows.push(lastIdempotencyKey);
      }
    },

    updateSessionState: async (_sessionId: string, stateToken: string) => {
      state.stateUpdates.push(stateToken);
      sessionToken = stateToken;
    },

    scheduleOnboardingStep: async (payload: OnboardingStepPayload, delayMs: number) => {
      state.scheduleCalls.push({ payload, delayMs });
    },

    log: (event: string, payload: Record<string, unknown>) => {
      state.logs.push({ event, payload });
    },
  };

  return { deps, state };
}

describe("onboarding step handler eligibility and idempotency", () => {
  it("returns 200 and skips send when session does not exist", async () => {
    const { deps, state } = createHarness({ sessionExists: false });

    const response = await handleOnboardingStepRequest(buildRequest(), deps);

    expect(response.status).toBe(200);
    expect(state.sendCount).toBe(0);
    expect(state.logs.some((entry) => entry.event === "onboarding.step_skipped")).toBe(true);
  });

  it("returns 200 and skips send when session is inactive", async () => {
    const { deps, state } = createHarness({ sessionMode: "idle" });

    const response = await handleOnboardingStepRequest(buildRequest(), deps);

    expect(response.status).toBe(200);
    expect(state.sendCount).toBe(0);
    expect(state.logs.some((entry) => entry.event === "onboarding.step_skipped")).toBe(true);
  });

  it("returns 200 and logs stale reason when expected state token mismatches", async () => {
    const { deps, state } = createHarness({ sessionStateToken: "onboarding:awaiting_opening_response" });

    const response = await handleOnboardingStepRequest(buildRequest(), deps);

    expect(response.status).toBe(200);
    expect(state.sendCount).toBe(0);
    const staleLog = state.logs.find((entry) => entry.event === "onboarding.step_skipped");
    expect(staleLog?.payload.reason).toBe("stale");
  });

  it("returns 200 and logs safety_hold reason when profile has hard hold", async () => {
    const { deps, state } = createHarness({ safetyHold: true });

    const response = await handleOnboardingStepRequest(buildRequest(), deps);

    expect(response.status).toBe(200);
    expect(state.sendCount).toBe(0);
    const holdLog = state.logs.find((entry) => entry.event === "onboarding.step_skipped");
    expect(holdLog?.payload.reason).toBe("safety_hold");
  });

  it("returns 200 and skips send when session is paused", async () => {
    const { deps, state } = createHarness({ paused: true });

    const response = await handleOnboardingStepRequest(buildRequest(), deps);

    expect(response.status).toBe(200);
    expect(state.sendCount).toBe(0);
    const pausedLog = state.logs.find((entry) => entry.event === "onboarding.step_skipped");
    expect(pausedLog?.payload.reason).toBe("paused");
  });

  it("returns 200 without re-sending when idempotency already delivered", async () => {
    const { deps, state } = createHarness({ deliveredBeforeSend: true });

    const response = await handleOnboardingStepRequest(buildRequest(), deps);

    expect(response.status).toBe(200);
    expect(state.sendCount).toBe(0);
    const skipLog = state.logs.find((entry) => entry.event === "onboarding.step_skipped");
    expect(skipLog?.payload.reason).toBe("already_sent");
  });

  it("returns 500 and rolls state back when delivery record is missing after state advance", async () => {
    const { deps, state } = createHarness({ deliveredAfterSend: false });

    const response = await handleOnboardingStepRequest(buildRequest(), deps);

    expect(response.status).toBe(500);
    expect(state.sendCount).toBe(1);
    expect(state.stateUpdates).toHaveLength(2);
    expect(state.stateUpdates[0]).toBe("onboarding:awaiting_burst");
    expect(state.stateUpdates[1]).toBe(BASE_PAYLOAD.expected_state_token);
  });
});

describe("onboarding step handler integration-like flows", () => {
  it("valid payload sends one SMS, advances state, and schedules exactly one next step", async () => {
    const { deps, state } = createHarness();

    const response = await handleOnboardingStepRequest(buildRequest(), deps);

    expect(response.status).toBe(200);
    expect(state.sendCount).toBe(1);
    expect(state.stateUpdates).toEqual(["onboarding:awaiting_burst"]);
    expect(state.scheduleCalls).toHaveLength(1);
    expect(state.scheduleCalls[0].payload.step_id).toBe("onboarding_message_2");
    expect(state.scheduleCalls[0].delayMs).toBe(8000);
    expect(state.logs.some((entry) => entry.event === "onboarding.step_sent")).toBe(true);
    expect(state.logs.some((entry) => entry.event === "onboarding.step_next_scheduled")).toBe(true);
  });

  it("same payload submitted twice sends exactly once and advances state once", async () => {
    const { deps, state } = createHarness();

    const first = await handleOnboardingStepRequest(buildRequest(), deps);
    const second = await handleOnboardingStepRequest(buildRequest(), deps);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(state.sendCount).toBe(1);
    expect(state.deliveredRows).toEqual([BASE_PAYLOAD.idempotency_key]);
    expect(state.stateUpdates).toHaveLength(1);
  });

  it("simulated first-attempt 500 retries successfully with exactly one delivered SMS total", async () => {
    const { deps, state } = createHarness({ sendFailsOnce: true });

    const first = await handleOnboardingStepRequest(buildRequest(), deps);
    const second = await handleOnboardingStepRequest(buildRequest(), deps);

    expect(first.status).toBe(500);
    expect(second.status).toBe(200);
    expect(state.sendCount).toBe(1);
    expect(state.deliveredRows).toEqual([BASE_PAYLOAD.idempotency_key]);
    expect(state.stateUpdates).toEqual(["onboarding:awaiting_burst"]);
  });

  it("schedules exactly one next step at the configured delay for each burst step", async () => {
    for (const stepCase of ONBOARDING_STEP_SCHEDULING_CASES) {
      const payload = buildPayload(stepCase.stepId);
      const { deps, state } = createHarness();
      const response = await handleOnboardingStepRequest(buildRequest(payload), deps);

      expect(response.status).toBe(200);
      expect(state.sendCount).toBe(1);
      expect(state.stateUpdates).toEqual([stepCase.expectedStateAfterStep]);

      if (!stepCase.nextStepId) {
        expect(state.scheduleCalls).toHaveLength(0);
        continue;
      }

      expect(state.scheduleCalls).toHaveLength(1);
      expect(state.scheduleCalls[0]).toEqual({
        payload: {
          profile_id: payload.profile_id,
          session_id: payload.session_id,
          step_id: stepCase.nextStepId,
          expected_state_token: "onboarding:awaiting_burst",
          idempotency_key: `onboarding:${payload.profile_id}:${payload.session_id}:${stepCase.nextStepId}`,
        },
        delayMs: stepCase.expectedDelayMs,
      });
    }
  });
});
