import { describe, expect, it } from "vitest";
import { resolveEntitlementsEvaluation } from "../../packages/core/src/entitlements/evaluate-entitlements";

describe("entitlements evaluator", () => {
  it("returns active-region participation for WA launch region", () => {
    const evaluation = resolveEntitlementsEvaluation({
      profile_id: "pro_wa",
      user_id: "usr_wa",
      region: {
        id: "reg_wa",
        slug: "us-wa",
        is_active: true,
        is_launch_region: true,
      },
      waitlist_entry: null,
      has_active_safety_hold: false,
      stored_entitlements: null,
    });

    expect(evaluation.is_active_region).toBe(true);
    expect(evaluation.is_waitlist_region).toBe(false);
    expect(evaluation.can_participate).toBe(true);
    expect(evaluation.can_initiate).toBe(false);
    expect(evaluation.can_exchange_contact).toBe(false);
  });

  it("blocks waitlist profiles from initiate/participate unless overridden", () => {
    const evaluation = resolveEntitlementsEvaluation({
      profile_id: "pro_waitlist",
      user_id: "usr_waitlist",
      region: {
        id: "reg_waitlist",
        slug: "waitlist",
        is_active: false,
        is_launch_region: false,
      },
      waitlist_entry: {
        profile_id: "pro_waitlist",
        region_id: "reg_waitlist",
        status: "waiting",
        last_notified_at: null,
      },
      has_active_safety_hold: false,
      stored_entitlements: {
        can_initiate: true,
        can_participate: true,
        can_exchange_contact: false,
        region_override: false,
        waitlist_override: false,
        safety_override: false,
        reason: null,
      },
    });

    expect(evaluation.blocked_by_waitlist).toBe(true);
    expect(evaluation.can_initiate).toBe(false);
    expect(evaluation.can_participate).toBe(false);
  });

  it("waitlist override allows deterministic bypass", () => {
    const evaluation = resolveEntitlementsEvaluation({
      profile_id: "pro_waitlist_override",
      user_id: "usr_waitlist_override",
      region: {
        id: "reg_waitlist",
        slug: "waitlist",
        is_active: false,
        is_launch_region: false,
      },
      waitlist_entry: {
        profile_id: "pro_waitlist_override",
        region_id: "reg_waitlist",
        status: "waiting",
        last_notified_at: null,
      },
      has_active_safety_hold: false,
      stored_entitlements: {
        can_initiate: true,
        can_participate: false,
        can_exchange_contact: false,
        region_override: false,
        waitlist_override: true,
        safety_override: false,
        reason: "manual override",
      },
    });

    expect(evaluation.blocked_by_waitlist).toBe(false);
    expect(evaluation.can_initiate).toBe(true);
    expect(evaluation.can_participate).toBe(true);
  });

  it("safety hold blocks all capabilities even in active region", () => {
    const evaluation = resolveEntitlementsEvaluation({
      profile_id: "pro_hold",
      user_id: "usr_hold",
      region: {
        id: "reg_wa",
        slug: "us-wa",
        is_active: true,
        is_launch_region: true,
      },
      waitlist_entry: null,
      has_active_safety_hold: true,
      stored_entitlements: {
        can_initiate: true,
        can_participate: true,
        can_exchange_contact: true,
        region_override: false,
        waitlist_override: false,
        safety_override: false,
        reason: null,
      },
    });

    expect(evaluation.blocked_by_safety_hold).toBe(true);
    expect(evaluation.can_initiate).toBe(false);
    expect(evaluation.can_participate).toBe(false);
    expect(evaluation.can_exchange_contact).toBe(false);
  });
});
