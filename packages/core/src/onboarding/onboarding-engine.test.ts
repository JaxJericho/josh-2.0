import { describe, expect, it, vi } from "vitest";
import {
  INTERVIEW_ACTIVITY_01_STATE_TOKEN,
  ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
  ONBOARDING_AWAITING_INTERVIEW_START,
  ONBOARDING_AWAITING_OPENING_RESPONSE,
  detectOnboardingIntent,
  handleOnboardingInbound,
  sendOnboardingBurst,
  startOnboardingForUser,
} from "./onboarding-engine";

describe("onboarding intent detection", () => {
  it("advances on affirmative opening responses", () => {
    expect(detectOnboardingIntent("yes")).toEqual({ advance: true, pause: false });
    expect(detectOnboardingIntent("ok")).toEqual({ advance: true, pause: false });
    expect(detectOnboardingIntent("sure")).toEqual({ advance: true, pause: false });
    expect(detectOnboardingIntent("START")).toEqual({ advance: true, pause: false });
  });

  it("advances on ambiguous or neutral replies (spec: ambiguous advances)", () => {
    expect(detectOnboardingIntent("random text")).toEqual({ advance: true, pause: false });
    expect(detectOnboardingIntent("sounds good")).toEqual({ advance: true, pause: false });
    expect(detectOnboardingIntent("tell me more")).toEqual({ advance: true, pause: false });
    expect(detectOnboardingIntent("awesome")).toEqual({ advance: true, pause: false });
    expect(detectOnboardingIntent("sweet")).toEqual({ advance: true, pause: false });
  });

  it("pauses on explicit later/no responses", () => {
    expect(detectOnboardingIntent("no")).toEqual({ advance: false, pause: true });
    expect(detectOnboardingIntent("later")).toEqual({ advance: false, pause: true });
    expect(detectOnboardingIntent("not now")).toEqual({ advance: false, pause: true });
  });
});

describe("onboarding state transitions", () => {
  it("opening reply advances only on affirmative input", () => {
    const advance = handleOnboardingInbound({
      stateToken: ONBOARDING_AWAITING_OPENING_RESPONSE,
      inputText: "yes",
    });
    expect(advance.nextStateToken).toBe(ONBOARDING_AWAITING_EXPLANATION_RESPONSE);
    expect(advance.outboundPlan).toHaveLength(1);
    expect(advance.outboundPlan[0]).toMatchObject({
      kind: "send",
      message_key: "onboarding_explanation",
    });

    const startAdvance = handleOnboardingInbound({
      stateToken: ONBOARDING_AWAITING_OPENING_RESPONSE,
      inputText: "START",
    });
    expect(startAdvance.nextStateToken).toBe(ONBOARDING_AWAITING_EXPLANATION_RESPONSE);
    expect(startAdvance.outboundPlan[0]).toMatchObject({
      kind: "send",
      message_key: "onboarding_explanation",
    });

    // Spec: ambiguous replies advance the flow
    const ambiguous = handleOnboardingInbound({
      stateToken: ONBOARDING_AWAITING_OPENING_RESPONSE,
      inputText: "tell me more",
    });
    expect(ambiguous.nextStateToken).toBe(ONBOARDING_AWAITING_EXPLANATION_RESPONSE);
    expect(ambiguous.outboundPlan[0]).toMatchObject({
      kind: "send",
      message_key: "onboarding_explanation",
    });

    const pause = handleOnboardingInbound({
      stateToken: ONBOARDING_AWAITING_OPENING_RESPONSE,
      inputText: "later",
    });
    expect(pause.nextStateToken).toBe(ONBOARDING_AWAITING_OPENING_RESPONSE);
    expect(pause.outboundPlan[0]).toMatchObject({
      kind: "send",
      message_key: "onboarding_later",
    });
  });

  it("explanation reply advances to burst completion token", () => {
    const result = handleOnboardingInbound({
      stateToken: ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
      inputText: "yes",
    });

    expect(result.nextStateToken).toBe(ONBOARDING_AWAITING_INTERVIEW_START);
    expect(result.outboundPlan).toHaveLength(7);
    expect(result.outboundPlan[0]).toMatchObject({
      kind: "send",
      message_key: "onboarding_message_1",
    });
    expect(result.outboundPlan[1]).toEqual({ kind: "delay", ms: 8000 });
    expect(result.outboundPlan[2]).toMatchObject({
      kind: "send",
      message_key: "onboarding_message_2",
    });
    expect(result.outboundPlan[3]).toEqual({ kind: "delay", ms: 8000 });
    expect(result.outboundPlan[4]).toMatchObject({
      kind: "send",
      message_key: "onboarding_message_3",
    });
    expect(result.outboundPlan[5]).toEqual({ kind: "delay", ms: 8000 });
    expect(result.outboundPlan[6]).toMatchObject({
      kind: "send",
      message_key: "onboarding_message_4",
    });
  });

  it("explanation reply pauses on explicit negative (no/later)", () => {
    const pause = handleOnboardingInbound({
      stateToken: ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
      inputText: "no",
    });
    expect(pause.nextStateToken).toBe(ONBOARDING_AWAITING_EXPLANATION_RESPONSE);
    expect(pause.outboundPlan).toHaveLength(1);
    expect(pause.outboundPlan[0]).toMatchObject({
      kind: "send",
      message_key: "onboarding_later",
    });

    const later = handleOnboardingInbound({
      stateToken: ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
      inputText: "later",
    });
    expect(later.nextStateToken).toBe(ONBOARDING_AWAITING_EXPLANATION_RESPONSE);
    expect(later.outboundPlan[0]).toMatchObject({
      kind: "send",
      message_key: "onboarding_later",
    });
  });

  it("final onboarding reply hands off to interview activity_01 unless paused", () => {
    const handoff = handleOnboardingInbound({
      stateToken: ONBOARDING_AWAITING_INTERVIEW_START,
      inputText: "yes",
    });
    expect(handoff.nextStateToken).toBe(INTERVIEW_ACTIVITY_01_STATE_TOKEN);
    expect(handoff.handoffToInterview).toBe(true);
    expect(handoff.outboundPlan).toHaveLength(0);

    const pause = handleOnboardingInbound({
      stateToken: ONBOARDING_AWAITING_INTERVIEW_START,
      inputText: "no",
    });
    expect(pause.nextStateToken).toBe(ONBOARDING_AWAITING_OPENING_RESPONSE);
    expect(pause.outboundPlan[0]).toMatchObject({
      kind: "send",
      message_key: "onboarding_later",
    });
  });
});

