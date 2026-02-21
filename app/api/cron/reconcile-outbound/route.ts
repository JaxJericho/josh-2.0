import crypto from "crypto";
import { createNodeEnvReader, createTwilioClientFromEnv } from "../../../../packages/messaging/src/client";
import { generateRequestId, logEvent } from "../../../lib/observability";

type Summary = {
  ok: boolean;
  checked: number;
  updated: number;
  skipped: number;
  failed: number;
};

type SmsMessageCandidate = {
  id: string;
  twilio_message_sid: string | null;
  status: string | null;
  last_status_at: string | null;
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const DEFAULT_STALE_MINUTES = 15;
const MESSAGE_TERMINAL_STATUSES = new Set([
  "delivered",
  "undelivered",
  "failed",
  "canceled",
  "read",
]);

function isSet(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function normalizeStatus(status: string | null): string | null {
  if (!status) return null;
  return status.trim().toLowerCase();
}

function timingSafeEqual(a: string, b: string): boolean {
  if (!isSet(a) || !isSet(b)) return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function jsonResponse(body: unknown, status: number, requestId?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(requestId ? { "x-request-id": requestId } : {}),
    },
  });
}

function emptySummary(ok: boolean): Summary {
  return { ok, checked: 0, updated: 0, skipped: 0, failed: 0 };
}

function clampLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

function clampMinutes(raw: string | null): number {
  if (!raw) return DEFAULT_STALE_MINUTES;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return DEFAULT_STALE_MINUTES;
  return Math.max(1, Math.min(24 * 60, parsed));
}

function parseIsoOrNull(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shouldSkipTerminal(currentStatus: string | null): boolean {
  const status = normalizeStatus(currentStatus);
  return Boolean(status && MESSAGE_TERMINAL_STATUSES.has(status));
}

function shouldUpdateFromTwilio(input: {
  currentStatus: string | null;
  currentLastStatusAt: string | null;
  nextStatus: string | null;
  nextLastStatusAt: string;
}): boolean {
  const current = normalizeStatus(input.currentStatus);
  const next = normalizeStatus(input.nextStatus);
  if (!next) return false;

  if (current !== next) return true;

  const currentAt = parseIsoOrNull(input.currentLastStatusAt);
  const nextAt = parseIsoOrNull(input.nextLastStatusAt);

  if (!currentAt) return true;
  if (!nextAt) return false;
  return nextAt.getTime() > currentAt.getTime();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function supabaseHeaders(serviceRoleKey: string): HeadersInit {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
  };
}

function parseTwilioEventAt(payload: Record<string, unknown>): string | null {
  const candidates = [
    payload.date_updated,
    payload.date_sent,
    payload.date_created,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const candidate of candidates) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return null;
}

function mapTwilioToJobStatus(messageStatus: string): string {
  const status = normalizeStatus(messageStatus) ?? "sending";
  if (["failed", "undelivered"].includes(status)) return "failed";
  if (status === "canceled") return "canceled";
  if (["delivered", "sent", "queued", "accepted", "read"].includes(status)) return "sent";
  return "sending";
}

async function fetchCandidates(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  thresholdIso: string;
  limit: number;
}): Promise<SmsMessageCandidate[]> {
  // Pull stale-ish rows and filter terminal statuses in code. This avoids brittle REST "not.in" queries.
  const query = `${input.supabaseUrl}/rest/v1/sms_messages?select=id,twilio_message_sid,status,last_status_at&direction=eq.out&twilio_message_sid=not.is.null&or=(last_status_at.is.null,last_status_at.lt.${encodeURIComponent(
    input.thresholdIso
  )})&order=last_status_at.asc.nullsfirst&limit=${input.limit}`;

  const response = await fetch(query, { headers: supabaseHeaders(input.serviceRoleKey) });
  if (!response.ok) {
    throw new Error(`Failed to fetch candidates (status=${response.status})`);
  }

  return (await response.json()) as SmsMessageCandidate[];
}

