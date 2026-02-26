import { cookies } from "next/headers";
import { createAnonDbClient } from "../../packages/db/src/client-node.mjs";
import type { DbClient } from "../../packages/db/src/types";
import {
  ADMIN_CSRF_COOKIE_NAME,
  ADMIN_ROLES,
  ADMIN_SESSION_COOKIE_NAME,
  type AdminRole,
  createCsrfToken,
  createSignedAdminSessionToken,
  getAdminSessionSecret,
  isAdminRole,
  resolveSessionExpiry,
  verifySignedAdminSessionToken,
} from "./admin-session";

export class AdminAuthError extends Error {
  readonly status: 401 | 403 | 500;
  readonly code: string;

  constructor(status: 401 | 403 | 500, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type AdminSessionContext = {
  userId: string;
  role: AdminRole;
  authorization: string;
  expiresAt: number;
};

type CookieWrite = {
  name: string;
  value: string;
  options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "strict";
    path: string;
    maxAge: number;
  };
};

export async function signInAdminWithPassword(params: {
  email: string;
  password: string;
}): Promise<{
  context: AdminSessionContext;
  sessionCookie: CookieWrite;
  csrfCookie: CookieWrite;
}> {
  const email = params.email.trim();
  const password = params.password;

  if (!email || !password) {
    throw new AdminAuthError(401, "INVALID_CREDENTIALS", "Invalid admin credentials.");
  }

  const authClient = createAnonDbClient();
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token || !data.user?.id) {
    throw new AdminAuthError(401, "INVALID_CREDENTIALS", "Invalid admin credentials.");
  }

