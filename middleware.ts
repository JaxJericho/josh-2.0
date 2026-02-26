import { NextResponse, type NextRequest } from "next/server";

import {
  ADMIN_SESSION_COOKIE_NAME,
  type AdminRole,
  getAdminSessionSecret,
  verifySignedAdminSessionToken,
} from "./app/lib/admin-session";

const ROLE_GATES: Array<{ prefix: string; roles: AdminRole[] }> = [
  { prefix: "/api/admin/users/role", roles: ["super_admin"] },
  { prefix: "/api/admin/users/safety-hold", roles: ["super_admin", "moderator"] },
  { prefix: "/api/admin/moderation/status", roles: ["super_admin", "moderator"] },
  { prefix: "/admin/super-admin", roles: ["super_admin"] },
  { prefix: "/admin/moderation", roles: ["super_admin", "moderator"] },
  { prefix: "/admin/safety", roles: ["super_admin", "moderator"] },
  { prefix: "/admin/ops", roles: ["super_admin", "ops"] },
];

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;

  if (isUnprotectedAdminPath(pathname)) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get(ADMIN_SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) {
    return unauthorizedResponse(request);
  }

  let claims: Awaited<ReturnType<typeof verifySignedAdminSessionToken>> = null;
  try {
    claims = await verifySignedAdminSessionToken({
      token: sessionToken,
      secret: getAdminSessionSecret(),
    });
  } catch {
    return serverErrorResponse(request);
  }

  if (!claims) {
    return unauthorizedResponse(request);
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  if (claims.exp <= nowEpochSeconds) {
    return unauthorizedResponse(request);
  }

  const requiredRoles = resolveRequiredRoles(pathname);
  if (requiredRoles && !requiredRoles.includes(claims.role)) {
    if (pathname.startsWith("/api/admin/")) {
      return NextResponse.json({ code: "FORBIDDEN", message: "Forbidden." }, { status: 403 });
    }

    return new NextResponse("Forbidden", { status: 403 });
  }

  return NextResponse.next();
}

function isUnprotectedAdminPath(pathname: string): boolean {
  return (
    pathname === "/admin/login"
    || pathname.startsWith("/admin/login/")
    || pathname === "/api/admin/auth/login"
    || pathname === "/api/admin/auth/logout"
  );
}

function unauthorizedResponse(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/admin/")) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Unauthorized." }, { status: 401 });
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/admin/login";
  redirectUrl.search = "";
  return NextResponse.redirect(redirectUrl);
}

function serverErrorResponse(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/admin/")) {
    return NextResponse.json(
      { code: "ADMIN_SESSION_CONFIG_ERROR", message: "Admin session configuration error." },
      { status: 500 },
    );
  }

  return new NextResponse("Admin session configuration error.", { status: 500 });
}

function resolveRequiredRoles(pathname: string): AdminRole[] | null {
  for (const gate of ROLE_GATES) {
    if (pathname === gate.prefix || pathname.startsWith(`${gate.prefix}/`)) {
      return gate.roles;
    }
  }

  return null;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
