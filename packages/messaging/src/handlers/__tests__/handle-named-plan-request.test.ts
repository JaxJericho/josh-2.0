import { describe, expect, it, vi } from "vitest";

import {
  handleNamedPlanRequest,
  type HandleNamedPlanRequestDependencies,
  type NamedPlanIntentFields,
} from "../handle-named-plan-request";
import type { ConversationSession } from "../../intents/intent-types";

const BASE_SESSION: ConversationSession = {
  mode: "idle",
  state_token: "idle",
  has_user_record: true,
  has_pending_contact_invitation: false,
  is_unknown_number_with_pending_invitation: false,
};

const BASE_INTENT_FIELDS: NamedPlanIntentFields = {
  contactNames: ["Marcus"],
  activityHint: "hike",
  timeWindowHint: "Saturday",
};

describe("handleNamedPlanRequest", () => {
  it("sends a subscription prompt for ineligible users without creating a plan brief", async () => {
    const deps = buildDependencies({
      evaluateEligibility: vi.fn().mockResolvedValue({
        eligible: false,
        reason: "no_subscription",
      }),
    });

    await handleNamedPlanRequest(
      "usr_123",
      "See if Marcus is free for a hike Saturday",
      BASE_SESSION,
      BASE_INTENT_FIELDS,
      "corr_123",
      deps,
    );

    expect(deps.sendSms).toHaveBeenCalledTimes(1);
    expect(deps.sendSms).toHaveBeenCalledWith({
      userId: "usr_123",
      body: expect.stringContaining("active JOSH subscription"),
      correlationId: "corr_123",
    });
    expect(deps.insertPlanBrief).not.toHaveBeenCalled();
    expect(deps.updateConversationSession).not.toHaveBeenCalled();
  });

  it("creates a draft plan brief, updates session state, and sends confirmation for known contacts", async () => {
    const deps = buildDependencies({
      evaluateEligibility: vi.fn().mockResolvedValue({ eligible: true }),
      generateUuid: vi.fn().mockReturnValue("plan_123"),
      nowIso: vi.fn().mockReturnValue("2026-03-03T12:00:00.000Z"),
    });

    await handleNamedPlanRequest(
      "usr_123",
      "See if Marcus is free for a hike Saturday",
      BASE_SESSION,
      BASE_INTENT_FIELDS,
      "corr_123",
      deps,
    );

    expect(deps.insertPlanBrief).toHaveBeenCalledWith({
      id: "plan_123",
      creator_user_id: "usr_123",
      activity_key: "hike",
      proposed_time_window: "Saturday",
      notes: null,
      status: "draft",
      created_at: "2026-03-03T12:00:00.000Z",
      updated_at: "2026-03-03T12:00:00.000Z",
    });
    expect(deps.updateConversationSession).toHaveBeenCalledWith({
      userId: "usr_123",
      mode: "pending_plan_confirmation",
      state_token: "plan_brief:plan_123:contact:contact_123",
      updated_at: "2026-03-03T12:00:00.000Z",
    });
    expect(deps.sendSms).toHaveBeenCalledWith({
      userId: "usr_123",
      body: expect.stringContaining("Marcus"),
      correlationId: "corr_123",
    });
  });

  it("sends contact-not-found copy and avoids writes when contact lookup misses", async () => {
    const deps = buildDependencies({
      evaluateEligibility: vi.fn().mockResolvedValue({ eligible: true }),
      findContactByName: vi.fn().mockResolvedValue(null),
    });

    await handleNamedPlanRequest(
      "usr_123",
      "Make plans with Jordan",
      BASE_SESSION,
      { contactNames: ["Jordan"] },
      "corr_123",
      deps,
    );

    expect(deps.sendSms).toHaveBeenCalledWith({
      userId: "usr_123",
      body: expect.stringContaining("Jordan"),
      correlationId: "corr_123",
    });
    expect(deps.insertPlanBrief).not.toHaveBeenCalled();
    expect(deps.updateConversationSession).not.toHaveBeenCalled();
  });

  it("sends contact clarification when intent fields are missing contact names", async () => {
    const deps = buildDependencies({
      evaluateEligibility: vi.fn().mockResolvedValue({ eligible: true }),
    });

    await handleNamedPlanRequest(
      "usr_123",
      "Plan something this weekend",
      BASE_SESSION,
      { contactNames: [] },
      "corr_123",
      deps,
    );

    expect(deps.sendSms).toHaveBeenCalledWith({
      userId: "usr_123",
      body: expect.stringContaining("Who should I reach out to?"),
      correlationId: "corr_123",
    });
    expect(deps.findContactByName).not.toHaveBeenCalled();
    expect(deps.insertPlanBrief).not.toHaveBeenCalled();
  });

  it("throws when plan brief insert fails", async () => {
    const deps = buildDependencies({
      evaluateEligibility: vi.fn().mockResolvedValue({ eligible: true }),
      insertPlanBrief: vi.fn().mockResolvedValue({
        error: { message: "violates constraint" },
      }),
    });

    await expect(
      handleNamedPlanRequest(
        "usr_123",
        "See if Marcus is free for a hike Saturday",
        BASE_SESSION,
        BASE_INTENT_FIELDS,
        "corr_123",
        deps,
      ),
    ).rejects.toThrow("Failed to create plan_briefs row: violates constraint");
  });
});

function buildDependencies(
  overrides: Partial<HandleNamedPlanRequestDependencies> = {},
): HandleNamedPlanRequestDependencies {
  return {
    evaluateEligibility: vi.fn().mockResolvedValue({ eligible: true }),
    findContactByName: vi.fn().mockResolvedValue({
      id: "contact_123",
      contact_name: "Marcus",
      contact_phone_e164: "+14155550123",
    }),
    insertPlanBrief: vi.fn().mockResolvedValue({ error: null }),
    updateConversationSession: vi.fn().mockResolvedValue(undefined),
    sendSms: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    generateUuid: vi.fn().mockReturnValue("plan_default"),
    nowIso: vi.fn().mockReturnValue("2026-03-03T00:00:00.000Z"),
    ...overrides,
  };
}
