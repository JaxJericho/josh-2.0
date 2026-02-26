// @ts-ignore: Deno runtime requires explicit file extensions for local imports.
import { createServiceRoleDbClient } from "../../../packages/db/src/client-deno.mjs";
// @ts-ignore: Deno runtime requires explicit file extensions for local imports.
import { updateSmsMessageStatusByTwilioSid } from "../../../packages/db/src/queries/sms-messages.ts";
// @ts-ignore: Deno runtime requires explicit file extensions for local imports.
import { updateSmsOutboundJobStatusByTwilioSid } from "../../../packages/db/src/queries/sms-outbound-jobs.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { logEvent } from "../../../packages/core/src/observability/logger.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { setSentryContext } from "../../../packages/core/src/observability/sentry.ts";
import { initializeEdgeSentry } from "../_shared/sentry.ts";

const encoder = new TextEncoder();

initializeEdgeSentry("twilio-status-callback");

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  setSentryContext({
    category: "sms_outbound",
    correlation_id: requestId,
  });
  let phase = "start";

  try {
    phase = "method";
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    phase = "content_type";
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
      return new Response("Unsupported Media Type", { status: 415 });
    }

    phase = "parse";
    const rawBody = await req.text();
    const params = new URLSearchParams(rawBody);

    phase = "signature";
    const signature = req.headers.get("x-twilio-signature");
    if (!signature) {
      return new Response("Unauthorized", { status: 401 });
    }

    const authToken = requireEnv("TWILIO_AUTH_TOKEN");
    const signatureUrls = buildSignatureUrls(req);
    const signatureResults = await verifySignatureCandidates(
      authToken,
      signature,
      signatureUrls,
      params
    );
    const isValidSignature = signatureResults.some((result) => result.ok);

    if (!isValidSignature) {
      const hostSource = (buildSignatureUrls as { lastHostSource?: string })
        .lastHostSource ?? "unknown";
      logEvent({
        level: "warn",
        event: "twilio.status_callback.signature_failed",
        correlation_id: requestId,
        payload: {
          request_id: requestId,
          method: req.method,
          url: req.url,
          host_source: hostSource,
          candidates: signatureResults.map((result) => result.url),
          results: signatureResults.map((result) => result.ok),
          headers: {
            host: req.headers.get("host"),
            "x-forwarded-host": req.headers.get("x-forwarded-host"),
            "x-forwarded-proto": req.headers.get("x-forwarded-proto"),
          },
        },
      });
      return new Response("Forbidden", { status: 403 });
    }

    phase = "normalize";
    const messageSid =
      params.get("MessageSid")?.trim() ?? params.get("SmsSid")?.trim() ?? "";
    const messageStatus =
      params.get("MessageStatus")?.trim() ??
      params.get("SmsStatus")?.trim() ??
      "";

    if (!messageSid || !messageStatus) {
      return new Response("Bad Request", { status: 400 });
    }
    setSentryContext({
      category: "sms_outbound",
      correlation_id: messageSid,
    });

    const errorCode = params.get("ErrorCode")?.trim() ?? null;
    const errorMessage = params.get("ErrorMessage")?.trim() ?? null;

    phase = "db_init";
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createServiceRoleDbClient({
      env: {
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      },
    });

    const now = new Date().toISOString();

    phase = "update_sms_messages";
    try {
      await updateSmsMessageStatusByTwilioSid(supabase, {
        twilioMessageSid: messageSid,
        status: messageStatus,
        lastStatusAt: now,
      });
    } catch (messageUpdateError) {
      logEvent({
        level: "error",
        event: "twilio.status_callback.message_update_failed",
        correlation_id: messageSid,
        payload: {
          request_id: requestId,
          message_sid: messageSid,
          error_message: (messageUpdateError as { message?: string })?.message ?? "unknown",
        },
      });
    }

    phase = "update_jobs";
    const jobStatus = mapJobStatus(messageStatus);
    const jobUpdate: Record<string, unknown> = {
      status: jobStatus,
      last_status_at: now,
    };

    if (jobStatus === "failed") {
      const errorDetails = [errorCode, errorMessage]
        .filter(Boolean)
        .join(" ")
        .trim();
      if (errorDetails) {
        jobUpdate.last_error = errorDetails;
      }
    }

    try {
      await updateSmsOutboundJobStatusByTwilioSid(supabase, {
        twilioMessageSid: messageSid,
        status: jobStatus,
        lastStatusAt: now,
        lastError:
          typeof jobUpdate.last_error === "string" ? jobUpdate.last_error : null,
      });
    } catch (jobUpdateError) {
      logEvent({
        level: "error",
        event: "twilio.status_callback.job_update_failed",
        correlation_id: messageSid,
        payload: {
          request_id: requestId,
          message_sid: messageSid,
          error_message: (jobUpdateError as { message?: string })?.message ?? "unknown",
        },
      });
    }

    logEvent({
      event: "twilio.status_callback.processed",
      correlation_id: messageSid,
      payload: {
        request_id: requestId,
        message_sid: messageSid,
        message_status: messageStatus,
      },
    });

    return new Response("OK", { status: 200 });
  } catch (error) {
    const err = error as Error;
    logEvent({
      level: "error",
      event: "system.unhandled_error",
      correlation_id: requestId,
      payload: {
        request_id: requestId,
        phase,
        error_name: err?.name ?? "Error",
        error_message: err?.message ?? String(error),
        stack: err?.stack ?? null,
      },
    });
    return jsonErrorResponse(error, requestId, phase);
  }
});

