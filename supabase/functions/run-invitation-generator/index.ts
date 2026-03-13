// @ts-ignore: Deno runtime requires explicit file extensions for local imports.
import { createServiceRoleDbClient } from "../../../packages/db/src/client-deno.mjs";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  createSupabaseReEngagementRepository,
  sendReEngagementMessageWithRepository,
} from "../../../packages/core/src/invitation/re-engagement.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { INVITATION_BACKOFF_THRESHOLD } from "../../../packages/core/src/invitation/constants.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { logEvent } from "../../../packages/core/src/observability/logger.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { setSentryContext } from "../../../packages/core/src/observability/sentry.ts";
import { initializeEdgeSentry } from "../_shared/sentry.ts";

const GENERATOR_CRON_DISPATCHED_EVENT = "generator_cron.dispatched";
const REGIONAL_GENERATOR_ROUTE_PATH = "/api/invitations/run-regional-generator";

type RegionRow = {
  id: string;
};

type ThresholdUserRow = {
  id: string;
};

initializeEdgeSentry("run-invitation-generator");

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  setSentryContext({
    category: "invitation_generator",
    correlation_id: requestId,
  });
  let phase = "start";

  try {
    phase = "method";
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method Not Allowed" }, 405);
    }

    phase = "auth";
    const authResponse = await verifyRunnerRequest(req);
    if (authResponse) {
      return authResponse;
    }

    phase = "env";
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const smsEncryptionKey = requireEnv("SMS_BODY_ENCRYPTION_KEY");
    const qstashToken = requireEnv("QSTASH_TOKEN");

    phase = "supabase_init";
    const supabase = createServiceRoleDbClient({
      env: {
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      },
    });
    const repository = createSupabaseReEngagementRepository(supabase);

    phase = "regions";
    const regions = await fetchOpenRegions(supabase);
    let reEngagementSentCount = 0;
    let reEngagementSkippedCount = 0;

    for (const region of regions) {
      phase = `reengagement:${region.id}`;
      const thresholdUserIds = await fetchThresholdUserIds(supabase, region.id);

      for (const userId of thresholdUserIds) {
        const result = await sendReEngagementMessageWithRepository({
          userId,
          repository,
          smsEncryptionKey,
        });

        if (result.sent) {
          reEngagementSentCount += 1;
        } else {
          reEngagementSkippedCount += 1;
        }
      }

      phase = `enqueue:${region.id}`;
      await enqueueRegionalGeneratorRun({
        qstashToken,
        regionId: region.id,
      });
    }

    logEvent({
      event: GENERATOR_CRON_DISPATCHED_EVENT,
      correlation_id: requestId,
      payload: {
        regionCount: regions.length,
        reEngagementSentCount,
        reEngagementSkippedCount,
        request_id: requestId,
      },
    });

    return jsonResponse(
      {
        ok: true,
        regionCount: regions.length,
        reEngagementSentCount,
        reEngagementSkippedCount,
      },
      200,
    );
  } catch (error) {
    logEvent({
      level: "error",
      event: "system.unhandled_error",
      correlation_id: requestId,
      payload: {
        phase,
        error_name: normalizeErrorName(error),
        error_message: normalizeErrorMessage(error),
        request_id: requestId,
      },
    });

    return jsonResponse({ error: "Internal Server Error" }, 500);
  }
});

async function fetchOpenRegions(
  supabase: ReturnType<typeof createServiceRoleDbClient>,
): Promise<RegionRow[]> {
  const { data, error } = await supabase
    .from("regions")
    .select("id")
    .eq("state", "open");

  if (error) {
    throw new Error(`Unable to load open regions: ${error.message}`);
  }

  return (data ?? [])
    .filter((row): row is RegionRow => typeof row.id === "string" && row.id.length > 0);
}

async function fetchThresholdUserIds(
  supabase: ReturnType<typeof createServiceRoleDbClient>,
  regionId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("region_id", regionId)
    .eq("state", "active")
    .gte("invitation_backoff_count", INVITATION_BACKOFF_THRESHOLD);

  if (error) {
    throw new Error(`Unable to load re-engagement users for region ${regionId}: ${error.message}`);
  }

  return (data ?? [])
    .map((row) => (typeof (row as ThresholdUserRow).id === "string" ? (row as ThresholdUserRow).id : null))
    .filter((value): value is string => value !== null);
}

async function enqueueRegionalGeneratorRun(input: {
  qstashToken: string;
  regionId: string;
}): Promise<void> {
  const response = await fetch(resolveQStashPublishEndpoint(resolveRegionalGeneratorUrl()), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.qstashToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ regionId: input.regionId }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Regional generator QStash publish failed (status=${response.status})${details ? `: ${details}` : ""}`,
    );
  }
}

function resolveRegionalGeneratorUrl(): string {
  return new URL(REGIONAL_GENERATOR_ROUTE_PATH, resolveAppBaseUrl()).toString();
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

  const appEnv = readEnv("APP_ENV");
  if (appEnv === "staging") {
    return "https://josh-2-0-staging.vercel.app";
  }
  if (appEnv === "production") {
    return "https://www.callmejosh.ai";
  }

  throw new Error("Missing required env var: APP_BASE_URL or VERCEL_URL");
}

function normalizeAbsoluteHttpUrl(value: string, envName: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
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
  const value = Deno.env.get(name);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function verifyRunnerRequest(req: Request): Promise<Response | null> {
  const hasUpstashSignatureHeader = Boolean(
    req.headers.get("Upstash-Signature") ?? req.headers.get("upstash-signature"),
  );
  const runnerSecretHeader = req.headers.get("x-runner-secret") ?? "";
  const runnerSecret = Deno.env.get("QSTASH_RUNNER_SECRET") ?? "";

  if (runnerSecretHeader) {
    const ok = Boolean(runnerSecret) && timingSafeEqual(runnerSecretHeader, runnerSecret);
    if (!ok) {
      return unauthorizedResponse({
        authBranch: "runner_secret_header",
        method: req.method,
        contentTypePresent: Boolean(req.headers.get("content-type")),
        hasUpstashSignatureHeader,
        hasRunnerSecretHeader: true,
        runnerSecretEnvPresent: Boolean(runnerSecret),
        runnerSecretMatches: Boolean(runnerSecret) &&
          timingSafeEqual(runnerSecretHeader, runnerSecret),
      });
    }
    return null;
  }

  return unauthorizedResponse({
    authBranch: "missing_auth",
    method: req.method,
    contentTypePresent: Boolean(req.headers.get("content-type")),
    hasUpstashSignatureHeader,
    hasRunnerSecretHeader: false,
    runnerSecretEnvPresent: Boolean(runnerSecret),
    runnerSecretMatches: false,
  });
}

function unauthorizedResponse(input: {
  authBranch: "runner_secret_header" | "missing_auth";
  method: string;
  contentTypePresent: boolean;
  hasUpstashSignatureHeader: boolean;
  hasRunnerSecretHeader: boolean;
  runnerSecretEnvPresent: boolean;
  runnerSecretMatches: boolean;
}): Response {
  return jsonResponse(
    {
      error: "Unauthorized",
      debug: {
        auth_branch: input.authBranch,
        method: input.method,
        content_type_present: input.contentTypePresent,
        has_upstash_signature_header: input.hasUpstashSignatureHeader,
        has_runner_secret_header: input.hasRunnerSecretHeader,
        runner_secret_env_present: input.runnerSecretEnvPresent,
        runner_secret_matches: input.runnerSecretMatches,
      },
    },
    401,
  );
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function normalizeErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim().length > 0) {
    return error.name;
  }

  return "Error";
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Unknown error";
}
