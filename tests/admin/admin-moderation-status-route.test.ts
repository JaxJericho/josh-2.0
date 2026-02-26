import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../../app/api/admin/moderation/status/route";
import { logAdminAction } from "../../app/lib/admin-audit";
import { AdminAuthError, requireAdminRole } from "../../app/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "../../app/lib/supabase-service-role";

vi.mock("../../app/lib/admin-auth", async () => {
  const actual = await vi.importActual<typeof import("../../app/lib/admin-auth")>("../../app/lib/admin-auth");
  return {
    ...actual,
    requireAdminRole: vi.fn(),
  };
});

vi.mock("../../app/lib/admin-audit", () => ({
  logAdminAction: vi.fn(),
}));

vi.mock("../../app/lib/supabase-service-role", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
}));

describe("admin moderation status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns forbidden for insufficient role", async () => {
    vi.mocked(requireAdminRole).mockRejectedValue(new AdminAuthError(403, "FORBIDDEN", "Forbidden."));

    const response = await POST(
      new Request("https://example.com/api/admin/moderation/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          incident_id: "f84f03f4-9cc9-4300-b5be-94cc0c6937cd",
          status: "reviewed",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "FORBIDDEN" });
  });

  it("updates status and writes admin audit log", async () => {
    vi.mocked(requireAdminRole).mockResolvedValue({
      userId: "1b7f2ed0-d6b9-46be-a4bd-19bcad2a6253",
      role: "moderator",
      authorization: "Bearer admin-token",
      expiresAt: Math.floor(Date.now() / 1000) + 120,
    });

    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "f84f03f4-9cc9-4300-b5be-94cc0c6937cd",
        status: "open",
      },
      error: null,
    });
    const updateSingle = vi.fn().mockResolvedValue({
      data: {
        id: "f84f03f4-9cc9-4300-b5be-94cc0c6937cd",
        status: "reviewed",
      },
      error: null,
    });

    const serviceClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle,
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: updateSingle,
            }),
          }),
        }),
      }),
    };

    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(serviceClient as never);

    const response = await POST(
      new Request("https://example.com/api/admin/moderation/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          incident_id: "f84f03f4-9cc9-4300-b5be-94cc0c6937cd",
          status: "reviewed",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(logAdminAction).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      incident: {
        id: "f84f03f4-9cc9-4300-b5be-94cc0c6937cd",
        status: "reviewed",
      },
    });
  });
});
