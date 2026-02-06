const SENSITIVE_HEADER_PATTERN = /token|secret|key|signature/i;
const EXPLICIT_SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
]);

Deno.serve(async (req) => {
  const timestamp = new Date().toISOString();
  const url = new URL(req.url);

  const bodyText = await req.text();
  const bodyBytes = new TextEncoder().encode(bodyText);
  const bodyLength = bodyBytes.length;

  const echoSecret = Deno.env.get("QSTASH_ECHO_SECRET");
  const querySecret = getQuerySecret(url);
  const bodySecret = parseEchoSecret(bodyText);
  const providedSecret = querySecret ?? bodySecret;

  if (
    !echoSecret ||
    !providedSecret ||
    !timingSafeEqual(providedSecret, echoSecret)
  ) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const headerKeysLower = Array.from(req.headers.keys()).map((key) =>
    key.toLowerCase()
  );
  const headersRedacted: Record<string, string> = {};
  for (const [key, value] of req.headers.entries()) {
    const lower = key.toLowerCase();
    headersRedacted[lower] = isSensitiveHeader(lower) ? "[redacted]" : value;
  }

  const bodySha256 = await sha256Hex(bodyBytes);
  const bodyPreview = echoSecret && bodyText.includes(echoSecret)
    ? "[redacted]"
    : bodyText.slice(0, 200);

  return jsonResponse({
    method: req.method,
    url: req.url,
    header_keys: headerKeysLower,
    headers_redacted: headersRedacted,
    content_length: req.headers.get("content-length"),
    content_type: req.headers.get("content-type"),
    body_is_empty: bodyLength === 0,
    body_length: bodyLength,
    body_sha256: bodySha256,
    body_preview: bodyPreview,
    timestamp,
  });
});

function parseEchoSecret(bodyText: string): string | null {
  if (!bodyText || bodyText.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(bodyText) as { echo_secret?: unknown };
    return typeof parsed.echo_secret === "string" ? parsed.echo_secret : null;
  } catch {
    return null;
  }
}

function getQuerySecret(url: URL): string | null {
  const rawSecret = getRawQueryParam(url.search, "secret") ??
    getRawQueryParam(url.search, "echo_secret");
  const fallbackSecret = url.searchParams.get("secret") ??
    url.searchParams.get("echo_secret");
  const value = rawSecret ?? fallbackSecret;
  if (!value || value.trim().length === 0) {
    return null;
  }
  return value;
}

function getRawQueryParam(search: string, key: string): string | null {
  if (!search || search.length <= 1) {
    return null;
  }
  const trimmed = search.startsWith("?") ? search.slice(1) : search;
  const pairs = trimmed.split("&");
  for (const pair of pairs) {
    if (!pair) {
      continue;
    }
    const [rawKey, ...rest] = pair.split("=");
    if (!rawKey) {
      continue;
    }
    try {
      if (decodeURIComponent(rawKey) !== key) {
        continue;
      }
    } catch {
      continue;
    }
    const rawValue = rest.join("=");
    if (rawValue.length === 0) {
      return "";
    }
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

function isSensitiveHeader(name: string): boolean {
  if (EXPLICIT_SENSITIVE_HEADERS.has(name)) {
    return true;
  }
  return SENSITIVE_HEADER_PATTERN.test(name);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hashBytes = new Uint8Array(digest);
  let hex = "";
  for (const value of hashBytes) {
    hex += value.toString(16).padStart(2, "0");
  }
  return hex;
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

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
