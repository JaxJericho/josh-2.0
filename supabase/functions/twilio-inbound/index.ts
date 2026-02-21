// @ts-ignore: Deno runtime requires explicit file extensions for local imports.
import { createServiceRoleDbClient } from "../../../packages/db/src/client-deno.mjs";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { systemHelpResponse } from "../../../packages/messaging/src/templates/system.ts";
import {
  dispatchConversationRoute,
  routeConversationMessage,
  type NormalizedInboundMessagePayload,
} from "../_shared/router/conversation-router.ts";

type Command = "STOP" | "HELP" | "NONE";

const STOP_KEYWORDS = new Set(["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

const STOP_REPLY = "You are opted out of JOSH SMS. Reply START to resubscribe.";
const HELP_REPLY = systemHelpResponse();
const BUILD_VERSION = "4.1B-DETERMINISTIC-ROUTING-01";

const encoder = new TextEncoder();

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
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
      console.warn("twilio.signature_validation_failed", {
        request_id: requestId,
        method: req.method,
        url: req.url,
        headers: {
          host: req.headers.get("host"),
          "x-forwarded-host": req.headers.get("x-forwarded-host"),
          "x-forwarded-proto": req.headers.get("x-forwarded-proto"),
        },
        host_source: hostSource,
        candidates: signatureResults.map((result) => result.url),
        results: signatureResults.map((result) => result.ok),
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

    const fromE164 = normalizeE164(fromRaw);
    const toE164 = normalizeE164(toRaw);
    const bodyNormalized = normalizeBody(bodyRaw);
    const command = detectCommand(bodyNormalized);

    console.info("twilio.inbound_request", {
      build_version: BUILD_VERSION,
      request_id: requestId,
      inbound_message_sid: messageSid,
      command,
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
        console.info("twilio.inbound_duplicate_sid", {
          build_version: BUILD_VERSION,
          request_id: requestId,
          inbound_message_sid: messageSid,
          command,
        });
        return deterministicResponse(command);
      }
      return new Response("Server Error", { status: 500 });
    }

    const isDuplicate = !insertedRows || insertedRows.length === 0;
    if (isDuplicate) {
      console.info("twilio.inbound_duplicate_sid", {
        build_version: BUILD_VERSION,
        request_id: requestId,
        inbound_message_sid: messageSid,
        command,
      });
      return deterministicResponse(command);
    }

    const inboundMessageId = insertedRows?.[0]?.id ?? null;
    if (!inboundMessageId) {
      return new Response("Server Error", { status: 500 });
    }

    if (command === "STOP") {
      phase = "opt_out";
      console.info("twilio.override_applied", {
        build_version: BUILD_VERSION,
        request_id: requestId,
        override_type: "STOP",
        inbound_message_id: inboundMessageId,
      });
      const optOutError = await recordOptOut(supabase, user?.id ?? null, fromE164);
      if (optOutError) {
        return new Response("Server Error", { status: 500 });
      }

      return twimlResponse(STOP_REPLY);
    }

    if (command === "HELP") {
      console.info("twilio.override_applied", {
        build_version: BUILD_VERSION,
        request_id: requestId,
        override_type: "HELP",
        inbound_message_id: inboundMessageId,
      });
      return twimlResponse(HELP_REPLY);
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

    const routingDecision = await routeConversationMessage({
      supabase,
      payload,
      safetyOverrideApplied: false,
    });

    console.info("twilio.router_decision", {
      build_version: BUILD_VERSION,
      request_id: requestId,
      inbound_message_id: inboundMessageId,
      user_id: routingDecision.user_id,
      session_mode: routingDecision.state.mode,
      session_state_token: routingDecision.state.state_token,
      profile_is_complete_mvp: routingDecision.profile_is_complete_mvp,
      route: routingDecision.route,
    });

    phase = "dispatch";
    const dispatchResult = await dispatchConversationRoute({
      supabase,
      decision: routingDecision,
      payload,
    });

    console.info("twilio.router_dispatch_completed", {
      build_version: BUILD_VERSION,
      request_id: requestId,
      inbound_message_id: inboundMessageId,
      user_id: routingDecision.user_id,
      session_mode: routingDecision.state.mode,
      session_state_token: routingDecision.state.state_token,
      profile_is_complete_mvp: routingDecision.profile_is_complete_mvp,
      route: routingDecision.route,
      engine: dispatchResult.engine,
    });

    return twimlResponse(dispatchResult.reply_message ?? undefined);
  } catch (error) {
    const err = error as Error;
    console.error("twilio.unhandled_error", {
      build_version: BUILD_VERSION,
      request_id: requestId,
      phase,
      name: err?.name ?? "Error",
      message: err?.message ?? String(error),
      stack: err?.stack ?? null,
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
