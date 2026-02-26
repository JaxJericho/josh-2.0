import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "../../middleware";
import { ADMIN_SESSION_COOKIE_NAME, createSignedAdminSessionToken } from "../../app/lib/admin-session";

const SECRET = "0123456789abcdef0123456789abcdef";
process.env.ADMIN_SESSION_SECRET = SECRET;

describe("admin middleware", () => {
  it("redirects unauthenticated admin route access to /admin/login", async () => {
    const request = new NextRequest("https://example.com/admin");
    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.com/admin/login");
  });

  it("returns 403 when moderator attempts super_admin-only API route", async () => {
    const token = await createSignedAdminSessionToken({
      claims: {
        sub: "4420fd00-a6aa-4dd4-ab47-32a6cb3d0e91",
        role: "moderator",
        accessToken: "access-token",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      secret: SECRET,
    });

    const request = new NextRequest("https://example.com/api/admin/users/role", {
      headers: {
        cookie: `${ADMIN_SESSION_COOKIE_NAME}=${token}`,
      },
    });

    const response = await middleware(request);
    expect(response.status).toBe(403);
  });

  it("treats expired admin sessions as unauthorized", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await createSignedAdminSessionToken({
      claims: {
        sub: "1f07f96f-3a1d-4174-b4be-4648103f7c66",
        role: "ops",
        accessToken: "access-token",
        iat: now - 600,
        exp: now - 1,
      },
      secret: SECRET,
    });

    const request = new NextRequest("https://example.com/admin", {
      headers: {
        cookie: `${ADMIN_SESSION_COOKIE_NAME}=${token}`,
      },
    });

    const response = await middleware(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.com/admin/login");
  });
});
