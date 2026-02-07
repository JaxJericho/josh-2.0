import crypto from "crypto";

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
  const cronSecret = process.env.CRON_SECRET;
  if (!isSet(cronSecret)) {
    return jsonResponse({ error: "Missing CRON_SECRET" }, 500);
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;
  if (!timingSafeEqual(authHeader, expected)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const runnerUrl = process.env.STAGING_RUNNER_URL;
  if (!isSet(runnerUrl)) {
    return jsonResponse({ error: "Missing STAGING_RUNNER_URL" }, 500);
  }

  if (runnerUrl.includes("?")) {
    return jsonResponse(
      { error: "Runner URL must not include query params" },
      400
    );
  }

  const runnerSecret = process.env.STAGING_RUNNER_SECRET;
  if (!isSet(runnerSecret)) {
    return jsonResponse({ error: "Missing STAGING_RUNNER_SECRET" }, 500);
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(runnerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runner_secret: runnerSecret }),
    });
  } catch {
    return jsonResponse({ error: "Failed to reach runner" }, 502);
  }

  const contentType =
    upstreamResponse.headers.get("content-type") ?? "text/plain; charset=utf-8";
  const bodyText = await upstreamResponse.text();

  return new Response(bodyText, {
    status: upstreamResponse.status,
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  return handleCron(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleCron(request);
}