function jsonErrorResponse(
  error: unknown,
  requestId: string,
  phase: string
): Response {
  const missingEnv = extractMissingEnvName(error);
  const payload: Record<string, unknown> = {
    code: 500,
    message: missingEnv ? "Server misconfiguration" : "Internal error",
    request_id: requestId,
    phase,
  };
  if (missingEnv) {
    payload.missing_env = missingEnv;
  }
  return new Response(JSON.stringify(payload), {
    status: 500,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function extractMissingEnvName(error: unknown): string | null {
  const message = (error as { message?: string })?.message ?? "";
  const match = /Missing required env var: ([A-Z0-9_]+)/.exec(message);
  return match ? match[1] : null;
}

function mapJobStatus(messageStatus: string): string {
  const status = messageStatus.toLowerCase();
  if (status === "delivered" || status === "sent" || status === "queued") {
    return "sent";
  }
  if (status === "failed" || status === "undelivered") {
    return "failed";
  }
  return "sending";
}

function buildSignatureUrls(req: Request): string[] {
  const url = new URL(req.url);
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");

  let hostSource: "forwarded" | "host" | "fallback_env" = "host";
  let host = forwardedHost ?? req.headers.get("host");
  if (forwardedHost) {
    hostSource = "forwarded";
  }

  if (!host || host === "edge-runtime.supabase.com") {
    const projectRef = requireEnv("PROJECT_REF");
    host = `${projectRef}.supabase.co`;
    hostSource = "fallback_env";
  }

  const proto = forwardedProto ?? "https";
  let path = url.pathname;
  if (!path.startsWith("/functions/v1/")) {
    path = `/functions/v1${path.startsWith("/") ? "" : "/"}${path}`;
  }

  const canonicalUrl = `${proto}://${host}${path}`;
  const withTrailingSlash = canonicalUrl.endsWith("/")
    ? canonicalUrl
    : `${canonicalUrl}/`;

  const urls = canonicalUrl === withTrailingSlash
    ? [canonicalUrl]
    : [canonicalUrl, withTrailingSlash];

  (buildSignatureUrls as { lastHostSource?: string }).lastHostSource =
    hostSource;

  return urls;
}

function buildSignatureBase(url: string, params: URLSearchParams): string {
  const keys = Array.from(new Set(params.keys())).sort();
  let base = url;
  for (const key of keys) {
    const values = params.getAll(key);
    for (const value of values) {
      base += key + value;
    }
  }
  return base;
}

async function verifySignatureCandidates(
  token: string,
  signature: string,
  urls: string[],
  params: URLSearchParams
): Promise<Array<{ url: string; ok: boolean }>> {
  const results: Array<{ url: string; ok: boolean }> = [];
  for (const url of urls) {
    const baseString = buildSignatureBase(url, params);
    const expectedSignature = await computeSignature(token, baseString);
    results.push({
      url,
      ok: timingSafeEqual(signature, expectedSignature),
    });
  }
  return results;
}

async function computeSignature(token: string, base: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(token),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(base));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}
