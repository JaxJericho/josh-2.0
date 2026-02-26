import crypto from "crypto";
import { captureSentryException } from "../../../../../packages/core/src/observability/sentry";
import { generateRequestId, logEvent } from "../../../../lib/observability";
import { attachSentryScopeContext, traceApiRoute } from "../../../../lib/sentry";

type SmsMessageRow = {
  id: string;
  status: string | null;
  last_status_at: string | null;
};

type SmsOutboundJobRow = {
  id: string;
  status: string | null;
  last_status_at: string | null;
};

type StatusCallbackPayload = {
  messageSid: string;
  messageStatus: string;
  errorCode: string | null;
  errorMessage: string | null;
  providerEventAt: string | null;
  payloadFingerprint: string;
};

const MESSAGE_TERMINAL_STATUSES = new Set([
  "delivered",
  "undelivered",
  "failed",
  "canceled",
  "read",
]);

const MESSAGE_STATUS_ORDER: Record<string, number> = {
  accepted: 10,
  queued: 20,
  sending: 30,
  sent: 40,
};

const JOB_TERMINAL_STATUSES = new Set(["sent", "failed", "canceled"]);
const JOB_STATUS_ORDER: Record<string, number> = {
  pending: 10,
  sending: 20,
};

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const requestId = request.headers.get("x-request-id") ?? generateRequestId();
  const handler = "api/webhooks/twilio/status";
  attachSentryScopeContext({
    category: "sms_outbound",
    correlation_id: requestId,
    tags: { handler },
  });

  return traceApiRoute(handler, async () => {
    try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
      return new Response("Unsupported Media Type", { status: 415 });
    }

    const rawBody = await request.text();
    const params = new URLSearchParams(rawBody);

    const signature = request.headers.get("x-twilio-signature");
    if (!signature) {
      logEvent({
        level: "warn",
        event: "twilio.status_callback.missing_signature",
        handler,
        request_id: requestId,
      });
      return new Response("Unauthorized", { status: 401 });
    }

    const authToken = requireEnv("TWILIO_AUTH_TOKEN");
    const candidates = buildSignatureUrlCandidates(request);
    const signatureMatches = candidates.some((candidate) => {
      const expected = computeTwilioSignature(candidate, params, authToken);
      return timingSafeEqual(signature, expected);
    });

    if (!signatureMatches) {
      logEvent({
        level: "warn",
        event: "twilio.status_callback.invalid_signature",
        handler,
        request_id: requestId,
      });
      return new Response("Forbidden", { status: 403 });
    }

    const payload = parsePayload(rawBody, params);
    if (!payload.messageSid || !payload.messageStatus) {
      return new Response("Bad Request", { status: 400 });
    }
    attachSentryScopeContext({
      category: "sms_outbound",
      correlation_id: payload.messageSid,
      tags: { handler },
    });

    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const nowIso = new Date().toISOString();
    const statusTimestamp = payload.providerEventAt ?? nowIso;

    const messageRow = await fetchSmsMessageBySid(
      supabaseUrl,
      serviceRoleKey,
      payload.messageSid
    );

    await insertStatusHistory(supabaseUrl, serviceRoleKey, {
      sms_message_id: messageRow?.id ?? null,
      message_sid: payload.messageSid,
      message_status: payload.messageStatus,
      payload_fingerprint: payload.payloadFingerprint,
      provider_event_at: payload.providerEventAt,
      error_code: payload.errorCode,
      error_message: payload.errorMessage,
      received_at: nowIso,
    });

    if (messageRow && shouldAdvanceMessageStatus(messageRow.status, payload.messageStatus)) {
      await updateSmsMessage(supabaseUrl, serviceRoleKey, messageRow.id, {
        status: payload.messageStatus,
        last_status_at: statusTimestamp,
      });
    }

    const jobs = await fetchOutboundJobsBySid(
      supabaseUrl,
      serviceRoleKey,
      payload.messageSid
    );
    const jobStatus = mapTwilioToJobStatus(payload.messageStatus);

    for (const job of jobs) {
      if (!shouldAdvanceJobStatus(job.status, jobStatus)) {
        continue;
      }

      const patch: Record<string, string | null> = {
        status: jobStatus,
        last_status_at: statusTimestamp,
      };

      if (jobStatus === "failed") {
        const err = [payload.errorCode, payload.errorMessage]
          .filter(Boolean)
          .join(" ")
          .trim();
        if (err) {
          patch.last_error = err;
        }
      }

      await updateSmsOutboundJob(supabaseUrl, serviceRoleKey, job.id, patch);
    }

    logEvent({
      level: "info",
      event: "twilio.status_callback.processed",
      handler,
      request_id: requestId,
      message_sid: payload.messageSid,
      message_status: payload.messageStatus,
      status_code: 200,
      duration_ms: Date.now() - startedAt,
    });

    return new Response("OK", { status: 200 });
  } catch (error) {
    const err = error as Error;
    logEvent({
      level: "error",
      event: "twilio.status_callback.unhandled_error",
      handler,
      request_id: requestId,
      phase: "api_webhooks_twilio_status",
      error_name: err?.name ?? "Error",
      error_message: err?.message ?? "unknown",
      duration_ms: Date.now() - startedAt,
    });
    captureSentryException(error, {
      level: "error",
      event: "twilio.status_callback.unhandled_error",
      context: {
        category: "sms_outbound",
        correlation_id: requestId,
      },
      payload: {
        handler,
        request_id: requestId,
      },
    });
    return new Response("Internal error", { status: 500 });
  }
  });
}

