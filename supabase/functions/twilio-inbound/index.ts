// @ts-ignore: Deno runtime requires explicit file extensions for local imports.
import { createServiceRoleDbClient } from "../../../packages/db/src/client-deno.mjs";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { systemHelpResponse } from "../../../packages/messaging/src/templates/system.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  runSafetyIntercept,
  type SafetyInterceptRepository,
} from "../../../packages/core/src/safety/intercept.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  runBlockAndReportIntercept,
  type BlockReportInterceptRepository,
  type ModerationCounterpart,
} from "../../../packages/core/src/safety/block-report.ts";
import {
  dispatchConversationRoute,
  routeConversationMessage,
  type NormalizedInboundMessagePayload,
} from "../_shared/router/conversation-router.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { logEvent } from "../../../packages/core/src/observability/logger.ts";
import {
  elapsedMetricMs,
  emitMetricBestEffort,
  emitRpcFailureMetric,
  nowMetricMs,
} from "../../../packages/core/src/observability/metrics.ts";

type Command = "STOP" | "HELP" | "NONE";

const STOP_KEYWORDS = new Set(["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

const STOP_REPLY = "You are opted out of JOSH SMS. Reply START to resubscribe.";
const HELP_REPLY = systemHelpResponse();
const SAFETY_INTERCEPT_BUILD = "11.1-KEYWORD-RATE-LIMIT-CRISIS";
const BLOCK_REPORT_BUILD = "11.2-BLOCK-AND-REPORT";
const BUILD_VERSION = "4.1B-DETERMINISTIC-ROUTING-01";

const encoder = new TextEncoder();

initializeEdgeSentry("twilio-inbound");

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const startedAt = nowMetricMs();
  let outcome: "success" | "error" = "success";
  let phase = "start";
  return withSentryContext(
    {
      category: "sms_inbound",
      correlation_id: requestId,
      tags: {
        handler: "supabase/functions/twilio-inbound",
      },
    },
    async () => {
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
        event: "twilio.signature_validation_failed",
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
    const fromRaw = params.get("From")?.trim() ?? "";
    const toRaw = params.get("To")?.trim() ?? "";
    const bodyRaw = params.get("Body")?.trim() ?? "";
    const messageSid = params.get("MessageSid")?.trim() ?? "";

    if (!fromRaw || !toRaw || !bodyRaw || !messageSid) {
      return new Response("Bad Request", { status: 400 });
    }

    setSentryContext({
      category: "sms_inbound",
      correlation_id: messageSid,
    });

    const fromE164 = normalizeE164(fromRaw);
    const toE164 = normalizeE164(toRaw);
    const bodyNormalized = normalizeBody(bodyRaw);
    const command = detectCommand(bodyNormalized);

    logEvent({
      event: "twilio.inbound_received",
      correlation_id: messageSid,
      payload: {
        build_version: BUILD_VERSION,
        request_id: requestId,
        inbound_message_sid: messageSid,
        command,
      },
    });

    phase = "db_init";
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const encryptionKey = requireEnv("SMS_BODY_ENCRYPTION_KEY");

    const supabase = createServiceRoleDbClient({
      env: {
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      },
    });

    phase = "db_lookup_user";
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("phone_e164", fromE164)
      .maybeSingle();

    if (userError) {
      return new Response("Server Error", { status: 500 });
    }

    phase = "encrypt_rpc";
    const mediaCount = parseMediaCount(params.get("NumMedia"));
    const encryptedBody = await encryptBody(supabase, bodyRaw, encryptionKey);

    phase = "insert_sms";
    const { data: insertedRows, error: insertError } = await supabase
      .from("sms_messages")
      .insert(
        {
          user_id: user?.id ?? null,
          direction: "in",
          from_e164: fromE164,
          to_e164: toE164,
          twilio_message_sid: messageSid,
          body_ciphertext: encryptedBody,
          body_iv: null,
          body_tag: null,
          key_version: 1,
          media_count: mediaCount,
        },
        { onConflict: "twilio_message_sid", ignoreDuplicates: true }
      )
      .select("id");

    if (insertError) {
      if (isDuplicateSidError(insertError)) {
        logEvent({
          event: "twilio.inbound_duplicate_sid",
          correlation_id: messageSid,
          payload: {
            build_version: BUILD_VERSION,
            request_id: requestId,
            inbound_message_sid: messageSid,
            command,
          },
        });
        return deterministicResponse(command);
      }
      return new Response("Server Error", { status: 500 });
    }

    const isDuplicate = !insertedRows || insertedRows.length === 0;
    if (isDuplicate) {
      logEvent({
        event: "twilio.inbound_duplicate_sid",
        correlation_id: messageSid,
        payload: {
          build_version: BUILD_VERSION,
          request_id: requestId,
          inbound_message_sid: messageSid,
          command,
        },
      });
      return deterministicResponse(command);
    }

    const inboundMessageId = insertedRows?.[0]?.id ?? null;
    if (!inboundMessageId) {
      return new Response("Server Error", { status: 500 });
    }

    if (command === "STOP") {
      phase = "opt_out";
      logEvent({
        event: "twilio.override_applied",
        correlation_id: inboundMessageId,
        payload: {
          build_version: BUILD_VERSION,
          request_id: requestId,
          override_type: "STOP",
          inbound_message_id: inboundMessageId,
        },
      });
      const optOutError = await recordOptOut(supabase, user?.id ?? null, fromE164);
      if (optOutError) {
        return new Response("Server Error", { status: 500 });
      }

      return twimlResponse(STOP_REPLY);
    }

    if (command === "HELP") {
      logEvent({
        event: "twilio.override_applied",
        correlation_id: inboundMessageId,
        payload: {
          build_version: BUILD_VERSION,
          request_id: requestId,
          override_type: "HELP",
          inbound_message_id: inboundMessageId,
        },
      });
      return twimlResponse(HELP_REPLY);
    }

    phase = "safety_intercept";
    const safetyDecision = await startSentrySpan(
      {
        name: "safety.intercept",
        op: "safety.intercept",
        attributes: {
          correlation_id: inboundMessageId,
          inbound_message_sid: messageSid,
        },
      },
      () =>
        runSafetyIntercept({
          repository: createSupabaseSafetyInterceptRepository(supabase),
          inbound_message_id: inboundMessageId,
          inbound_message_sid: messageSid,
          user_id: user?.id ?? null,
          from_e164: fromE164,
          body_raw: bodyRaw,
          config: readSafetyInterceptConfig(),
        }),
    );

    if (safetyDecision.intercepted) {
      if (safetyDecision.action === "rate_limit") {
        logEvent({
          event: "safety.rate_limit_exceeded",
          user_id: user?.id ?? null,
          correlation_id: inboundMessageId,
          payload: {
            action: safetyDecision.action,
            window_start: new Date().toISOString(),
            window_count: null,
            threshold: null,
            request_id: requestId,
            safety_build: SAFETY_INTERCEPT_BUILD,
            inbound_message_sid: messageSid,
          },
        });
      }

      if (safetyDecision.action === "crisis") {
        logEvent({
          event: "safety.crisis_intercepted",
          user_id: user?.id ?? null,
          correlation_id: inboundMessageId,
          payload: {
            action: safetyDecision.action,
            severity: safetyDecision.severity,
            keyword_version: safetyDecision.keyword_version,
            matched_term: safetyDecision.matched_term,
            request_id: requestId,
            safety_build: SAFETY_INTERCEPT_BUILD,
            inbound_message_sid: messageSid,
          },
        });
      }

      if (safetyDecision.action === "keyword") {
        logEvent({
          event: "safety.keyword_detected",
          user_id: user?.id ?? null,
          correlation_id: inboundMessageId,
          payload: {
            action: safetyDecision.action,
            severity: safetyDecision.severity,
            keyword_version: safetyDecision.keyword_version,
            matched_term: safetyDecision.matched_term,
            strike_count: safetyDecision.strike_count,
            safety_hold: safetyDecision.safety_hold,
            replay: safetyDecision.replay,
            request_id: requestId,
          },
        });
        logEvent({
          event: "safety.strike_applied",
          user_id: user?.id ?? null,
          correlation_id: inboundMessageId,
          payload: {
            action: safetyDecision.action,
            strike_count: safetyDecision.strike_count,
            safety_hold: safetyDecision.safety_hold,
            escalated: safetyDecision.safety_hold,
            severity: safetyDecision.severity,
            keyword_version: safetyDecision.keyword_version,
          },
        });
      }

      return twimlResponse(safetyDecision.response_message ?? undefined);
    }

    phase = "block_report_intercept";
    const blockReportDecision = await runBlockAndReportIntercept({
      repository: createSupabaseBlockReportInterceptRepository(supabase),
      user_id: user?.id ?? null,
      inbound_message_id: inboundMessageId,
      inbound_message_sid: messageSid,
      body_raw: bodyRaw,
    });

    if (blockReportDecision.intercepted) {
      if (blockReportDecision.action === "block_created") {
        logEvent({
          event: "safety.block_created",
          user_id: user?.id ?? null,
          linkup_id: blockReportDecision.linkup_id,
          correlation_id: inboundMessageId,
          payload: {
            request_id: requestId,
            blocker_user_id: user?.id ?? null,
            blocked_user_id: blockReportDecision.target_user_id,
            block_report_build: BLOCK_REPORT_BUILD,
          },
        });
      }

      if (blockReportDecision.action === "report_created") {
        logEvent({
          event: "safety.report_created",
          user_id: user?.id ?? null,
          linkup_id: blockReportDecision.linkup_id,
          correlation_id: inboundMessageId,
          payload: {
            request_id: requestId,
            reporter_user_id: user?.id ?? null,
            reported_user_id: blockReportDecision.target_user_id,
            reason_category: blockReportDecision.reason_category,
            incident_id: blockReportDecision.incident_id,
            report_reason_free_text: blockReportDecision.reason_category === "other"
              ? bodyRaw
              : null,
            block_report_build: BLOCK_REPORT_BUILD,
          },
        });
      }

      if (blockReportDecision.action === "blocked_message_attempt") {
        logEvent({
          event: "safety.blocked_message_attempt",
          user_id: user?.id ?? null,
          linkup_id: blockReportDecision.linkup_id,
          correlation_id: inboundMessageId,
          payload: {
            request_id: requestId,
            linkup_id: blockReportDecision.linkup_id,
            target_user_id: blockReportDecision.target_user_id,
          },
        });
      }

      return twimlResponse(blockReportDecision.response_message ?? undefined);
    }

    phase = "route";
    const payload: NormalizedInboundMessagePayload = {
      inbound_message_id: inboundMessageId,
      inbound_message_sid: messageSid,
      from_e164: fromE164,
      to_e164: toE164,
      body_raw: bodyRaw,
      body_normalized: bodyNormalized,
    };

    const routingDecision = await startSentrySpan(
      {
        name: "conversation.router",
        op: "conversation.router",
        attributes: {
          correlation_id: inboundMessageId,
          inbound_message_sid: messageSid,
        },
      },
      () =>
        routeConversationMessage({
          supabase,
          payload,
          safetyOverrideApplied: false,
        }),
    );

    phase = "dispatch";
    const dispatchResult = await dispatchConversationRoute({
      supabase,
      decision: routingDecision,
      payload,
    });

    return twimlResponse(dispatchResult.reply_message ?? undefined);
  } catch (error) {
    outcome = "error";
    if (
      phase === "encrypt_rpc" ||
      phase === "safety_intercept" ||
      phase === "block_report_intercept"
    ) {
      emitRpcFailureMetric({
        correlation_id: requestId,
        component: "twilio_inbound",
        rpc_name: phase,
      });
    }
    const err = error as Error;
    logEvent({
      level: "error",
      event: "system.unhandled_error",
      correlation_id: requestId,
      payload: {
        build_version: BUILD_VERSION,
        request_id: requestId,
        phase,
        error_name: err?.name ?? "Error",
        error_message: err?.message ?? String(error),
        stack: err?.stack ?? null,
      },
    });
    return jsonErrorResponse(error, requestId, phase);
  } finally {
    emitMetricBestEffort({
      metric: "system.request.latency",
      value: elapsedMetricMs(startedAt),
      correlation_id: requestId,
      tags: {
        component: "twilio_inbound",
        operation: "pipeline",
        outcome,
      },
    });
  }
    },
  );
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

function normalizeBody(body: string): string {
  return body.trim().replace(/\s+/g, " ").toUpperCase();
}

function detectCommand(normalizedBody: string): Command {
  if (STOP_KEYWORDS.has(normalizedBody)) {
    return "STOP";
  }
  if (HELP_KEYWORDS.has(normalizedBody)) {
    return "HELP";
  }
  return "NONE";
}

function normalizeE164(value: string): string {
  return value.trim();
}

function parseMediaCount(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function encryptBody(
  supabase: ReturnType<typeof createServiceRoleDbClient>,
  body: string,
  key: string
): Promise<string> {
  const { data, error } = await supabase.rpc("encrypt_sms_body", {
    plaintext: body,
    key,
  });

  if (error || !data) {
    throw error ?? new Error("Failed to encrypt SMS body");
  }

  return data as string;
}

function deterministicResponse(command: Command): Response {
  if (command === "STOP") {
    return twimlResponse(STOP_REPLY);
  }
  if (command === "HELP") {
    return twimlResponse(HELP_REPLY);
  }
  return twimlResponse();
}

function isDuplicateSidError(error: { code?: string; message?: string }): boolean {
  if (error.code === "23505") {
    return true;
  }
  const message = error.message ?? "";
  return message.includes("sms_messages_twilio_sid_uniq") ||
    message.toLowerCase().includes("duplicate key");
}

async function recordOptOut(
  supabase: ReturnType<typeof createServiceRoleDbClient>,
  userId: string | null,
  phoneE164: string
): Promise<Error | null> {
  const { error: ledgerError } = await supabase
    .from("sms_opt_outs")
    .upsert(
      {
        phone_e164: phoneE164,
        opted_out_at: new Date().toISOString(),
      },
      { onConflict: "phone_e164", ignoreDuplicates: false }
    );

  if (ledgerError) {
    return ledgerError;
  }

  if (userId) {
    const { error } = await supabase
      .from("users")
      .update({ sms_consent: false })
      .eq("id", userId);
    return error ?? null;
  }
  return null;
}

function twimlResponse(message?: string): Response {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(
      message
    )}</Message></Response>`
    : "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>";

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/xml; charset=utf-8",
    },
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function readSafetyInterceptConfig(): {
  rate_limit_max_messages: number;
  rate_limit_window_seconds: number;
  strike_escalation_threshold: number;
} {
  return {
    rate_limit_max_messages: readPositiveIntEnv("SAFETY_RATE_LIMIT_MAX_MESSAGES", 10),
    rate_limit_window_seconds: readPositiveIntEnv("SAFETY_RATE_LIMIT_WINDOW_SECONDS", 60),
    strike_escalation_threshold: readPositiveIntEnv("SAFETY_STRIKE_ESCALATION_THRESHOLD", 3),
  };
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer when set.`);
  }

  return parsed;
}

