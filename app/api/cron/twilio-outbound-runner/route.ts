import crypto from "crypto";
import * as Sentry from "@sentry/nextjs";
import {
  generateRequestId,
  isStaging,
  logEvent,
} from "../../../lib/observability";

type ErrorBody = { error: string };

function isSet(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (!isSet(a) || !isSet(b)) return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function jsonResponse(body: ErrorBody, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function handleCron(request: Request): Promise<Response> {
  const start = Date.now();
  const requestId = request.headers.get("x-request-id") ?? generateRequestId();
  const handler = "api/cron/twilio-outbound-runner";

  const cronSecret = process.env.CRON_SECRET;
  if (!isSet(cronSecret)) {
    logEvent({
      level: "error",
      event: "cron.missing_secret",
      handler,
      request_id: requestId,
    });
    return jsonResponse({ error: "Missing CRON_SECRET" }, 500);
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
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  if (isStaging() && request.headers.get("x-sentry-test") === "1") {
    const error = new Error("Sentry test event (staging only)");
    Sentry.captureException(error, {
      tags: { category: "sms_outbound" },
    });
    logEvent({
      level: "warn",
      event: "cron.sentry_test",
      handler,
      request_id: requestId,
    });
    return jsonResponse({ error: "Sentry test event sent" }, 500);
  }

  const runnerUrl = process.env.STAGING_RUNNER_URL;
  if (!isSet(runnerUrl)) {
    logEvent({
      level: "error",
      event: "cron.missing_runner_url",
      handler,
      request_id: requestId,
    });
    return jsonResponse({ error: "Missing STAGING_RUNNER_URL" }, 500);
  }

  if (runnerUrl.includes("?")) {
    logEvent({
      level: "warn",
      event: "cron.runner_url_invalid",
      handler,
      request_id: requestId,
    });
    return jsonResponse(
      { error: "Runner URL must not include query params" },
      400
    );
  }

  const runnerSecret = process.env.STAGING_RUNNER_SECRET;
  if (!isSet(runnerSecret)) {
    logEvent({
      level: "error",
      event: "cron.missing_runner_secret",
      handler,
      request_id: requestId,
    });
    return jsonResponse({ error: "Missing STAGING_RUNNER_SECRET" }, 500);
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
    return jsonResponse({ error: "Failed to reach runner" }, 502);
  }

  const contentType =
    upstreamResponse.headers.get("content-type") ?? "text/plain; charset=utf-8";
  const bodyText = await upstreamResponse.text();

  logEvent({
    level: "info",
    event: "cron.runner_response",
    handler,
    request_id: requestId,
    status_code: upstreamResponse.status,
    duration_ms: Date.now() - start,
  });

  return new Response(bodyText, {
    status: upstreamResponse.status,
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  return handleCron(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleCron(request);
}