  const authorization = `Bearer ${data.session.access_token}`;
  const scopedClient = createAdminScopedClient(authorization);
  const adminRow = await resolveAdminMembership(scopedClient, data.user.id);
  if (!adminRow) {
    throw new AdminAuthError(403, "FORBIDDEN", "Forbidden.");
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = resolveSessionExpiry({
    nowEpochSeconds,
    authSessionExpiryEpochSeconds: typeof data.session.expires_at === "number"
      ? data.session.expires_at
      : null,
  });

  const token = await createSignedAdminSessionToken({
    claims: {
      sub: adminRow.userId,
      role: adminRow.role,
      accessToken: data.session.access_token,
      iat: nowEpochSeconds,
      exp: expiresAt,
    },
    secret: getAdminSessionSecret(),
  });

  const maxAge = Math.max(1, expiresAt - nowEpochSeconds);
  const csrfToken = createCsrfToken();

  return {
    context: {
      userId: adminRow.userId,
      role: adminRow.role,
      authorization,
      expiresAt,
    },
    sessionCookie: {
      name: ADMIN_SESSION_COOKIE_NAME,
      value: token,
      options: {
        httpOnly: true,
        secure: shouldUseSecureCookies(),
        sameSite: "strict",
        path: "/",
        maxAge,
      },
    },
    csrfCookie: {
      name: ADMIN_CSRF_COOKIE_NAME,
      value: csrfToken,
      options: {
        httpOnly: false,
        secure: shouldUseSecureCookies(),
        sameSite: "strict",
        path: "/",
        maxAge,
      },
    },
  };
}

export async function requireAdminRole(
  requiredRoles: AdminRole | AdminRole[],
  params?: {
    request?: Request;
    resolveContext?: () => Promise<AdminSessionContext>;
  },
): Promise<AdminSessionContext> {
  const contextResolver = params?.resolveContext ?? getAdminSessionContext;
  const context = await contextResolver();

  if (params?.request) {
    enforceCsrfForMutation(params.request);
  }

  assertAdminRole({ requiredRoles, actualRole: context.role });

  return context;
}

export async function getAdminSessionContext(): Promise<AdminSessionContext> {
  const sessionToken = cookies().get(ADMIN_SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) {
    throw new AdminAuthError(401, "UNAUTHORIZED", "Admin authentication required.");
  }

  const claims = await verifySignedAdminSessionToken({
    token: sessionToken,
    secret: getAdminSessionSecret(),
  });

  if (!claims) {
    throw new AdminAuthError(401, "INVALID_SESSION", "Admin session is invalid.");
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  if (claims.exp <= nowEpochSeconds) {
    throw new AdminAuthError(401, "SESSION_EXPIRED", "Admin session expired.");
  }

  const authorization = `Bearer ${claims.accessToken}`;
  const scopedClient = createAdminScopedClient(authorization);
  const adminRow = await resolveAdminMembership(scopedClient, claims.sub);
  if (!adminRow) {
    throw new AdminAuthError(403, "FORBIDDEN", "Forbidden.");
  }

  return {
    userId: adminRow.userId,
    role: adminRow.role,
    authorization,
    expiresAt: claims.exp,
  };
}

export function clearAdminSessionCookies(): CookieWrite[] {
  return [
    {
      name: ADMIN_SESSION_COOKIE_NAME,
      value: "",
      options: {
        httpOnly: true,
        secure: shouldUseSecureCookies(),
        sameSite: "strict",
        path: "/",
        maxAge: 0,
      },
    },
    {
      name: ADMIN_CSRF_COOKIE_NAME,
      value: "",
      options: {
        httpOnly: false,
        secure: shouldUseSecureCookies(),
        sameSite: "strict",
        path: "/",
        maxAge: 0,
      },
    },
  ];
}

export function createAdminScopedClient(authorization: string): DbClient {
  return createAnonDbClient({ authorization });
}

export function assertAdminRole(params: {
  requiredRoles: AdminRole | AdminRole[];
  actualRole: AdminRole;
}): void {
  const allowedRoles = normalizeRequiredRoles(params.requiredRoles);
  if (!allowedRoles.includes(params.actualRole)) {
    throw new AdminAuthError(403, "FORBIDDEN", "Forbidden.");
  }
}

function normalizeRequiredRoles(requiredRoles: AdminRole | AdminRole[]): AdminRole[] {
  const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
  const filtered = roles.filter((role): role is AdminRole => isAdminRole(role));

  if (filtered.length === 0) {
    throw new AdminAuthError(500, "INVALID_ROLE_CONFIG", "Admin role configuration is invalid.");
  }

  return filtered;
}

function enforceCsrfForMutation(request: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
    return;
  }

  const csrfCookie = cookies().get(ADMIN_CSRF_COOKIE_NAME)?.value?.trim();
  const csrfHeader = request.headers.get("x-admin-csrf-token")?.trim();

  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    throw new AdminAuthError(403, "CSRF_FORBIDDEN", "Forbidden.");
  }

  const origin = request.headers.get("origin")?.trim();
  if (!origin) {
    throw new AdminAuthError(403, "CSRF_FORBIDDEN", "Forbidden.");
  }

  const requestOrigin = new URL(request.url).origin;
  if (origin !== requestOrigin) {
    throw new AdminAuthError(403, "CSRF_FORBIDDEN", "Forbidden.");
  }
}

async function resolveAdminMembership(
  client: DbClient,
  userId: string,
): Promise<{ userId: string; role: AdminRole } | null> {
  const { data, error } = await client
    .from("admin_users")
    .select("user_id,role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    const status = typeof error.code === "string" && error.code.startsWith("PGRST") ? 403 : 500;
    if (status === 403) {
      throw new AdminAuthError(403, "FORBIDDEN", "Forbidden.");
    }
    throw new AdminAuthError(500, "ADMIN_LOOKUP_FAILED", "Unable to verify admin membership.");
  }

  if (!data?.user_id || !isAdminRole(data.role)) {
    return null;
  }

  return {
    userId: data.user_id,
    role: data.role,
  };
}

function shouldUseSecureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

export { ADMIN_ROLES };
