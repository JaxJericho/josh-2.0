// @ts-ignore: Deno runtime requires explicit file extensions for local imports.
import { createServiceRoleDbClient } from "../../../packages/db/src/client-deno.mjs";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  createSupabaseInvitationExpiryRepository,
  expireStaleInvitations,
} from "../../../packages/core/src/invitation/expire-invitations.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { logEvent } from "../../../packages/core/src/observability/logger.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { setSentryContext } from "../../../packages/core/src/observability/sentry.ts";
import { initializeEdgeSentry } from "../_shared/sentry.ts";

const EXPIRE_INVITATIONS_COMPLETE_EVENT = "expire_invitations.complete";

initializeEdgeSentry("invitation-expiry-runner");

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  setSentryContext({
    category: "invitation_expiry",
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

    phase = "supabase_init";
    const supabase = createServiceRoleDbClient({
      env: {
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      },
    });

    phase = "expire";
    const result = await expireStaleInvitations({
      repository: createSupabaseInvitationExpiryRepository(supabase),
      correlationId: requestId,
      log: (entry) => {
        logEvent({
          level: entry.level,
          event: entry.event,
          correlation_id: entry.correlation_id,
          user_id: entry.user_id,
          payload: entry.payload,
        });
      },
    });

    logEvent({
      event: EXPIRE_INVITATIONS_COMPLETE_EVENT,
      correlation_id: requestId,
      payload: {
        expiredCount: result.expiredCount,
        request_id: requestId,
      },
    });

    return jsonResponse(
      {
        ok: true,
        expiredCount: result.expiredCount,
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
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function verifyRunnerRequest(req: Request): Promise<Response | null> {
  const hasUpstashSignatureHeader = Boolean(
    req.headers.get("Upstash-Signature") ?? req.headers.get("upstash-signature")
  );
  const runnerSecretHeader = req.headers.get("x-runner-secret") ?? "";
  const runnerSecret = Deno.env.get("QSTASH_RUNNER_SECRET") ?? "";

  if (runnerSecretHeader) {
    const ok = Boolean(runnerSecret) &&
      timingSafeEqual(runnerSecretHeader, runnerSecret);
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