async function patchSmsMessage(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  messageId: string;
  status: string;
  lastStatusAt: string;
}): Promise<void> {
  const response = await fetch(
    `${input.supabaseUrl}/rest/v1/sms_messages?id=eq.${encodeURIComponent(input.messageId)}`,
    {
      method: "PATCH",
      headers: {
        ...supabaseHeaders(input.serviceRoleKey),
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        status: input.status,
        last_status_at: input.lastStatusAt,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to update sms_messages (status=${response.status})`);
  }
}

async function patchOutboundJobsBySid(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  messageSid: string;
  jobStatus: string;
  lastStatusAt: string;
  lastError: string | null;
}): Promise<void> {
  const patch: Record<string, string | null> = {
    status: input.jobStatus,
    last_status_at: input.lastStatusAt,
  };

  if (input.jobStatus === "failed" && input.lastError) {
    patch.last_error = input.lastError;
  }

  const response = await fetch(
    `${input.supabaseUrl}/rest/v1/sms_outbound_jobs?twilio_message_sid=eq.${encodeURIComponent(
      input.messageSid
    )}`,
    {
      method: "PATCH",
      headers: {
        ...supabaseHeaders(input.serviceRoleKey),
        Prefer: "return=minimal",
      },
      body: JSON.stringify(patch),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to update sms_outbound_jobs (status=${response.status})`);
  }
}

async function handle(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const requestId = request.headers.get("x-request-id") ?? generateRequestId();
  const handler = "api/cron/reconcile-outbound";

  const cronSecret = process.env.CRON_SECRET;
  if (!isSet(cronSecret)) {
    logEvent({ level: "error", event: "cron.missing_secret", handler, request_id: requestId });
    return jsonResponse(emptySummary(false), 500, requestId);
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;
  if (!timingSafeEqual(authHeader, expected)) {
    logEvent({ level: "warn", event: "cron.unauthorized", handler, request_id: requestId });
    return jsonResponse(emptySummary(false), 401, requestId);
  }

  const url = new URL(request.url);
  const limit = clampLimit(url.searchParams.get("limit"));
  const staleMinutes = clampMinutes(url.searchParams.get("stale_minutes"));
  const thresholdIso = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();

  let summary: Summary = { ok: true, checked: 0, updated: 0, skipped: 0, failed: 0 };

  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const twilio = createTwilioClientFromEnv({
      getEnv: createNodeEnvReader(),
      requireSenderIdentity: false,
    });

    logEvent({
      level: "info",
      event: "reconcile.invoked",
      handler,
      request_id: requestId,
      limit,
      stale_minutes: staleMinutes,
    });

    const candidates = await fetchCandidates({
      supabaseUrl,
      serviceRoleKey,
      thresholdIso,
      limit,
    });

    for (const row of candidates) {
      summary.checked += 1;

      const messageSid = row.twilio_message_sid;
      if (!messageSid) {
        summary.skipped += 1;
        continue;
      }

      if (shouldSkipTerminal(row.status)) {
        summary.skipped += 1;
        continue;
      }

      let payload: Record<string, unknown>;
      try {
        payload = await twilio.client.fetchMessageBySid(messageSid);
      } catch (error) {
        const err = error as Error;
        summary.failed += 1;
        logEvent({
          level: "warn",
          event: "reconcile.twilio_fetch_failed",
          handler,
          request_id: requestId,
          message_sid: messageSid,
          error_message: err?.message ?? "unknown",
        });
        continue;
      }

      const nextStatusRaw = typeof payload.status === "string" ? payload.status : null;
      const nextStatus = normalizeStatus(nextStatusRaw);
      if (!nextStatus) {
        summary.failed += 1;
        logEvent({
          level: "warn",
          event: "reconcile.twilio_missing_status",
          handler,
          request_id: requestId,
          message_sid: messageSid,
        });
        continue;
      }

      const providerEventAt = parseTwilioEventAt(payload) ?? new Date().toISOString();

      const shouldUpdate = shouldUpdateFromTwilio({
        currentStatus: row.status,
        currentLastStatusAt: row.last_status_at,
        nextStatus,
        nextLastStatusAt: providerEventAt,
      });

      if (!shouldUpdate) {
        summary.skipped += 1;
        continue;
      }

      try {
        await patchSmsMessage({
          supabaseUrl,
          serviceRoleKey,
          messageId: row.id,
          status: nextStatus,
          lastStatusAt: providerEventAt,
        });

        const jobStatus = mapTwilioToJobStatus(nextStatus);
        const errorCode = typeof payload.error_code === "number" ? String(payload.error_code) : null;
        const errorMessage = typeof payload.error_message === "string" ? payload.error_message : null;
        const lastError =
          jobStatus === "failed"
            ? [errorCode, errorMessage].filter(Boolean).join(" ").trim() || null
            : null;

        await patchOutboundJobsBySid({
          supabaseUrl,
          serviceRoleKey,
          messageSid,
          jobStatus,
          lastStatusAt: providerEventAt,
          lastError,
        });

        summary.updated += 1;
      } catch (error) {
        const err = error as Error;
        summary.failed += 1;
        logEvent({
          level: "warn",
          event: "reconcile.db_update_failed",
          handler,
          request_id: requestId,
          message_sid: messageSid,
          error_message: err?.message ?? "unknown",
        });
      }
    }

    logEvent({
      level: "info",
      event: "reconcile.summary",
      handler,
      request_id: requestId,
      checked: summary.checked,
      updated: summary.updated,
      skipped: summary.skipped,
      failed: summary.failed,
      duration_ms: Date.now() - startedAt,
    });

    return jsonResponse(summary, 200, requestId);
  } catch (error) {
    const err = error as Error;
    summary = { ...emptySummary(false), failed: 1 };
    logEvent({
      level: "error",
      event: "reconcile.unhandled_error",
      handler,
      request_id: requestId,
      error_message: err?.message ?? "unknown",
      duration_ms: Date.now() - startedAt,
    });
    return jsonResponse(summary, 500, requestId);
  }
}

export async function GET(request: Request): Promise<Response> {
  // Vercel Cron uses GET for scheduled invocations. Manual tests should use POST.
  const userAgent = request.headers.get("user-agent") ?? "";
  const vercelCron = request.headers.get("x-vercel-cron") ?? "";
  const isCronRequest = userAgent.startsWith("vercel-cron/") || vercelCron === "1";

  if (!isCronRequest) {
    const requestId = request.headers.get("x-request-id") ?? generateRequestId();
    return jsonResponse(emptySummary(false), 405, requestId);
  }

  return handle(request);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}
