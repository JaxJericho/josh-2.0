import crypto from "crypto";
import * as Sentry from "@sentry/nextjs";
import {
  generateRequestId,
  isStaging,
  logEvent,
} from "../../../lib/observability";

type Summary = {
  ok: boolean;
  runner_status: number;
  processed: number;
  sent: number;
  failed: number;
};

function isSet(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (!isSet(a) || !isSet(b)) return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function jsonResponse(
  body: unknown,
  status: number,
  requestId?: string
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(requestId ? { "x-request-id": requestId } : {}),
    },
  });
}

function summaryResponse(
  summary: Summary,
  status: number,
  requestId: string
): Response {
  return jsonResponse(summary, status, requestId);
}

function errorSummary(status: number): Summary {
  return { ok: false, runner_status: status, processed: 0, sent: 0, failed: 0 };
}

function clampNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

async function handleCron(request: Request): Promise<Response> {
  const start = Date.now();
  const requestId = request.headers.get("x-request-id") ?? generateRequestId();
  const handler = "api/cron/run-outbound";

  logEvent({
    level: "info",
    event: "cron.invoked",
    handler,
    request_id: requestId,
    method: request.method,
  });

  const cronSecret = process.env.CRON_SECRET;
  if (!isSet(cronSecret)) {
    logEvent({
      level: "error",
      event: "cron.missing_secret",
      handler,
      request_id: requestId,
    });
    return summaryResponse(errorSummary(500), 500, requestId);
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;
  if (!timingSafeEqual(authHeader, expected)) {
    logEvent({
      level: "warn",
      event: "cron.unauthorized",
      handler,
      request_id: requestId,
    });
    return summaryResponse(errorSummary(401), 401, requestId);
  }

  // Optional Vercel Cron marker header: don't rely on it for security, but validate if present.
  const vercelCron = request.headers.get("x-vercel-cron");
  if (vercelCron !== null && vercelCron !== "1") {
    logEvent({
      level: "warn",
      event: "cron.invalid_vercel_header",
      handler,
      request_id: requestId,
    });
    return summaryResponse(errorSummary(401), 401, requestId);
  }

  if (isStaging() && request.headers.get("x-sentry-test") === "1") {
    const error = new Error("Sentry test event (staging only)");
    Sentry.captureException(error, { tags: { category: "sms_outbound" } });
    logEvent({
      level: "warn",
      event: "cron.sentry_test",
      handler,
      request_id: requestId,
    });
    return summaryResponse(errorSummary(500), 500, requestId);
  }

  const runnerUrl = process.env.STAGING_RUNNER_URL;
  if (!isSet(runnerUrl)) {
    logEvent({
      level: "error",
      event: "cron.missing_runner_url",
      handler,
      request_id: requestId,
    });
    return summaryResponse(errorSummary(500), 500, requestId);
  }

  if (runnerUrl.includes("?")) {
    logEvent({
      level: "warn",
      event: "cron.runner_url_invalid",
      handler,
      request_id: requestId,
    });
    return summaryResponse(errorSummary(400), 400, requestId);
  }

  const runnerSecret = process.env.STAGING_RUNNER_SECRET;
  if (!isSet(runnerSecret)) {
    logEvent({
      level: "error",
      event: "cron.missing_runner_secret",
      handler,
      request_id: requestId,
    });
    return summaryResponse(errorSummary(500), 500, requestId);
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(runnerUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-runner-secret": runnerSecret,
      },
      body: "{}",
    });
  } catch {
    logEvent({
      level: "error",
      event: "cron.runner_unreachable",
      handler,
      request_id: requestId,
    });
    Sentry.captureException(new Error("Failed to reach runner"), {
      tags: { category: "sms_outbound" },
    });

    return summaryResponse(errorSummary(502), 502, requestId);
  }

  const upstreamStatus = upstreamResponse.status;
  const upstreamText = await upstreamResponse.text();
  const upstreamJson = (() => {
    try {
      return JSON.parse(upstreamText) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  const processed = clampNonNegativeInt(upstreamJson?.processed);
  const sent = clampNonNegativeInt(upstreamJson?.sent);
  const failed = clampNonNegativeInt(upstreamJson?.failed);
  const upstreamOk = upstreamResponse.ok && upstreamJson?.ok === true;

  const summary: Summary = {
    ok: upstreamOk,
    runner_status: upstreamStatus,
    processed,
    sent,
    failed,
  };

  logEvent({
    level: upstreamResponse.ok ? "info" : "warn",
    event: "cron.runner_summary",
    handler,
    request_id: requestId,
    status_code: upstreamStatus,
    processed,
    sent,
    failed,
    duration_ms: Date.now() - start,
  });

  // Preserve non-200 semantics: if the runner returns non-200, so do we.
  return summaryResponse(summary, upstreamStatus, requestId);
}

export async function GET(request: Request): Promise<Response> {
  // Vercel Cron uses GET for scheduled invocations. Manual testing should use POST.
  const userAgent = request.headers.get("user-agent") ?? "";
  const vercelCron = request.headers.get("x-vercel-cron") ?? "";
  const isCronRequest =
    userAgent.startsWith("vercel-cron/") || vercelCron === "1";

  if (!isCronRequest) {
    const requestId = request.headers.get("x-request-id") ?? generateRequestId();
    return summaryResponse(errorSummary(405), 405, requestId);
  }

  return handleCron(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleCron(request);
}