function createSupabaseSafetyInterceptRepository(
  supabase: ReturnType<typeof createServiceRoleDbClient>,
): SafetyInterceptRepository {
  return {
    acquireMessageLock: async ({ user_id, inbound_message_id, inbound_message_sid }) => {
      const { data, error } = await supabase
        .from("safety_events")
        .insert(
          {
            user_id,
            inbound_message_id,
            inbound_message_sid,
            severity: null,
            keyword_version: null,
            matched_term: null,
            action_taken: "safety_intercept_lock",
            metadata: {},
          },
          {
            onConflict: "inbound_message_sid,action_taken",
            ignoreDuplicates: true,
          },
        )
        .select("id");

      if (error) {
        throw new Error(`Unable to acquire safety intercept lock: ${error.message ?? "unknown error"}`);
      }

      return Boolean(data && data.length > 0);
    },

    getUserSafetyState: async (userId: string) => {
      const { data, error } = await supabase
        .from("user_safety_state")
        .select("strike_count,safety_hold")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        throw new Error(`Unable to fetch user safety state: ${error.message ?? "unknown error"}`);
      }

      if (!data) {
        return null;
      }

      return {
        strike_count: Number(data.strike_count ?? 0),
        safety_hold: Boolean(data.safety_hold),
      };
    },

    applyRateLimit: async ({ user_id, window_seconds, max_messages, now_iso }) => {
      const { data, error } = await supabase.rpc("apply_user_safety_rate_limit", {
        p_user_id: user_id,
        p_window_seconds: window_seconds,
        p_threshold: max_messages,
        p_now: now_iso,
      });

      if (error) {
        throw new Error(`Unable to apply safety rate limit: ${error.message ?? "unknown error"}`);
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        throw new Error("Safety rate limit RPC returned no row.");
      }

      return {
        exceeded: Boolean(row.exceeded),
        rate_limit_window_start: String(row.rate_limit_window_start ?? now_iso),
        rate_limit_count: Number(row.rate_limit_count ?? 0),
      };
    },

    applyStrikes: async ({ user_id, increment, escalation_threshold, now_iso }) => {
      const { data, error } = await supabase.rpc("apply_user_safety_strikes", {
        p_user_id: user_id,
        p_increment: increment,
        p_escalation_threshold: escalation_threshold,
        p_now: now_iso,
      });

      if (error) {
        throw new Error(`Unable to apply user safety strikes: ${error.message ?? "unknown error"}`);
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        throw new Error("Safety strike RPC returned no row.");
      }

      return {
        strike_count: Number(row.strike_count ?? 0),
        safety_hold: Boolean(row.safety_hold),
        escalated: Boolean(row.escalated),
      };
    },

    setSafetyHold: async ({ user_id, now_iso }) => {
      const { data, error } = await supabase.rpc("set_user_safety_hold", {
        p_user_id: user_id,
        p_now: now_iso,
      });

      if (error) {
        throw new Error(`Unable to set user safety hold: ${error.message ?? "unknown error"}`);
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        throw new Error("Set safety hold RPC returned no row.");
      }

      return {
        strike_count: Number(row.strike_count ?? 0),
        safety_hold: Boolean(row.safety_hold),
      };
    },

    appendSafetyEvent: async (event) => {
      const { error } = await supabase
        .from("safety_events")
        .insert(
          {
            user_id: event.user_id,
            inbound_message_id: event.inbound_message_id,
            inbound_message_sid: event.inbound_message_sid,
            severity: event.severity,
            keyword_version: event.keyword_version,
            matched_term: event.matched_term,
            action_taken: event.action_taken,
            metadata: event.metadata ?? {},
          },
          {
            onConflict: "inbound_message_sid,action_taken",
            ignoreDuplicates: true,
          },
        );

      if (error) {
        throw new Error(`Unable to append safety event: ${error.message ?? "unknown error"}`);
      }
    },
  };
}

