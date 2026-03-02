import { describe, expect, it, vi } from "vitest";

import {
  handleOpenIntent,
  renderSoloSuggestion,
  type HandleOpenIntentDependencies,
} from "./handle-open-intent";

const BASE_SESSION = {
  mode: "idle" as const,
  has_user_record: true,
  has_pending_contact_invitation: false,
  is_unknown_number_with_pending_invitation: false,
};

describe("handleOpenIntent", () => {
  it("hands off to LinkUp flow when user is linkup eligible", async () => {
    const deps = buildDependencies({
      evaluateEligibility: vi
        .fn()
        .mockResolvedValueOnce({ allowed: true }),
      handoffToLinkupFlow: vi.fn().mockResolvedValue({ took_over: true }),
    });

    await handleOpenIntent("usr_123", "i want to get out", BASE_SESSION, deps);

    expect(deps.evaluateEligibility).toHaveBeenCalledWith({
      userId: "usr_123",
      action_type: "can_initiate_linkup",
    });
    expect(deps.handoffToLinkupFlow).toHaveBeenCalledTimes(1);
    expect(deps.suggestSoloActivity).not.toHaveBeenCalled();
    expect(deps.updateSessionMode).not.toHaveBeenCalled();
  });

  it("checks named-plan gate and still falls back to solo when named-plan flow does not take over", async () => {
    const deps = buildDependencies({
      evaluateEligibility: vi
        .fn()
        .mockResolvedValueOnce({ allowed: false })
        .mockResolvedValueOnce({ allowed: true }),
      hasContactCircleEntries: vi.fn().mockResolvedValue(true),
      handoffToNamedPlanFlow: vi.fn().mockResolvedValue({ took_over: false }),
    });

    await handleOpenIntent("usr_123", "free saturday", BASE_SESSION, deps);

    expect(deps.evaluateEligibility).toHaveBeenNthCalledWith(1, {
      userId: "usr_123",
      action_type: "can_initiate_linkup",
    });
    expect(deps.evaluateEligibility).toHaveBeenNthCalledWith(2, {
      userId: "usr_123",
      action_type: "can_initiate_named_plan",
    });
    expect(deps.handoffToNamedPlanFlow).toHaveBeenCalledTimes(1);
    expect(deps.suggestSoloActivity).toHaveBeenCalledTimes(1);
    expect(deps.sendMessage).toHaveBeenCalledWith({
      userId: "usr_123",
      body: "Try a low-key evening walk in your neighborhood.",
    });
    expect(deps.updateSessionMode).toHaveBeenCalledWith({
      userId: "usr_123",
      mode: "awaiting_social_choice",
    });
  });

  it("falls back to solo immediately when no named-plan path is available", async () => {
    const deps = buildDependencies({
      evaluateEligibility: vi.fn().mockResolvedValue({ allowed: false }),
      hasContactCircleEntries: vi.fn().mockResolvedValue(false),
    });

    await handleOpenIntent("usr_123", "what should i do", BASE_SESSION, deps);

    expect(deps.handoffToNamedPlanFlow).not.toHaveBeenCalled();
    expect(deps.suggestSoloActivity).toHaveBeenCalledWith("usr_123");
    expect(deps.updateSessionMode).toHaveBeenCalledWith({
      userId: "usr_123",
      mode: "awaiting_social_choice",
    });
  });
});

describe("renderSoloSuggestion", () => {
  it("returns canonical short description from activity catalog", () => {
    const message = renderSoloSuggestion({
      id: "act_1",
      activity_key: "solo_walk",
      display_name: "Neighborhood Walk",
      category: "outdoor",
      short_description: "  Take a 20-minute walk around your neighborhood.  ",
      regional_availability: "anywhere",
      motive_weights: {
        restorative: 0.8,
        connection: 0.1,
        play: 0.2,
        exploration: 0.3,
        achievement: 0.4,
        stimulation: 0.2,
        belonging: 0.1,
        focus: 0.5,
        comfort: 0.8,
      },
      constraints: {
        setting: "outdoor",
        noise_level: "quiet",
        physical_demand: "low",
        requires_booking: false,
        weather_dependent: true,
      },
      preferred_windows: ["evening"],
      group_size_fit: ["solo"],
      tags: null,
      created_at: "2026-02-28T00:00:00.000Z",
    });

    expect(message).toBe("Take a 20-minute walk around your neighborhood.");
  });
});

function buildDependencies(
  overrides: Partial<HandleOpenIntentDependencies> = {},
): HandleOpenIntentDependencies {
  return {
    evaluateEligibility: vi.fn().mockResolvedValue({ allowed: false }),
    hasContactCircleEntries: vi.fn().mockResolvedValue(false),
    handoffToLinkupFlow: vi.fn().mockResolvedValue({ took_over: false }),
    handoffToNamedPlanFlow: vi.fn().mockResolvedValue({ took_over: false }),
    suggestSoloActivity: vi.fn().mockResolvedValue({
      id: "act_1",
      activity_key: "solo_walk",
      display_name: "Neighborhood Walk",
      category: "outdoor",
      short_description: "Try a low-key evening walk in your neighborhood.",
      regional_availability: "anywhere",
      motive_weights: {
        restorative: 0.8,
        connection: 0.1,
        play: 0.2,
        exploration: 0.3,
        achievement: 0.4,
        stimulation: 0.2,
        belonging: 0.1,
        focus: 0.5,
        comfort: 0.8,
      },
      constraints: {
        setting: "outdoor",
        noise_level: "quiet",
        physical_demand: "low",
        requires_booking: false,
        weather_dependent: true,
      },
      preferred_windows: ["evening"],
      group_size_fit: ["solo"],
      tags: null,
      created_at: "2026-02-28T00:00:00.000Z",
    }),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    updateSessionMode: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
