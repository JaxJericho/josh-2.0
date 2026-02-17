import { describe, expect, it } from "vitest";
import {
  executeAdminSetEntitlements,
  parseAdminSetEntitlementsRequest,
  type AdminSetEntitlementsRepository,
  type ProfileEntitlementsRecord,
} from "../../supabase/functions/_shared/entitlements/admin-set-entitlements";
import { resolveEntitlementsEvaluation } from "../../packages/core/src/entitlements/evaluate-entitlements";

describe("admin set entitlements", () => {
  it("requires reason when an override field is set true", () => {
    expect(() =>
      parseAdminSetEntitlementsRequest({
        profile_id: "pro_1",
        waitlist_override: true,
      })
    ).toThrow("reason is required when any override field is set to true");
  });

  it("upsert is replay-safe and does not duplicate profile entitlements rows", async () => {
    const repository = new InMemoryEntitlementsRepository();
    const command = parseAdminSetEntitlementsRequest({
      profile_id: "pro_1",
      can_initiate: true,
      can_participate: true,
      waitlist_override: true,
      reason: "Ticket 6.1 test override",
    });

    const first = await executeAdminSetEntitlements({
      command,
      actor: {
        admin_user_id: "adm_usr_1",
        admin_profile_id: "adm_pro_1",
      },
      repository,
    });

    const second = await executeAdminSetEntitlements({
      command,
      actor: {
        admin_user_id: "adm_usr_1",
        admin_profile_id: "adm_pro_1",
      },
      repository,
    });

    expect(first.profile_entitlements.profile_id).toBe("pro_1");
    expect(repository.rowCount()).toBe(1);
    expect(second.profile_entitlements.profile_id).toBe("pro_1");
    expect(second.audit_log).toBe("duplicate");
    expect(repository.rowCount()).toBe(1);
  });

  it("admin override flips behavior deterministically in evaluator", async () => {
    const repository = new InMemoryEntitlementsRepository();
    const command = parseAdminSetEntitlementsRequest({
      profile_id: "pro_waitlist",
      can_initiate: true,
      waitlist_override: true,
      reason: "Allow waitlist bypass for test account",
    });

    const result = await executeAdminSetEntitlements({
      command,
      actor: {
        admin_user_id: "adm_usr_1",
        admin_profile_id: "adm_pro_1",
      },
      repository,
    });

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
        can_initiate: result.profile_entitlements.can_initiate,
        can_participate: result.profile_entitlements.can_participate,
        can_exchange_contact: result.profile_entitlements.can_exchange_contact,
        region_override: result.profile_entitlements.region_override,
        waitlist_override: result.profile_entitlements.waitlist_override,
        safety_override: result.profile_entitlements.safety_override,
        reason: result.profile_entitlements.reason,
      },
    });

    expect(evaluation.blocked_by_waitlist).toBe(false);
    expect(evaluation.can_initiate).toBe(true);
    expect(evaluation.can_participate).toBe(true);
  });
});

class InMemoryEntitlementsRepository implements AdminSetEntitlementsRepository {
  private rowsByProfileId = new Map<string, ProfileEntitlementsRecord>();
  private auditIdempotencyKeys = new Set<string>();
  private sequence = 0;

  async upsertProfileEntitlements(input: {
    profile_id: string;
    fields: Partial<Record<"can_initiate" | "can_participate" | "can_exchange_contact" | "region_override" | "waitlist_override" | "safety_override", boolean>>;
    reason: string | null;
    updated_by: string | null;
  }): Promise<ProfileEntitlementsRecord> {
    const nowIso = "2026-02-17T18:00:00.000Z";
    const existing = this.rowsByProfileId.get(input.profile_id);

    const row: ProfileEntitlementsRecord = {
      id: existing?.id ?? `ent_${++this.sequence}`,
      profile_id: input.profile_id,
      can_initiate: input.fields.can_initiate ?? existing?.can_initiate ?? false,
      can_participate: input.fields.can_participate ?? existing?.can_participate ?? false,
      can_exchange_contact: input.fields.can_exchange_contact ?? existing?.can_exchange_contact ?? false,
      region_override: input.fields.region_override ?? existing?.region_override ?? false,
      waitlist_override: input.fields.waitlist_override ?? existing?.waitlist_override ?? false,
      safety_override: input.fields.safety_override ?? existing?.safety_override ?? false,
      reason: input.reason,
      updated_by: input.updated_by,
      created_at: existing?.created_at ?? nowIso,
      updated_at: nowIso,
    };

    this.rowsByProfileId.set(input.profile_id, row);
    return row;
  }

  async writeAuditLog(input: {
    admin_user_id: string | null;
    profile_id: string;
    reason: string | null;
    fields: Partial<Record<"can_initiate" | "can_participate" | "can_exchange_contact" | "region_override" | "waitlist_override" | "safety_override", boolean>>;
    updated_by: string | null;
    idempotency_key: string;
  }): Promise<"inserted" | "duplicate"> {
    if (this.auditIdempotencyKeys.has(input.idempotency_key)) {
      return "duplicate";
    }

    this.auditIdempotencyKeys.add(input.idempotency_key);
    return "inserted";
  }

  rowCount(): number {
    return this.rowsByProfileId.size;
  }
}
