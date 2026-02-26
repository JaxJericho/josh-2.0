import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminAuthError } from "../../app/lib/admin-auth";
import { POST } from "../../app/api/admin/users/role/route";
import { createAdminScopedClient, requireAdminRole } from "../../app/lib/admin-auth";
import { logAdminAction } from "../../app/lib/admin-audit";

vi.mock("../../app/lib/admin-auth", async () => {
  const actual = await vi.importActual<typeof import("../../app/lib/admin-auth")>("../../app/lib/admin-auth");
  return {
    ...actual,
    requireAdminRole: vi.fn(),
    createAdminScopedClient: vi.fn(),
  };
});

vi.mock("../../app/lib/admin-audit", () => ({
  logAdminAction: vi.fn(),
}));

describe("admin user role route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns forbidden when caller is not super_admin", async () => {
    vi.mocked(requireAdminRole).mockRejectedValue(
      new AdminAuthError(403, "FORBIDDEN", "Forbidden."),
    );

    const response = await POST(
      new Request("https://example.com/api/admin/users/role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: "07f5d65a-8769-4cba-b95f-f60390cde530",
          role: "moderator",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "FORBIDDEN" });
  });

  it("enforces role update path and writes audit log", async () => {
    vi.mocked(requireAdminRole).mockResolvedValue({
      userId: "2427d0ee-9fed-41ad-afc4-d0f17e869d69",
      role: "super_admin",
      authorization: "Bearer admin-token",
      expiresAt: Math.floor(Date.now() / 1000) + 120,
    });

    const single = vi.fn().mockResolvedValue({
      data: {
        user_id: "07f5d65a-8769-4cba-b95f-f60390cde530",
        role: "moderator",
      },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ single });
    const upsert = vi.fn().mockReturnValue({ select });

    vi.mocked(createAdminScopedClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ upsert }),
    } as never);

    const response = await POST(
      new Request("https://example.com/api/admin/users/role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: "07f5d65a-8769-4cba-b95f-f60390cde530",
          role: "moderator",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(logAdminAction).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      admin_user: {
        user_id: "07f5d65a-8769-4cba-b95f-f60390cde530",
        role: "moderator",
      },
    });
  });
});