function createSupabaseBlockReportInterceptRepository(
  supabase: ReturnType<typeof createServiceRoleDbClient>,
): BlockReportInterceptRepository {
  return {
    resolveConversationContext: async (userId: string) => {
      const { data: session, error: sessionError } = await supabase
        .from("conversation_sessions")
        .select("linkup_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (sessionError) {
        throw new Error(`Unable to load conversation context: ${sessionError.message ?? "unknown error"}`);
      }

      let linkupId = session?.linkup_id ?? null;
      if (!linkupId) {
        const { data: recentMembership, error: recentMembershipError } = await supabase
          .from("linkup_members")
          .select("linkup_id")
          .eq("user_id", userId)
          .in("status", ["confirmed", "attended"])
          .order("joined_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (recentMembershipError) {
          throw new Error(`Unable to load recent linkup context: ${recentMembershipError.message ?? "unknown error"}`);
        }

        linkupId = recentMembership?.linkup_id ?? null;
      }

      if (!linkupId) {
        return {
          linkup_id: null,
          counterparts: [],
        };
      }

      const { data: counterpartRows, error: counterpartError } = await supabase
        .from("linkup_members")
        .select("user_id,users!inner(first_name,last_name)")
        .eq("linkup_id", linkupId)
        .neq("user_id", userId)
        .in("status", ["confirmed", "attended"]);

      if (counterpartError) {
        throw new Error(`Unable to load linkup counterparts: ${counterpartError.message ?? "unknown error"}`);
      }

      const counterparts: ModerationCounterpart[] = (counterpartRows ?? [])
        .map((row) => {
          const usersRow = Array.isArray(row.users) ? row.users[0] : row.users;
          return {
            user_id: String(row.user_id),
            first_name: typeof usersRow?.first_name === "string" ? usersRow.first_name : null,
            last_name: typeof usersRow?.last_name === "string" ? usersRow.last_name : null,
          };
        })
        .filter((row) => Boolean(row.user_id));

      return {
        linkup_id: String(linkupId),
        counterparts,
      };
    },

    hasBlockingRelationship: async ({ user_id, counterpart_user_ids }) => {
      if (!counterpart_user_ids.length) {
        return false;
      }

      const { data: outboundBlocks, error: outboundError } = await supabase
        .from("user_blocks")
        .select("id")
        .eq("blocker_user_id", user_id)
        .in("blocked_user_id", counterpart_user_ids)
        .limit(1);

      if (outboundError) {
        throw new Error(`Unable to check outbound user blocks: ${outboundError.message ?? "unknown error"}`);
      }

      if (outboundBlocks && outboundBlocks.length > 0) {
        return true;
      }

      const { data: inboundBlocks, error: inboundError } = await supabase
        .from("user_blocks")
        .select("id")
        .in("blocker_user_id", counterpart_user_ids)
        .eq("blocked_user_id", user_id)
        .limit(1);

      if (inboundError) {
        throw new Error(`Unable to check inbound user blocks: ${inboundError.message ?? "unknown error"}`);
      }

      return Boolean(inboundBlocks && inboundBlocks.length > 0);
    },

    upsertUserBlock: async ({ blocker_user_id, blocked_user_id, now_iso }) => {
      const { data, error } = await supabase.rpc("create_user_block", {
        p_blocker_user_id: blocker_user_id,
        p_blocked_user_id: blocked_user_id,
        p_created_at: now_iso,
      });

      if (error) {
        throw new Error(`Unable to create user block: ${error.message ?? "unknown error"}`);
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        throw new Error("create_user_block RPC returned no row.");
      }

      return {
        created: Boolean(row.created),
      };
    },

    getPendingReportPrompt: async (userId: string) => {
      const { data: promptRows, error: promptError } = await supabase
        .from("safety_events")
        .select("metadata,created_at")
        .eq("user_id", userId)
        .eq("action_taken", "report_reason_prompted")
        .order("created_at", { ascending: false })
        .limit(1);

      if (promptError) {
        throw new Error(`Unable to load pending report prompt: ${promptError.message ?? "unknown error"}`);
      }

      const prompt = promptRows?.[0];
      const metadata = (prompt?.metadata ?? {}) as Record<string, unknown>;
      const promptToken = typeof metadata.prompt_token === "string"
        ? metadata.prompt_token
        : null;
      const reportedUserId = typeof metadata.reported_user_id === "string"
        ? metadata.reported_user_id
        : null;
      const linkupId = typeof metadata.linkup_id === "string"
        ? metadata.linkup_id
        : null;

      if (!promptToken || !reportedUserId) {
        return null;
      }

      const { data: existingIncident, error: incidentError } = await supabase
        .from("moderation_incidents")
        .select("id")
        .eq("prompt_token", promptToken)
        .maybeSingle();

      if (incidentError) {
        throw new Error(`Unable to check existing moderation incident: ${incidentError.message ?? "unknown error"}`);
      }

      if (existingIncident?.id) {
        return null;
      }

      const { data: completedRows, error: completedError } = await supabase
        .from("safety_events")
        .select("id")
        .eq("user_id", userId)
        .eq("action_taken", "safety.report_created")
        .contains("metadata", { prompt_token: promptToken })
        .limit(1);

      if (completedError) {
        throw new Error(`Unable to check report completion state: ${completedError.message ?? "unknown error"}`);
      }

      if (completedRows && completedRows.length > 0) {
        return null;
      }

      const { data: clarifierRows, error: clarifierError } = await supabase
        .from("safety_events")
        .select("id")
        .eq("user_id", userId)
        .eq("action_taken", "report_reason_clarifier_prompted")
        .contains("metadata", { prompt_token: promptToken })
        .limit(1);

      if (clarifierError) {
        throw new Error(`Unable to check report reason clarifier state: ${clarifierError.message ?? "unknown error"}`);
      }

      return {
        prompt_token: promptToken,
        reported_user_id: reportedUserId,
        linkup_id: linkupId,
        clarifier_sent: Boolean(clarifierRows && clarifierRows.length > 0),
      };
    },

    createModerationIncident: async ({
      reporter_user_id,
      reported_user_id,
      linkup_id,
      reason_category,
      free_text,
      prompt_token,
      idempotency_key,
      now_iso,
    }) => {
      const { data, error } = await supabase.rpc("create_moderation_incident", {
        p_reporter_user_id: reporter_user_id,
        p_reported_user_id: reported_user_id,
        p_linkup_id: linkup_id,
        p_reason_category: reason_category,
        p_free_text: free_text,
        p_status: "open",
        p_prompt_token: prompt_token,
        p_idempotency_key: idempotency_key,
        p_metadata: {},
        p_created_at: now_iso,
      });

      if (error) {
        throw new Error(`Unable to create moderation incident: ${error.message ?? "unknown error"}`);
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.incident_id) {
        throw new Error("create_moderation_incident RPC returned no incident row.");
      }

      return {
        incident_id: String(row.incident_id),
        created: Boolean(row.created),
      };
    },

    appendSafetyEvent: async ({
      user_id,
      inbound_message_id,
      inbound_message_sid,
      action_taken,
      metadata,
      now_iso,
    }) => {
      const { error } = await supabase.rpc("append_safety_event", {
        p_user_id: user_id,
        p_inbound_message_id: inbound_message_id,
        p_inbound_message_sid: inbound_message_sid,
        p_severity: null,
        p_keyword_version: null,
        p_matched_term: null,
        p_action_taken: action_taken,
        p_metadata: metadata,
        p_created_at: now_iso,
      });

      if (error) {
        throw new Error(`Unable to append safety event for block/report: ${error.message ?? "unknown error"}`);
      }
    },
  };
}
