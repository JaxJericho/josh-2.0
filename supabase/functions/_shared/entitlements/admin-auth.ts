// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { AdminSetEntitlementsError } from "./admin-set-entitlements.ts";

export type AdminAuthContext =
  | {
      ok: true;
      status: 200;
      mode: "secret";
    }
  | {
      ok: true;
      status: 200;
      mode: "bearer";
      authorization: string;
      user_id: string;
    };

export function resolveAdminAuthContext(params: {
  authorizationHeader: string | null;
  adminSecretHeader: string | null;
  configuredAdminOpsSecret: string | null;
  parseUserIdFromJwt: (token: string) => string | null;
}): AdminAuthContext {
  const adminSecretHeader = normalizeHeader(params.adminSecretHeader);
  if (adminSecretHeader) {
    const configuredSecret = normalizeHeader(params.configuredAdminOpsSecret);
    if (!configuredSecret) {
      throw new AdminSetEntitlementsError(
        500,
        "MISSING_ENV",
        "Server misconfiguration: missing required env var ADMIN_OPS_SECRET.",
      );
    }

    if (!timingSafeEqual(adminSecretHeader, configuredSecret)) {
      throw new AdminSetEntitlementsError(401, "UNAUTHORIZED", "Unauthorized.");
    }

    return {
      ok: true,
      status: 200,
      mode: "secret",
    };
  }

  const authorization = normalizeHeader(params.authorizationHeader);
  if (!authorization?.startsWith("Bearer ")) {
    throw new AdminSetEntitlementsError(401, "UNAUTHORIZED", "Unauthorized.");
  }

  const accessToken = authorization.slice("Bearer ".length).trim();
  const userId = params.parseUserIdFromJwt(accessToken);
  if (!userId) {
    throw new AdminSetEntitlementsError(401, "UNAUTHORIZED", "Unauthorized.");
  }

  return {
    ok: true,
    status: 200,
    mode: "bearer",
    authorization,
    user_id: userId,
  };
}

function normalizeHeader(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}