function parsePayload(rawBody: string, params: URLSearchParams): StatusCallbackPayload {
  const messageSid =
    params.get("MessageSid")?.trim() ?? params.get("SmsSid")?.trim() ?? "";
  const messageStatus =
    params.get("MessageStatus")?.trim().toLowerCase() ??
    params.get("SmsStatus")?.trim().toLowerCase() ??
    "";

  return {
    messageSid,
    messageStatus,
    errorCode: params.get("ErrorCode")?.trim() ?? null,
    errorMessage: params.get("ErrorMessage")?.trim() ?? null,
    providerEventAt: parseProviderEventAt(params),
    payloadFingerprint: crypto.createHash("sha256").update(rawBody).digest("hex"),
  };
}

function parseProviderEventAt(params: URLSearchParams): string | null {
  const candidates = [
    params.get("Timestamp"),
    params.get("DateUpdated"),
    params.get("DateCreated"),
    params.get("DateSent"),
  ].filter((value): value is string => Boolean(value && value.trim()));

  for (const candidate of candidates) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return null;
}

function buildSignatureUrlCandidates(request: Request): string[] {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;

  const baseCandidates = new Set<string>();
  baseCandidates.add(url.toString());

  if (host) {
    const canonical = `${proto}://${host}${url.pathname}`;
    baseCandidates.add(canonical);
    baseCandidates.add(canonical.endsWith("/") ? canonical.slice(0, -1) : `${canonical}/`);
  }

  const configuredUrl = process.env.TWILIO_STATUS_CALLBACK_URL;
  if (configuredUrl) {
    baseCandidates.add(configuredUrl);
    baseCandidates.add(
      configuredUrl.endsWith("/") ? configuredUrl.slice(0, -1) : `${configuredUrl}/`
    );
  }

  return Array.from(baseCandidates);
}

