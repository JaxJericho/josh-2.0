import { describe, expect, it, vi } from "vitest";

import {
  extractCheckinSubjectId,
  extractStep,
  handlePostActivityCheckin,
  parseAttendanceResponse,
  parseBridgeResponse,
  parseDoAgainResponse,
  type HandlePostActivityCheckinDependencies,
} from "../handle-post-activity-checkin";
import type { ConversationSession } from "../../intents/intent-types";
import {
  CHECKIN_ERROR_RECOVERY_MESSAGE,
  SOLO_CHECKIN_BRIDGE_OFFER,
  SOLO_CHECKIN_CLARIFY_ATTENDANCE,
  SOLO_CHECKIN_DO_AGAIN_PROMPT,
  SOLO_CHECKIN_WRAP_ATTENDED,
  SOLO_CHECKIN_WRAP_BRIDGE_ACCEPTED,
  SOLO_CHECKIN_WRAP_BRIDGE_DECLINED,
  SOLO_CHECKIN_WRAP_SKIPPED,
} from "../../../../core/src/messages";

const PLAN_BRIEF_ID = "plan_123";

const BASE_SESSION: ConversationSession = {
  mode: "post_activity_checkin",
  state_token: `checkin:awaiting_attendance:${PLAN_BRIEF_ID}`,
  has_user_record: true,
  has_pending_contact_invitation: false,
  is_unknown_number_with_pending_invitation: false,
};