describe("onboarding send orchestration", () => {
  it("does not resend opening when already sent or already beyond opening stage", async () => {
    const sendMessage = vi.fn(async () => undefined);
    const persistState = vi.fn(async () => undefined);

    const alreadySent = await startOnboardingForUser({
      firstName: "Alex",
      currentStateToken: ONBOARDING_AWAITING_OPENING_RESPONSE,
      hasOpeningBeenSent: true,
      openingIdempotencyKey: "open-1",
      sendMessage,
      persistState,
    });
    expect(alreadySent.didSendOpening).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(persistState).toHaveBeenCalledTimes(1);

    sendMessage.mockClear();
    persistState.mockClear();

    const alreadyBeyond = await startOnboardingForUser({
      firstName: "Alex",
      currentStateToken: ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
      hasOpeningBeenSent: false,
      openingIdempotencyKey: "open-2",
      sendMessage,
      persistState,
    });
    expect(alreadyBeyond.didSendOpening).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(persistState).not.toHaveBeenCalled();
  });

  it("sends onboarding burst with deterministic 8000ms delays between each explanation message", async () => {
    const sendMessage = vi.fn(async () => undefined);
    const persistState = vi.fn(async () => undefined);
    const delay = vi.fn(async () => undefined);

    const result = await sendOnboardingBurst({
      currentStateToken: ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
      burstIdempotencyKeyPrefix: "burst-1",
      sendMessage,
      persistState,
      delay,
    });

    expect(result.didSendBurst).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(4);
    expect(delay).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenNthCalledWith(1, 8000);
    expect(delay).toHaveBeenNthCalledWith(2, 8000);
    expect(delay).toHaveBeenNthCalledWith(3, 8000);
    expect(persistState).toHaveBeenCalledWith({
      nextStateToken: ONBOARDING_AWAITING_INTERVIEW_START,
    });
  });

  it("does not resend burst when already at onboarding:awaiting_interview_start", async () => {
    const sendMessage = vi.fn(async () => undefined);
    const persistState = vi.fn(async () => undefined);
    const delay = vi.fn(async () => undefined);

    const result = await sendOnboardingBurst({
      currentStateToken: ONBOARDING_AWAITING_INTERVIEW_START,
      burstIdempotencyKeyPrefix: "burst-2",
      sendMessage,
      persistState,
      delay,
    });

    expect(result.didSendBurst).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(delay).not.toHaveBeenCalled();
    expect(persistState).not.toHaveBeenCalled();
  });
});
