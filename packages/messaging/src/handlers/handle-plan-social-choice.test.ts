import { describe, expect, it, vi } from "vitest";

import {
  detectPlanSocialChoiceKind,
  handlePlanSocialChoice,
  type HandlePlanSocialChoiceDependencies,
} from "./handle-plan-social-choice.ts";

const BASE_SESSION = {
  mode: "awaiting_social_choice" as const,
  state_token: "social:awaiting_choice:solo_walk:0",
  has_user_record: true,
  has_pending_contact_invitation: false,
  is_unknown_number_with_pending_invitation: false,
};

describe("handlePlanSocialChoice", () => {
  it("accepts a suggestion, creates a confirmed plan brief, and transitions to pending_plan_confirmation", async () => {
    const deps = buildDependencies();

    await handlePlanSocialChoice("usr_123", "yes", BASE_SESSION, deps);

    expect(deps.createPlanBrief).toHaveBeenCalledWith({
      userId: "usr_123",
      activityKey: "solo_walk",
      notes: "yes",
      status: "confirmed",
    });
    expect(deps.updateSessionState).toHaveBeenCalledWith({
      userId: "usr_123",
      mode: "pending_plan_confirmation",
      stateToken: "plan:pending_confirmation",
    });
    expect(deps.sendMessage).toHaveBeenCalledWith({
      userId: "usr_123",
      body: "Great choice. I confirmed that plan and will follow up with next steps shortly.",
    });
    expect(deps.writeAuditEvent).toHaveBeenCalledWith({
      userId: "usr_123",
      action: "social_choice_accepted_plan_confirmed",
      targetType: "plan_brief",
      targetId: "plan_123",
      reason: "social_choice_accept",
      payload: {
        selected_activity_key: "solo_walk",
        plan_brief_id: "plan_123",
      },
    });
  });

  it("declines a suggestion and transitions session to idle", async () => {
    const deps = buildDependencies();

    await handlePlanSocialChoice("usr_123", "no thanks", BASE_SESSION, deps);

    expect(deps.createPlanBrief).not.toHaveBeenCalled();
    expect(deps.updateSessionState).toHaveBeenCalledWith({
      userId: "usr_123",
      mode: "idle",
      stateToken: "idle",
    });
    expect(deps.sendMessage).toHaveBeenCalledWith({
      userId: "usr_123",
      body: "No worries - reach out whenever you feel like doing something.",
    });
    expect(deps.writeAuditEvent).toHaveBeenCalledWith({
      userId: "usr_123",
      action: "social_choice_declined_session_idle",
      targetType: "conversation_session",
      reason: "social_choice_decline",
      payload: {
        prior_activity_key: "solo_walk",
      },
    });
  });

  it("modifies a suggestion and keeps awaiting_social_choice with updated state token", async () => {
    const deps = buildDependencies({
      suggestSoloActivity: vi.fn().mockResolvedValue(buildActivity({ activity_key: "hiking_loop" })),
    });

    await handlePlanSocialChoice(
      "usr_123",
      "Actually, hiking instead",
      BASE_SESSION,
      deps,
    );

    expect(deps.suggestSoloActivity).toHaveBeenCalledWith({
      userId: "usr_123",
      excludeActivityKeys: ["solo_walk"],
    });
    expect(deps.sendMessage).toHaveBeenCalledWith({
      userId: "usr_123",
      body: "Take a scenic hiking trail loop.",
    });
    expect(deps.updateSessionState).toHaveBeenCalledWith({
      userId: "usr_123",
      mode: "awaiting_social_choice",
      stateToken: "social:awaiting_choice:hiking_loop:0",
    });
    expect(deps.writeAuditEvent).toHaveBeenCalledWith({
      userId: "usr_123",
      action: "social_choice_modified_suggestion_updated",
      targetType: "conversation_session",
      reason: "social_choice_modify",
      payload: {
        prior_activity_key: "solo_walk",
        next_activity_key: "hiking_loop",
      },
    });
  });

  it("tracks alternative requests and gracefully exits after the third request", async () => {
    const deps = buildDependencies();
    const session = {
      ...BASE_SESSION,
      state_token: "social:awaiting_choice:solo_walk:2",
    };

    await handlePlanSocialChoice("usr_123", "something else", session, deps);

    expect(deps.suggestSoloActivity).not.toHaveBeenCalled();
    expect(deps.updateSessionState).toHaveBeenCalledWith({
      userId: "usr_123",
      mode: "idle",
      stateToken: "idle",
    });
    expect(deps.sendMessage).toHaveBeenCalledWith({
      userId: "usr_123",
      body: "We can revisit this whenever you're in the mood.",
    });
    expect(deps.writeAuditEvent).toHaveBeenNthCalledWith(1, {
      userId: "usr_123",
      action: "social_choice_alternative_requested",
      targetType: "conversation_session",
      reason: "social_choice_alternative_requested",
      payload: {
        prior_activity_key: "solo_walk",
        alternative_request_count: 3,
      },
    });
    expect(deps.writeAuditEvent).toHaveBeenNthCalledWith(2, {
      userId: "usr_123",
      action: "social_choice_alternative_limit_reached",
      targetType: "conversation_session",
      reason: "social_choice_alternative_limit",
      payload: {
        alternative_request_count: 3,
      },
    });
  });
});

describe("detectPlanSocialChoiceKind", () => {
  it("detects deterministic social choice categories", () => {
    expect(detectPlanSocialChoiceKind("yes")).toBe("accept");
    expect(detectPlanSocialChoiceKind("no thanks")).toBe("decline");
    expect(detectPlanSocialChoiceKind("Actually hiking instead")).toBe("modify");
    expect(detectPlanSocialChoiceKind("something else")).toBe("request_alternative");
  });
});

function buildDependencies(
  overrides: Partial<HandlePlanSocialChoiceDependencies> = {},
): HandlePlanSocialChoiceDependencies {
  return {
    createPlanBrief: vi.fn().mockResolvedValue({ id: "plan_123" }),
    suggestSoloActivity: vi.fn().mockResolvedValue(buildActivity()),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    updateSessionState: vi.fn().mockResolvedValue(undefined),
    writeAuditEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function buildActivity(
  overrides: Partial<{
    activity_key: string;
    short_description: string;
  }> = {},
) {
  return {
    id: "act_2",
    activity_key: overrides.activity_key ?? "coffee_walk",
    display_name: "Coffee Walk",
    category: "outdoor",
    short_description: overrides.short_description ?? "Take a scenic hiking trail loop.",
    regional_availability: "anywhere" as const,
    motive_weights: {
      restorative: 0.6,
      connection: 0.3,
      play: 0.1,
      exploration: 0.4,
      achievement: 0.2,
      stimulation: 0.4,
      belonging: 0.1,
      focus: 0.2,
      comfort: 0.7,
    },
    constraints: {
      setting: "outdoor" as const,
      noise_level: "quiet" as const,
      physical_demand: "low" as const,
      requires_booking: false,
      weather_dependent: true,
    },
    preferred_windows: ["evening"] as const,
    group_size_fit: ["solo"] as const,
    tags: null,
    created_at: "2026-03-01T00:00:00.000Z",
  };
}
