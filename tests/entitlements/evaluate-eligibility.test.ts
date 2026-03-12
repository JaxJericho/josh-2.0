import { describe, expect, it } from "vitest";
import {
  evaluateEligibility,
  type EligibilityRepository,
} from "../../packages/core/src/entitlements/evaluate-eligibility";

function buildRepository(
  overrides: Partial<EligibilityRepository> = {},
): EligibilityRepository {
  return {
    getRegionForUser: async () => ({ status: "open" }),
    getSubscription: async () => ({ status: "active" }),
    getProfile: async () => ({ state: "complete_mvp" }),
    getSafetyHold: async () => "none",
    hasActiveUserRecord: async () => true,
    ...overrides,
  };
}

describe("evaluateEligibility", () => {
  it("denies can_participate_in_linkup when region is not open", async () => {
    await expect(
      evaluateEligibility({
        userId: "usr_region_closed",
        action_type: "can_participate_in_linkup",
        repository: buildRepository({
          getRegionForUser: async () => ({ status: "waitlisted" }),
        }),
      }),
    ).resolves.toEqual({
      eligible: false,
      reason: "INELIGIBLE_REGION",
    });
  });

  it("denies can_participate_in_linkup when subscription is not active", async () => {
    await expect(
      evaluateEligibility({
        userId: "usr_subscription_inactive",
        action_type: "can_participate_in_linkup",
        repository: buildRepository({
          getSubscription: async () => ({ status: "canceled" }),
        }),
      }),
    ).resolves.toEqual({
      eligible: false,
      reason: "INELIGIBLE_SUBSCRIPTION",
    });
  });

  it("allows can_participate_in_linkup when region is open and subscription is active", async () => {
    await expect(
      evaluateEligibility({
        userId: "usr_participate_allowed",
        action_type: "can_participate_in_linkup",
        repository: buildRepository(),
      }),
    ).resolves.toEqual({
      eligible: true,
    });
  });

  it("allows can_receive_contact_invitation for any active user record", async () => {
    await expect(
      evaluateEligibility({
        userId: "usr_contact_invite",
        action_type: "can_receive_contact_invitation",
        repository: buildRepository(),
      }),
    ).resolves.toEqual({
      eligible: true,
    });
  });

  it("denies can_receive_invitation when subscription is not active", async () => {
    await expect(
      evaluateEligibility({
        userId: "usr_invite_inactive",
        action_type: "can_receive_invitation",
        repository: buildRepository({
          getSubscription: async () => ({ status: "past_due" }),
        }),
      }),
    ).resolves.toEqual({
      eligible: false,
      reason: "INELIGIBLE_SUBSCRIPTION",
    });
  });

  it("denies can_receive_invitation when profile is complete_invited", async () => {
    await expect(
      evaluateEligibility({
        userId: "usr_complete_invited",
        action_type: "can_receive_invitation",
        repository: buildRepository({
          getProfile: async () => ({ state: "complete_invited" }),
        }),
      }),
    ).resolves.toEqual({
      eligible: false,
      reason: "INELIGIBLE_PROFILE_INCOMPLETE",
    });
  });

  it("denies can_receive_invitation when profile is partial", async () => {
    await expect(
      evaluateEligibility({
        userId: "usr_partial",
        action_type: "can_receive_invitation",
        repository: buildRepository({
          getProfile: async () => ({ state: "partial" }),
        }),
      }),
    ).resolves.toEqual({
      eligible: false,
      reason: "INELIGIBLE_PROFILE_INCOMPLETE",
    });
  });

  it("denies can_receive_invitation when a safety hold is active", async () => {
    await expect(
      evaluateEligibility({
        userId: "usr_hold",
        action_type: "can_receive_invitation",
        repository: buildRepository({
          getSafetyHold: async () => "active",
        }),
      }),
    ).resolves.toEqual({
      eligible: false,
      reason: "INELIGIBLE_SAFETY_HOLD",
    });
  });

  it("allows can_receive_invitation when subscription is active, profile is complete, and safety hold is none", async () => {
    await expect(
      evaluateEligibility({
        userId: "usr_receive_allowed",
        action_type: "can_receive_invitation",
        repository: buildRepository({
          getProfile: async () => ({ state: "complete_mvp" }),
        }),
      }),
    ).resolves.toEqual({
      eligible: true,
    });
  });

  it("throws when called with retired or unknown action types", async () => {
    await expect(
      evaluateEligibility({
        userId: "usr_old_linkup",
        action_type: "can_initiate_linkup",
        repository: buildRepository(),
      }),
    ).rejects.toThrow(
      "evaluateEligibility called with unknown action_type: can_initiate_linkup",
    );

    await expect(
      evaluateEligibility({
        userId: "usr_old_named_plan",
        action_type: "can_initiate_named_plan",
        repository: buildRepository(),
      }),
    ).rejects.toThrow(
      "evaluateEligibility called with unknown action_type: can_initiate_named_plan",
    );
  });
});