describe("handlePostActivityCheckin", () => {
  it("runs attended -> do-again yes -> bridge accepted across three turns", async () => {
    const deps = buildDependencies();

    await handlePostActivityCheckin(
      "usr_123",
      "yeah it was great",
      BASE_SESSION,
      "corr_123",
      deps,
    );

    expect(deps.insertLearningSignal).toHaveBeenNthCalledWith(1, {
      id: "signal_123",
      user_id: "usr_123",
      signal_type: "solo_activity_attended",
      subject_id: PLAN_BRIEF_ID,
      value_bool: true,
      meta: { activity_key: "coffee_walk" },
      occurred_at: "2026-03-03T12:00:00.000Z",
      ingested_at: "2026-03-03T12:00:00.000Z",
      idempotency_key: `ls:solo_checkin:attended:${PLAN_BRIEF_ID}:usr_123`,
    });
    expect(deps.updateConversationSession).toHaveBeenNthCalledWith(1, {
      userId: "usr_123",
      mode: "post_activity_checkin",
      state_token: `checkin:awaiting_do_again:${PLAN_BRIEF_ID}`,
      updated_at: "2026-03-03T12:00:00.000Z",
    });
    expect(deps.sendSms).toHaveBeenNthCalledWith(1, {
      userId: "usr_123",
      body: SOLO_CHECKIN_DO_AGAIN_PROMPT,
      correlationId: "corr_123",
    });

    await handlePostActivityCheckin(
      "usr_123",
      "definitely",
      {
        ...BASE_SESSION,
        state_token: `checkin:awaiting_do_again:${PLAN_BRIEF_ID}`,
      },
      "corr_123",
      deps,
    );

    expect(deps.insertLearningSignal).toHaveBeenNthCalledWith(2, {
      id: "signal_123",
      user_id: "usr_123",
      signal_type: "solo_do_again_yes",
      subject_id: PLAN_BRIEF_ID,
      value_bool: true,
      meta: { activity_key: "coffee_walk" },
      occurred_at: "2026-03-03T12:00:00.000Z",
      ingested_at: "2026-03-03T12:00:00.000Z",
      idempotency_key: `ls:solo_checkin:do_again_yes:${PLAN_BRIEF_ID}:usr_123`,
    });
    expect(deps.updateConversationSession).toHaveBeenNthCalledWith(2, {
      userId: "usr_123",
      mode: "post_activity_checkin",
      state_token: `checkin:awaiting_bridge:${PLAN_BRIEF_ID}`,
      updated_at: "2026-03-03T12:00:00.000Z",
    });
    expect(deps.sendSms).toHaveBeenNthCalledWith(2, {
      userId: "usr_123",
      body: SOLO_CHECKIN_BRIDGE_OFFER,
      correlationId: "corr_123",
    });

    await handlePostActivityCheckin(
      "usr_123",
      "yes please",
      {
        ...BASE_SESSION,
        state_token: `checkin:awaiting_bridge:${PLAN_BRIEF_ID}`,
      },
      "corr_123",
      deps,
    );

    expect(deps.insertLearningSignal).toHaveBeenNthCalledWith(3, {
      id: "signal_123",
      user_id: "usr_123",
      signal_type: "solo_bridge_accepted",
      subject_id: PLAN_BRIEF_ID,
      value_bool: true,
      meta: { activity_key: "coffee_walk" },
      occurred_at: "2026-03-03T12:00:00.000Z",
      ingested_at: "2026-03-03T12:00:00.000Z",
      idempotency_key: `ls:solo_checkin:bridge_accepted:${PLAN_BRIEF_ID}:usr_123`,
    });
    expect(deps.updateConversationSession).toHaveBeenNthCalledWith(3, {
      userId: "usr_123",
      mode: "idle",
      state_token: "idle",
      updated_at: "2026-03-03T12:00:00.000Z",
    });
    expect(deps.sendSms).toHaveBeenNthCalledWith(3, {
      userId: "usr_123",
      body: SOLO_CHECKIN_WRAP_BRIDGE_ACCEPTED,
      correlationId: "corr_123",
    });
  });

  it("writes solo_activity_skipped and idles session when user did not attend", async () => {
    const deps = buildDependencies();

    await handlePostActivityCheckin(
      "usr_123",
      "no i couldn't make it",
      BASE_SESSION,
      "corr_123",
      deps,
    );

    expect(deps.insertLearningSignal).toHaveBeenCalledTimes(1);
    expect(deps.insertLearningSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        signal_type: "solo_activity_skipped",
        idempotency_key: `ls:solo_checkin:skipped:${PLAN_BRIEF_ID}:usr_123`,
      }),
    );
    expect(deps.updateConversationSession).toHaveBeenCalledWith({
      userId: "usr_123",
      mode: "idle",
      state_token: "idle",
      updated_at: "2026-03-03T12:00:00.000Z",
    });
    expect(deps.sendSms).toHaveBeenCalledWith({
      userId: "usr_123",
      body: SOLO_CHECKIN_WRAP_SKIPPED,
      correlationId: "corr_123",
    });
    expect(
      (deps.insertLearningSignal as unknown as { mock: { calls: Array<Array<{ signal_type: string }>> } }).mock
        .calls
        .every((call) =>
          call[0]?.signal_type !== "solo_do_again_yes" &&
          call[0]?.signal_type !== "solo_do_again_no" &&
          call[0]?.signal_type !== "solo_bridge_accepted"
        ),
    ).toBe(true);
  });

  it("writes solo_do_again_no and idles session when user would not do it again", async () => {
    const deps = buildDependencies();

    await handlePostActivityCheckin(
      "usr_123",
      "not really my thing",
      {
        ...BASE_SESSION,
        state_token: `checkin:awaiting_do_again:${PLAN_BRIEF_ID}`,
      },
      "corr_123",
      deps,
    );

    expect(deps.insertLearningSignal).toHaveBeenCalledTimes(1);
    expect(deps.insertLearningSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        signal_type: "solo_do_again_no",
        idempotency_key: `ls:solo_checkin:do_again_no:${PLAN_BRIEF_ID}:usr_123`,
      }),
    );
    expect(deps.updateConversationSession).toHaveBeenCalledWith({
      userId: "usr_123",
      mode: "idle",
      state_token: "idle",
      updated_at: "2026-03-03T12:00:00.000Z",
    });
    expect(deps.sendSms).toHaveBeenCalledWith({
      userId: "usr_123",
      body: SOLO_CHECKIN_WRAP_ATTENDED,
      correlationId: "corr_123",
    });
    expect(
      (deps.insertLearningSignal as unknown as { mock: { calls: Array<Array<{ signal_type: string }>> } }).mock
        .calls
        .every((call) => call[0]?.signal_type !== "solo_bridge_accepted"),
    ).toBe(true);
  });

  it("treats non-positive bridge reply as decline without writing a bridge signal", async () => {
    const deps = buildDependencies();

    await handlePostActivityCheckin(
      "usr_123",
      "nah i'm good",
      {
        ...BASE_SESSION,
        state_token: `checkin:awaiting_bridge:${PLAN_BRIEF_ID}`,
      },
      "corr_123",
      deps,
    );

    expect(deps.insertLearningSignal).not.toHaveBeenCalled();
    expect(deps.updateConversationSession).toHaveBeenCalledWith({
      userId: "usr_123",
      mode: "idle",
      state_token: "idle",
      updated_at: "2026-03-03T12:00:00.000Z",
    });
    expect(deps.sendSms).toHaveBeenCalledWith({
      userId: "usr_123",
      body: SOLO_CHECKIN_WRAP_BRIDGE_DECLINED,
      correlationId: "corr_123",
    });
  });

  it("sends attendance clarifier for ambiguous attendance responses without writes", async () => {
    const deps = buildDependencies();

    await handlePostActivityCheckin(
      "usr_123",
      "it was interesting",
      BASE_SESSION,
      "corr_123",
      deps,
    );

    expect(deps.insertLearningSignal).not.toHaveBeenCalled();
    expect(deps.updateConversationSession).not.toHaveBeenCalled();
    expect(deps.sendSms).toHaveBeenCalledWith({
      userId: "usr_123",
      body: SOLO_CHECKIN_CLARIFY_ATTENDANCE,
      correlationId: "corr_123",
    });
    expect(deps.log).toHaveBeenCalledWith({
      level: "warn",
      event: "handle_post_activity_checkin.ambiguous_parse",
      payload: {
        userId: "usr_123",
        correlationId: "corr_123",
        step: "awaiting_attendance",
        message: "[redacted]",
      },
    });
  });

  it.each([
    {
      session: `checkin:awaiting_attendance:${PLAN_BRIEF_ID}`,
      message: "yeah i went",
      signalType: "solo_activity_attended",
      idempotencySuffix: "attended",
    },
    {
      session: `checkin:awaiting_attendance:${PLAN_BRIEF_ID}`,
      message: "nope",
      signalType: "solo_activity_skipped",
      idempotencySuffix: "skipped",
    },
    {
      session: `checkin:awaiting_do_again:${PLAN_BRIEF_ID}`,
      message: "definitely",
      signalType: "solo_do_again_yes",
      idempotencySuffix: "do_again_yes",
    },
    {
      session: `checkin:awaiting_do_again:${PLAN_BRIEF_ID}`,
      message: "not really",
      signalType: "solo_do_again_no",
      idempotencySuffix: "do_again_no",
    },
    {
      session: `checkin:awaiting_bridge:${PLAN_BRIEF_ID}`,
      message: "yes",
      signalType: "solo_bridge_accepted",
      idempotencySuffix: "bridge_accepted",
    },
  ])(
    "writes $signalType in its correct branch",
    async ({ session, message, signalType, idempotencySuffix }) => {
      const deps = buildDependencies();

      await handlePostActivityCheckin(
        "usr_123",
        message,
        {
          ...BASE_SESSION,
          state_token: session,
        },
        "corr_123",
        deps,
      );

      expect(deps.insertLearningSignal).toHaveBeenCalledTimes(1);
      expect(deps.insertLearningSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          signal_type: signalType,
          idempotency_key: `ls:solo_checkin:${idempotencySuffix}:${PLAN_BRIEF_ID}:usr_123`,
        }),
      );
    },
  );

  it("handles duplicate signal writes gracefully and still advances flow", async () => {
    const deps = buildDependencies({
      insertLearningSignal: vi.fn().mockResolvedValue({
        error: {
          code: "23505",
          message: "duplicate key value violates unique constraint",
        },
      }),
    });

    await expect(
      handlePostActivityCheckin(
        "usr_123",
        "yeah",
        BASE_SESSION,
        "corr_123",
        deps,
      ),
    ).resolves.toBeUndefined();

    expect(deps.log).toHaveBeenCalledWith({
      level: "warn",
      event: "handle_post_activity_checkin.duplicate_signal",
      payload: {
        userId: "usr_123",
        correlationId: "corr_123",
        signalType: "solo_activity_attended",
        idempotencyKey: `ls:solo_checkin:attended:${PLAN_BRIEF_ID}:usr_123`,
      },
    });
    expect(deps.updateConversationSession).toHaveBeenCalledWith({
      userId: "usr_123",
      mode: "post_activity_checkin",
      state_token: `checkin:awaiting_do_again:${PLAN_BRIEF_ID}`,
      updated_at: "2026-03-03T12:00:00.000Z",
    });
  });

  it("recovers to idle when state token is missing checkin_subject_id", async () => {
    const deps = buildDependencies();

    await handlePostActivityCheckin(
      "usr_123",
      "yeah",
      {
        ...BASE_SESSION,
        state_token: "checkin:awaiting_attendance:",
      },
      "corr_123",
      deps,
    );

    expect(deps.sendSms).toHaveBeenCalledWith({
      userId: "usr_123",
      body: CHECKIN_ERROR_RECOVERY_MESSAGE,
      correlationId: "corr_123",
    });
    expect(deps.updateConversationSession).toHaveBeenCalledWith({
      userId: "usr_123",
      mode: "idle",
      state_token: "idle",
      updated_at: "2026-03-03T12:00:00.000Z",
    });
    expect(deps.insertLearningSignal).not.toHaveBeenCalled();
  });
});

