import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  buildInterviewTransitionPlanMock,
  enqueueColdStartInvitationMock,
  evaluateEntitlementsMock,
} = vi.hoisted(() => ({
  buildInterviewTransitionPlanMock: vi.fn(),
  enqueueColdStartInvitationMock: vi.fn(),
  evaluateEntitlementsMock: vi.fn(),
}));

vi.mock("../packages/core/src/interview/state.ts", () => ({
  buildInterviewTransitionPlan: buildInterviewTransitionPlanMock,
}));

vi.mock("../packages/core/src/invitation/cold-start-trigger.ts", () => ({
  enqueueColdStartInvitation: enqueueColdStartInvitationMock,
}));

vi.mock("../packages/core/src/entitlements/evaluate-entitlements.ts", () => ({
  createSupabaseEntitlementsRepository: vi.fn(() => ({})),
  evaluateEntitlements: evaluateEntitlementsMock,
}));

// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { runProfileInterviewEngine } from "../supabase/functions/_shared/engines/profile-interview-engine";

type SupabaseHarness = ReturnType<typeof createSupabaseHarness>;

function buildTransition(overrides?: {
  state?: "partial" | "complete_mvp";
  isCompleteMvp?: boolean;
}) {
  const state = overrides?.state ?? "complete_mvp";
  const isCompleteMvp = overrides?.isCompleteMvp ?? true;

  return {
    action: isCompleteMvp ? "complete" : "advance",
    reply_message: "All set.",
    current_step_id: "group_01",
    next_step_id: isCompleteMvp ? null : "values_01",
    next_session: {
      mode: isCompleteMvp ? "idle" : "interviewing",
      state_token: isCompleteMvp ? "idle" : "interview:values_01",
      current_step_id: isCompleteMvp ? null : "values_01",
      last_inbound_message_sid: "SM123",
      dropout_nudge_sent_at: null,
    },
    profile_patch: {
      state,
      is_complete_mvp: isCompleteMvp,
      country_code: null,
      state_code: null,
      last_interview_step: "group_01",
      preferences: {},
      coordination_dimensions: {},
      activity_patterns: [],
      boundaries: {},
      active_intent: null,
      completeness_percent: isCompleteMvp ? 100 : 72,
      completed_at: isCompleteMvp ? "2026-03-13T18:00:00.000Z" : null,
      status_reason: isCompleteMvp ? "interview_complete_mvp" : "interview_in_progress",
      state_changed_at: "2026-03-13T18:00:00.000Z",
    },
    profile_event_type: "interview_completed",
    profile_event_step_id: "group_01",
    profile_event_payload: {
      saved: true,
    },
  };
}

function createSupabaseHarness(input?: {
  profileState?: string;
  failProfileUpdate?: boolean;
}) {
  const state = {
    conversationSession: {
      id: "ses_123",
      user_id: "usr_123",
      mode: "interviewing",
      state_token: "interview:group_01",
      current_step_id: "group_01",
      last_inbound_message_sid: null as string | null,
      dropout_nudge_sent_at: null as string | null,
    },
    profile: {
      id: "pro_123",
      user_id: "usr_123",
      country_code: null as string | null,
      state_code: null as string | null,
      state: input?.profileState ?? "partial",
      is_complete_mvp: false,
      last_interview_step: "group_01",
      preferences: {},
      coordination_dimensions: {},
      activity_patterns: [],
      boundaries: {},
      active_intent: null,
      completeness_percent: 72,
      completed_at: null as string | null,
      status_reason: "interview_in_progress",
      state_changed_at: "2026-03-13T17:00:00.000Z",
      updated_at: "2026-03-13T17:00:00.000Z",
    },
    profileEvents: [] as Array<Record<string, unknown>>,
    conversationEvents: [] as Array<Record<string, unknown>>,
    auditLog: [] as Array<Record<string, unknown>>,
  };

  const supabase = {
    from(table: string) {
      if (table === "conversation_sessions") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: state.conversationSession, error: null }),
                };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            return {
              eq: async () => {
                state.conversationSession = {
                  ...state.conversationSession,
                  ...payload,
                };
                return { error: null };
              },
            };
          },
        };
      }

      if (table === "profiles") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: state.profile, error: null }),
                };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            return {
              eq: async () => {
                if (input?.failProfileUpdate) {
                  return { error: { message: "profile_update_failed" } };
                }
                state.profile = {
                  ...state.profile,
                  ...payload,
                };
                return { error: null };
              },
            };
          },
        };
      }

      if (table === "profile_events") {
        return {
          insert: async (payload: Record<string, unknown>) => {
            state.profileEvents.push(payload);
            return { error: null };
          },
        };
      }

      if (table === "conversation_events") {
        return {
          insert: async (payload: Record<string, unknown>) => {
            state.conversationEvents.push(payload);
            return { error: null };
          },
        };
      }

      if (table === "audit_log") {
        return {
          insert: async (payload: Record<string, unknown>) => {
            state.auditLog.push(payload);
            return { error: null };
          },
        };
      }

      if (table === "regions") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: null, error: null }),
                };
              },
            };
          },
        };
      }

      if (table === "profile_region_assignments") {
        return {
          upsert: async () => ({ error: null }),
        };
      }

      throw new Error(`Unexpected table '${table}'.`);
    },
  };

  return {
    state,
    supabase,
  };
}

function buildInput(harness: SupabaseHarness) {
  return {
    supabase: harness.supabase,
    decision: {
      user_id: "usr_123",
      state: {
        mode: "interviewing" as const,
        state_token: "interview:group_01",
      },
    },
    payload: {
      inbound_message_id: "msg_123",
      inbound_message_sid: "SM123",
      body_raw: "A",
    },
  } as never;
}

describe("profile interview engine cold start trigger", () => {
  beforeEach(() => {
    evaluateEntitlementsMock.mockResolvedValue({
      blocked_by_safety_hold: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues once when a persisted transition reaches complete_mvp", async () => {
    const harness = createSupabaseHarness({
      profileState: "partial",
    });
    buildInterviewTransitionPlanMock.mockResolvedValue(buildTransition());

    await runProfileInterviewEngine(buildInput(harness));

    expect(enqueueColdStartInvitationMock).toHaveBeenCalledTimes(1);
    expect(enqueueColdStartInvitationMock).toHaveBeenCalledWith("usr_123");
  });

  it("does not enqueue when the patch remains partial", async () => {
    const harness = createSupabaseHarness({
      profileState: "partial",
    });
    buildInterviewTransitionPlanMock.mockResolvedValue(buildTransition({
      state: "partial",
      isCompleteMvp: false,
    }));

    await runProfileInterviewEngine(buildInput(harness));

    expect(enqueueColdStartInvitationMock).not.toHaveBeenCalled();
  });

  it("does not enqueue when the previous profile state was already complete_mvp", async () => {
    const harness = createSupabaseHarness({
      profileState: "complete_mvp",
    });
    buildInterviewTransitionPlanMock.mockResolvedValue(buildTransition());

    await runProfileInterviewEngine(buildInput(harness));

    expect(enqueueColdStartInvitationMock).not.toHaveBeenCalled();
  });

  it("does not enqueue when the profile update fails", async () => {
    const harness = createSupabaseHarness({
      profileState: "partial",
      failProfileUpdate: true,
    });
    buildInterviewTransitionPlanMock.mockResolvedValue(buildTransition());

    await expect(runProfileInterviewEngine(buildInput(harness))).rejects.toThrow(
      "Unable to persist profile interview patch.",
    );

    expect(enqueueColdStartInvitationMock).not.toHaveBeenCalled();
  });
});
