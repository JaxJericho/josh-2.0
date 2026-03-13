import { logEvent } from "../observability/logger.ts";

const ONE_HOUR_MS = 60 * 60 * 1000;
const MIN_DELAY_MS = ONE_HOUR_MS;
const MAX_DELAY_MS = 23 * ONE_HOUR_MS;
const COLD_START_ROUTE_PATH = "/api/invitations/cold-start";
const COLD_START_RECENT_INVITATION_SKIP_EVENT = "cold_start.recent_invitation_skip";

export async function enqueueColdStartInvitation(userId: string): Promise<void> {
  const db = await createServiceRoleDbClientRuntime();
  const recentThresholdIso = new Date(Date.now() - (24 * ONE_HOUR_MS)).toISOString();

  const { data, error } = await db
    .from("invitations")
    .select("id")
    .eq("user_id", userId)
    .gte("offered_at", recentThresholdIso)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to resolve cold start invitation idempotency state.");
  }

  if (data?.id) {
    logEvent({
      event: COLD_START_RECENT_INVITATION_SKIP_EVENT,
      user_id: userId,
      payload: {
        userId,
      },
    });
    return;
  }

  const delayMs = randomIntInclusive(MIN_DELAY_MS, MAX_DELAY_MS);
  const delaySeconds = Math.ceil(delayMs / 1000);
  const response = await fetch(resolveQStashPublishEndpoint(resolveColdStartTargetUrl()), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("QSTASH_TOKEN")}`,
      "content-type": "application/json; charset=utf-8",
      "Upstash-Delay": `${delaySeconds}s`,
    },
    body: JSON.stringify({ userId }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Cold start QStash publish failed (status=${response.status})${details ? `: ${details}` : ""}`,
    );
  }
}

async function createServiceRoleDbClientRuntime() {
  if (typeof (globalThis as { Deno?: unknown }).Deno !== "undefined") {
    const module = await import("../../../db/src/client-deno.mjs");
    return module.createServiceRoleDbClient();
  }

  const module = await import("../../../db/src/client-node.mjs");
  return module.createServiceRoleDbClient();
}

function resolveColdStartTargetUrl(): string {
  return new URL(COLD_START_ROUTE_PATH, resolveAppBaseUrl()).toString();
}

function resolveQStashPublishEndpoint(targetUrl: string): string {
  const qstashBaseUrl = (readEnv("QSTASH_URL") ?? "https://qstash.upstash.io").replace(/\/$/, "");
  return `${qstashBaseUrl}/v2/publish/${targetUrl}`;
}

function resolveAppBaseUrl(): string {
  const explicit = readEnv("APP_BASE_URL");
  if (explicit) {
    return normalizeAbsoluteHttpUrl(explicit, "APP_BASE_URL");
  }

  const vercelUrl = readEnv("VERCEL_URL");
  if (vercelUrl) {
    return normalizeAbsoluteHttpUrl(`https://${vercelUrl}`, "VERCEL_URL");
  }

  throw new Error("Missing required env var: APP_BASE_URL or VERCEL_URL");
}

function normalizeAbsoluteHttpUrl(raw: string, envName: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${envName} must be a valid absolute URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${envName} must use http or https.`);
  }

  if (parsed.search.length > 0) {
    throw new Error(`${envName} must not include query params.`);
  }

  return parsed.origin;
}

function readEnv(name: string): string | undefined {
  const denoRuntime = (globalThis as unknown as {
    Deno?: { env?: { get?: (key: string) => string | undefined } };
  }).Deno;
  const denoValue = denoRuntime?.env?.get?.(name);
  if (typeof denoValue === "string" && denoValue.trim()) {
    return denoValue.trim();
  }

  const nodeRuntime = (globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  const nodeValue = nodeRuntime?.env?.[name];
  if (typeof nodeValue === "string" && nodeValue.trim()) {
    return nodeValue.trim();
  }

  return undefined;
}

function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function randomIntInclusive(min: number, max: number): number {
  const span = max - min + 1;
  const randomFraction = typeof crypto?.getRandomValues === "function"
    ? crypto.getRandomValues(new Uint32Array(1))[0]! / 0x1_0000_0000
    : Math.random();

  return min + Math.floor(randomFraction * span);
}
