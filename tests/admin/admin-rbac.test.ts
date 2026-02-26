import { describe, expect, it } from "vitest";

import { AdminAuthError, assertAdminRole, requireAdminRole } from "../../app/lib/admin-auth";

describe("admin RBAC enforcement", () => {
  it("denies non-admin callers", async () => {
    const run = () =>
      requireAdminRole("ops", {
        resolveContext: async () => {
          throw new AdminAuthError(403, "FORBIDDEN", "Forbidden.");
        },
      });

    await expect(run()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("denies moderator role for super_admin actions", async () => {
    const run = () =>
      requireAdminRole("super_admin", {
        resolveContext: async () => ({
          userId: "cf2f87b4-b52d-4d2a-b389-d3876bbf1934",
          role: "moderator",
          authorization: "Bearer test-token",
          expiresAt: Math.floor(Date.now() / 1000) + 60,
        }),
      });

    await expect(run()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("allows listed role when requirement includes it", () => {
    expect(() => assertAdminRole({ requiredRoles: ["ops", "super_admin"], actualRole: "ops" })).not.toThrow();
  });
});
