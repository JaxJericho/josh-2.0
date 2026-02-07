import crypto from "crypto";

function isSet(value) {
  return typeof value === "string" && value.length > 0;
}

function timingSafeEqual(a, b) {
  if (!isSet(a) || !isSet(b)) return false;
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!isSet(cronSecret)) {
    return res.status(500).json({ error: "Missing CRON_SECRET" });
  }

  const authHeader = req.headers.authorization || "";
  const expected = `Bearer ${cronSecret}`;
  if (!timingSafeEqual(authHeader, expected)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const runnerUrl = process.env.STAGING_RUNNER_URL || "";
  if (!isSet(runnerUrl)) {
    return res.status(500).json({ error: "Missing STAGING_RUNNER_URL" });
  }

  if (runnerUrl.includes("?")) {
    return res.status(400).json({ error: "Runner URL must not include query params" });
  }

  const runnerSecret = process.env.STAGING_RUNNER_SECRET || "";
  if (!isSet(runnerSecret)) {
    return res.status(500).json({ error: "Missing STAGING_RUNNER_SECRET" });
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(runnerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runner_secret: runnerSecret }),
    });
  } catch {
    return res.status(502).json({ error: "Failed to reach runner" });
  }

  const contentType = upstreamResponse.headers.get("content-type") || "text/plain";
  const bodyText = await upstreamResponse.text();
  res.setHeader("content-type", contentType);
  res.setHeader("cache-control", "no-store");
  return res.status(upstreamResponse.status).send(bodyText);
}
