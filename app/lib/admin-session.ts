export const ADMIN_SESSION_COOKIE_NAME = "josh_admin_session";
export const ADMIN_CSRF_COOKIE_NAME = "josh_admin_csrf";
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 8;

export const ADMIN_ROLES = ["super_admin", "moderator", "ops"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export type AdminSessionClaims = {
  sub: string;
  role: AdminRole;
  accessToken: string;
  iat: number;
  exp: number;
};

export function getAdminSessionSecret(): string {
  const value = process.env.ADMIN_SESSION_SECRET?.trim();
  if (!value) {
    throw new Error("Missing required env var: ADMIN_SESSION_SECRET");
  }

  if (value.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET must be at least 32 characters.");
  }

  return value;
}

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}

export function createCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function resolveSessionExpiry(params: {
  nowEpochSeconds: number;
  authSessionExpiryEpochSeconds: number | null;
}): number {
  const maxExpiry = params.nowEpochSeconds + ADMIN_SESSION_TTL_SECONDS;

  if (!params.authSessionExpiryEpochSeconds) {
    return maxExpiry;
  }

  return Math.min(params.authSessionExpiryEpochSeconds, maxExpiry);
}

export async function createSignedAdminSessionToken(params: {
  claims: AdminSessionClaims;
  secret: string;
}): Promise<string> {
  const claimsBase64 = utf8ToBase64Url(JSON.stringify(params.claims));
  const signature = await signPayload({ payload: claimsBase64, secret: params.secret });
  return `${claimsBase64}.${signature}`;
}

export async function verifySignedAdminSessionToken(params: {
  token: string;
  secret: string;
}): Promise<AdminSessionClaims | null> {
  const [claimsBase64, providedSignature] = params.token.split(".");
  if (!claimsBase64 || !providedSignature) {
    return null;
  }

  const expectedSignature = await signPayload({ payload: claimsBase64, secret: params.secret });
  if (!timingSafeEqual(providedSignature, expectedSignature)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlToUtf8(claimsBase64));
  } catch {
    return null;
  }

  if (!isValidSessionClaims(parsed)) {
    return null;
  }

  return parsed;
}

function isValidSessionClaims(value: unknown): value is AdminSessionClaims {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sub === "string"
    && isAdminRole(candidate.role)
    && typeof candidate.accessToken === "string"
    && typeof candidate.iat === "number"
    && Number.isFinite(candidate.iat)
    && typeof candidate.exp === "number"
    && Number.isFinite(candidate.exp)
  );
}

async function signPayload(params: { payload: string; secret: string }): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(params.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(params.payload),
  );

  return bytesToBase64Url(new Uint8Array(signature));
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index];
  }

  return diff === 0;
}

function utf8ToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToUtf8(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