describe("post activity checkin parsing helpers", () => {
  it("extracts step and checkin_subject_id from state token", () => {
    expect(extractStep(`checkin:awaiting_bridge:${PLAN_BRIEF_ID}`)).toBe("awaiting_bridge");
    expect(extractCheckinSubjectId(`checkin:awaiting_bridge:${PLAN_BRIEF_ID}`)).toBe(PLAN_BRIEF_ID);
  });

  it("returns null for malformed state token segments", () => {
    expect(extractStep("checkin:not_a_step:123")).toBeNull();
    expect(extractCheckinSubjectId("checkin:awaiting_attendance:")).toBeNull();
  });

  it("parses attendance, do-again, and bridge responses locally", () => {
    expect(parseAttendanceResponse("yeah i went")).toBe("positive");
    expect(parseAttendanceResponse("no i skipped it")).toBe("negative");
    expect(parseAttendanceResponse("it was interesting")).toBe("ambiguous");

    expect(parseDoAgainResponse("definitely")).toBe("positive");
    expect(parseDoAgainResponse("not really")).toBe("negative");
    expect(parseDoAgainResponse("maybe")).toBe("ambiguous");

    expect(parseBridgeResponse("yes please")).toBe("positive");
    expect(parseBridgeResponse("nah")).toBe("non_positive");
  });
});

function buildDependencies(
  overrides: Partial<HandlePostActivityCheckinDependencies> = {},
): HandlePostActivityCheckinDependencies {
  return {
    fetchCheckinActivityKey: vi.fn().mockResolvedValue("coffee_walk"),
    insertLearningSignal: vi.fn().mockResolvedValue({ error: null }),
    updateConversationSession: vi.fn().mockResolvedValue(undefined),
    sendSms: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    generateUuid: vi.fn().mockReturnValue("signal_123"),
    nowIso: vi.fn().mockReturnValue("2026-03-03T12:00:00.000Z"),
    ...overrides,
  };
}
