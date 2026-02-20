import { describe, expect, it, vi } from "vitest";
import {
  INTERVIEW_ACTIVITY_01_STATE_TOKEN,
  ONBOARDING_AWAITING_BURST,
  ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
  ONBOARDING_AWAITING_INTERVIEW_START,
  ONBOARDING_AWAITING_OPENING_RESPONSE,
  detectOnboardingIntent,
  handleOnboardingInbound,
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

  it("explanation reply advances to awaiting_burst without direct burst sends", () => {
    const result = handleOnboardingInbound({
      stateToken: ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
      inputText: "yes",
    });

    expect(result.nextStateToken).toBe(ONBOARDING_AWAITING_BURST);
    expect(result.outboundPlan).toEqual([]);
  });

  it("explanation reply pauses on explicit negative (no/later)", () => {
    const pause = handleOnboardingInbound({
      stateToken: ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
      inputText: "no",
    });
    expect(pause.nextStateToken).toBe(ONBOARDING_AWAITING_OPENING_RESPONSE);
    expect(pause.outboundPlan).toHaveLength(1);
    expect(pause.outboundPlan[0]).toMatchObject({
      kind: "send",
      message_key: "onboarding_later",
    });

    const later = handleOnboardingInbound({
      stateToken: ONBOARDING_AWAITING_EXPLANATION_RESPONSE,
      inputText: "later",
    });
    expect(later.nextStateToken).toBe(ONBOARDING_AWAITING_OPENING_RESPONSE);
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
});
