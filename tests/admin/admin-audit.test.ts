import { describe, expect, it } from "vitest";

import { logAdminAction } from "../../app/lib/admin-audit";

describe("admin audit logging", () => {
  it("writes an admin_audit_log row on mutation action", async () => {
    const inserts: Array<Record<string, unknown>> = [];

    const fakeClient = {
      from(table: string) {
        expect(table).toBe("admin_audit_log");
        return {
          insert(payload: Record<string, unknown>) {
            inserts.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      },
    };

    await logAdminAction(
      {
        authorization: "Bearer test",
        admin_user_id: "248addf4-ec6e-4052-8e3c-76a8db9ec802",
        action: "admin_user_role_upsert",
        target_type: "admin_user",
        target_id: "b219ca99-c2b7-4df3-a845-7b8ab9064951",
        metadata_json: { assigned_role: "ops" },
      },
      { client: fakeClient as never },
    );

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      admin_user_id: "248addf4-ec6e-4052-8e3c-76a8db9ec802",
      action: "admin_user_role_upsert",
      target_type: "admin_user",
      target_id: "b219ca99-c2b7-4df3-a845-7b8ab9064951",
      metadata_json: { assigned_role: "ops" },
    });
  });
});
