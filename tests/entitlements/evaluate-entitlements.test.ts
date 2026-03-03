import { describe, expect, it } from "vitest";
import { resolveEntitlementsEvaluation } from "../../packages/core/src/entitlements/evaluate-entitlements";

describe("entitlements evaluator", () => {
  it("defaults all capabilities to false when no stored entitlements exist", () => {
    const evaluation = resolveEntitlementsEvaluation({
      profile_id: "pro_default",
      user_id: "usr_default",
      has_active_safety_hold: false,
      stored_entitlements: null,
    });

    expect(evaluation.can_initiate).toBe(false);
    expect(evaluation.can_participate).toBe(false);
    expect(evaluation.can_exchange_contact).toBe(false);
  });

  it("returns stored capability flags when no safety hold is active", () => {
    const evaluation = resolveEntitlementsEvaluation({
      profile_id: "pro_stored",
      user_id: "usr_stored",
      has_active_safety_hold: false,
      stored_entitlements: {
        can_initiate: true,
        can_participate: false,
        can_exchange_contact: true,
        region_override: false,
        waitlist_override: false,
        safety_override: false,
        reason: null,
      },
    });

    expect(evaluation.blocked_by_safety_hold).toBe(false);
    expect(evaluation.can_initiate).toBe(true);
    expect(evaluation.can_participate).toBe(false);
    expect(evaluation.can_exchange_contact).toBe(true);
  });

  it("safety override preserves capabilities during active holds", () => {
    const evaluation = resolveEntitlementsEvaluation({
      profile_id: "pro_hold_override",
      user_id: "usr_hold_override",
      has_active_safety_hold: true,
      stored_entitlements: {
        can_initiate: true,
        can_participate: true,
        can_exchange_contact: false,
        region_override: false,
        waitlist_override: false,
        safety_override: true,
        reason: "manual safety override",
      },
    });

    expect(evaluation.blocked_by_safety_hold).toBe(false);
    expect(evaluation.can_initiate).toBe(true);
    expect(evaluation.can_participate).toBe(true);
  });

  it("safety hold blocks all capabilities even in active region", () => {
    const evaluation = resolveEntitlementsEvaluation({
      profile_id: "pro_hold",
      user_id: "usr_hold",
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