function computeTwilioSignature(
  targetUrl: string,
  params: URLSearchParams,
  authToken: string
): string {
  const keys = Array.from(new Set(params.keys())).sort();
  let base = targetUrl;
  for (const key of keys) {
    for (const value of params.getAll(key)) {
      base += key + value;
    }
  }

  return crypto.createHmac("sha1", authToken).update(base).digest("base64");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function shouldAdvanceMessageStatus(
  currentStatus: string | null,
  nextStatus: string
): boolean {
  const current = normalizeStatus(currentStatus);
  const next = normalizeStatus(nextStatus) ?? "";

  if (!current) {
    return true;
  }
  if (current === next) {
    return true;
  }

  const currentTerminal = MESSAGE_TERMINAL_STATUSES.has(current);
  const nextTerminal = MESSAGE_TERMINAL_STATUSES.has(next);

  if (currentTerminal && nextTerminal) {
    return false;
  }
  if (currentTerminal && !nextTerminal) {
    return false;
  }
  if (!currentTerminal && nextTerminal) {
    return true;
  }

  return statusOrder(MESSAGE_STATUS_ORDER, next) >= statusOrder(MESSAGE_STATUS_ORDER, current);
}

function shouldAdvanceJobStatus(currentStatus: string | null, nextStatus: string): boolean {
  const current = normalizeStatus(currentStatus);
  const next = normalizeStatus(nextStatus) ?? "";

  if (!current) {
    return true;
  }
  if (current === next) {
    return true;
  }

  const currentTerminal = JOB_TERMINAL_STATUSES.has(current);
  const nextTerminal = JOB_TERMINAL_STATUSES.has(next);

  if (currentTerminal) {
    return false;
  }
  if (!currentTerminal && nextTerminal) {
    return true;
  }

  return statusOrder(JOB_STATUS_ORDER, next) >= statusOrder(JOB_STATUS_ORDER, current);
}

function mapTwilioToJobStatus(messageStatus: string): string {
  const status = normalizeStatus(messageStatus) ?? "sending";

  if (["failed", "undelivered"].includes(status)) {
    return "failed";
  }
  if (status === "canceled") {
    return "canceled";
  }
  if (["delivered", "sent", "queued", "accepted", "read"].includes(status)) {
    return "sent";
  }
  return "sending";
}

function normalizeStatus(status: string | null): string | null {
  if (!status) {
    return null;
  }
  return status.trim().toLowerCase();
}

function statusOrder(map: Record<string, number>, status: string | null): number {
  if (!status) {
    return 0;
  }
  return map[status] ?? 0;
}

async function fetchSmsMessageBySid(
  baseUrl: string,
  serviceRoleKey: string,
  messageSid: string
): Promise<SmsMessageRow | null> {
  const query = `${baseUrl}/rest/v1/sms_messages?select=id,status,last_status_at&twilio_message_sid=eq.${encodeURIComponent(
    messageSid
  )}&limit=1`;

  const response = await fetch(query, {
    headers: supabaseHeaders(serviceRoleKey),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch sms_messages (${response.status})`);
  }

  const rows = (await response.json()) as SmsMessageRow[];
  return rows[0] ?? null;
}

async function fetchOutboundJobsBySid(
  baseUrl: string,
  serviceRoleKey: string,
  messageSid: string
): Promise<SmsOutboundJobRow[]> {
  const query = `${baseUrl}/rest/v1/sms_outbound_jobs?select=id,status,last_status_at&twilio_message_sid=eq.${encodeURIComponent(
    messageSid
  )}`;

  const response = await fetch(query, {
    headers: supabaseHeaders(serviceRoleKey),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch sms_outbound_jobs (${response.status})`);
  }

  return (await response.json()) as SmsOutboundJobRow[];
}

async function insertStatusHistory(
  baseUrl: string,
  serviceRoleKey: string,
  row: Record<string, string | null>
): Promise<void> {
  const response = await fetch(
    `${baseUrl}/rest/v1/sms_status_callbacks?on_conflict=message_sid,message_status,payload_fingerprint`,
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(serviceRoleKey),
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify([row]),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to insert sms_status_callbacks (${response.status})`);
  }
}

async function updateSmsMessage(
  baseUrl: string,
  serviceRoleKey: string,
  messageId: string,
  patch: Record<string, string>
): Promise<void> {
  const response = await fetch(`${baseUrl}/rest/v1/sms_messages?id=eq.${messageId}`, {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(serviceRoleKey),
      "content-type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    throw new Error(`Failed to update sms_messages (${response.status})`);
  }
}

async function updateSmsOutboundJob(
  baseUrl: string,
  serviceRoleKey: string,
  jobId: string,
  patch: Record<string, string | null>
): Promise<void> {
  const response = await fetch(`${baseUrl}/rest/v1/sms_outbound_jobs?id=eq.${jobId}`, {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(serviceRoleKey),
      "content-type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    throw new Error(`Failed to update sms_outbound_jobs (${response.status})`);
  }
}

function supabaseHeaders(serviceRoleKey: string): HeadersInit {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}
