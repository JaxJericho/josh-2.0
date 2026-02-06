import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";

type Command = "STOP" | "HELP" | "NONE";

const STOP_KEYWORDS = new Set(["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

const STOP_REPLY = "You are opted out of JOSH SMS. Reply START to resubscribe.";
const HELP_REPLY = "JOSH help: Reply STOP to opt out. Reply START to resubscribe.";

const encoder = new TextEncoder();

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
      return new Response("Unsupported Media Type", { status: 415 });
    }

    const rawBody = await req.text();
    const params = new URLSearchParams(rawBody);

    const signature = req.headers.get("x-twilio-signature");
    if (!signature) {
      return new Response("Unauthorized", { status: 401 });
    }

    const authToken = requireEnv("TWILIO_AUTH_TOKEN");
    const signatureUrls = buildSignatureUrls(req);
    const isValidSignature = await verifySignature(
      authToken,
      signature,
      signatureUrls,
      params
    );

    if (!isValidSignature) {
      return new Response("Forbidden", { status: 403 });
    }

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

    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const encryptionKey = requireEnv("SMS_BODY_ENCRYPTION_KEY");

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("phone_e164", fromE164)
      .maybeSingle();

    if (userError) {
      return new Response("Server Error", { status: 500 });
    }

    const mediaCount = parseMediaCount(params.get("NumMedia"));
    const encryptedBody = await encryptBody(supabase, bodyRaw, encryptionKey);

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
        return deterministicResponse(command);
      }
      return new Response("Server Error", { status: 500 });
    }

    const isDuplicate = !insertedRows || insertedRows.length === 0;
    if (isDuplicate) {
      return deterministicResponse(command);
    }

    if (command === "STOP") {
      const optOutError = await recordOptOut(supabase, user?.id ?? null, fromE164);
      if (optOutError) {
        return new Response("Server Error", { status: 500 });
      }

      return twimlResponse(STOP_REPLY);
    }

    if (command === "HELP") {
      return twimlResponse(HELP_REPLY);
    }

    return twimlResponse();
  } catch (error) {
    console.error("twilio-inbound error", error);
    return new Response("Server Error", { status: 500 });
  }
});

function buildSignatureUrls(req: Request): string[] {
  const url = new URL(req.url);
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedPort = req.headers.get("x-forwarded-port");

  const candidates = new Set<string>();

  if (forwardedHost) {
    const proto = forwardedProto ?? "https";
    const host = forwardedPort && !forwardedHost.includes(":")
      ? `${forwardedHost}:${forwardedPort}`
      : forwardedHost;
    candidates.add(`${proto}://${host}${url.pathname}${url.search}`);

    if (!url.pathname.startsWith("/functions/v1/")) {
      candidates.add(`${proto}://${host}/functions/v1${url.pathname}${url.search}`);
    }
  }

  const host = req.headers.get("host");
  if (host && forwardedProto) {
    candidates.add(`${forwardedProto}://${host}${url.pathname}${url.search}`);
  }

  candidates.add(url.toString());

  return Array.from(candidates);
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

async function verifySignature(
  token: string,
  signature: string,
  urls: string[],
  params: URLSearchParams
): Promise<boolean> {
  for (const url of urls) {
    const baseString = buildSignatureBase(url, params);
    const expectedSignature = await computeSignature(token, baseString);
    if (timingSafeEqual(signature, expectedSignature)) {
      return true;
    }
  }
  return false;
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
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>,
  userId: string | null,
  phoneE164: string
): Promise<Error | null> {
  if (userId) {
    const { error } = await supabase
      .from("users")
      .update({ sms_consent: false })
      .eq("id", userId);
    return error ?? null;
  }

  const { error } = await supabase
    .from("sms_opt_outs")
    .upsert(
      {
        phone_e164: phoneE164,
        opted_out_at: new Date().toISOString(),
      },
      { onConflict: "phone_e164", ignoreDuplicates: false }
    );

  return error ?? null;
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
