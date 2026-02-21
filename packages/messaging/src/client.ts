const DEFAULT_TIMEOUT_MS = 6000;

export type EnvReader = (name: string) => string | undefined;

export type TwilioClientConfig = {
  accountSid: string;
  authToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type TwilioMessageSendInput = {
  to: string;
  body: string;
  idempotencyKey: string;
  from?: string | null;
  messagingServiceSid?: string | null;
  statusCallbackUrl?: string | null;
};

export type TwilioMessageSendResult = {
  sid: string;
  status: string | null;
  from: string | null;
};

export type TwilioEnvClient = {
  client: TwilioClient;
  senderIdentity: {
    from: string | null;
    messagingServiceSid: string | null;
  };
  statusCallbackUrl: string | null;
};

export type TwilioClient = {
  sendMessage: (input: TwilioMessageSendInput) => Promise<TwilioMessageSendResult>;
  fetchMessageBySid: (messageSid: string) => Promise<Record<string, unknown>>;
};

export class TwilioClientError extends Error {
  readonly code: "CONFIG" | "AUTH" | "REQUEST" | "TIMEOUT" | "RESPONSE";
  readonly statusCode: number | null;
  readonly retryable: boolean;

  constructor(input: {
    code: "CONFIG" | "AUTH" | "REQUEST" | "TIMEOUT" | "RESPONSE";
    message: string;
    statusCode?: number | null;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "TwilioClientError";
    this.code = input.code;
    this.statusCode = input.statusCode ?? null;
    this.retryable = Boolean(input.retryable);
  }
}

export function createTwilioClient(config: TwilioClientConfig): TwilioClient {
  const accountSid = normalizeRequiredString("TWILIO_ACCOUNT_SID", config.accountSid);
  const authToken = normalizeRequiredString("TWILIO_AUTH_TOKEN", config.authToken);

  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TwilioClientError({
      code: "CONFIG",
      message: "Fetch implementation is required to create Twilio client.",
      retryable: false,
    });
  }

  const timeoutMs = Number.isFinite(config.timeoutMs)
    ? Math.max(1, Math.trunc(config.timeoutMs as number))
    : DEFAULT_TIMEOUT_MS;

  return {
    sendMessage: async (input) => {
      const to = normalizeRequiredString("to", input.to);
      const body = normalizeRequiredString("body", input.body);
      const idempotencyKey = normalizeRequiredString("idempotencyKey", input.idempotencyKey);
      const from = normalizeOptionalString(input.from);
      const messagingServiceSid = normalizeOptionalString(input.messagingServiceSid);

      if (!from && !messagingServiceSid) {
        throw new TwilioClientError({
          code: "CONFIG",
          message: "Twilio sender identity is required (from or messagingServiceSid).",
          retryable: false,
        });
      }

      if (messagingServiceSid && !messagingServiceSid.startsWith("MG")) {
        throw new TwilioClientError({
          code: "CONFIG",
          message: "TWILIO_MESSAGING_SERVICE_SID must start with 'MG'.",
          retryable: false,
        });
      }

      const payload = new URLSearchParams();
      payload.set("To", to);
      payload.set("Body", body);

      if (messagingServiceSid) {
        payload.set("MessagingServiceSid", messagingServiceSid);
      } else if (from) {
        payload.set("From", from);
      }

      const statusCallbackUrl = normalizeOptionalString(input.statusCallbackUrl);
      if (statusCallbackUrl) {
        payload.set("StatusCallback", statusCallbackUrl);
      }

      const response = await fetchWithTimeout(
        fetchImpl,
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${base64Encode(`${accountSid}:${authToken}`)}`,
            "Idempotency-Key": idempotencyKey,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: payload.toString(),
        },
        timeoutMs,
      );

      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw buildTwilioResponseError(response.status, json);
      }

      const sid = readString(json, "sid");
      if (!sid) {
        throw new TwilioClientError({
          code: "RESPONSE",
          message: "Twilio response missing message SID.",
          retryable: false,
        });
      }

      return {
        sid,
        status: readString(json, "status"),
        from: readString(json, "from"),
      };
    },

    fetchMessageBySid: async (messageSid: string) => {
      const sid = normalizeRequiredString("messageSid", messageSid);

      const response = await fetchWithTimeout(
        fetchImpl,
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages/${encodeURIComponent(sid)}.json`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${base64Encode(`${accountSid}:${authToken}`)}`,
          },
        },
        timeoutMs,
      );

      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw buildTwilioResponseError(response.status, json);
      }

      if (!json || typeof json !== "object") {
        throw new TwilioClientError({
          code: "RESPONSE",
          message: "Twilio message fetch returned an invalid payload.",
          retryable: false,
        });
      }

      return json as Record<string, unknown>;
    },
  };
}

export function createTwilioClientFromEnv(input: {
  getEnv: EnvReader;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  requireSenderIdentity?: boolean;
}): TwilioEnvClient {
  if (typeof input.getEnv !== "function") {
    throw new TwilioClientError({
      code: "CONFIG",
      message: "getEnv must be provided to create Twilio client from env.",
      retryable: false,
    });
  }

  const accountSid = readRequiredEnv(input.getEnv, "TWILIO_ACCOUNT_SID");
  const authToken = readRequiredEnv(input.getEnv, "TWILIO_AUTH_TOKEN");
  const messagingServiceSid = readOptionalEnv(input.getEnv, "TWILIO_MESSAGING_SERVICE_SID");
  const from = readOptionalEnv(input.getEnv, "TWILIO_FROM_NUMBER");
  const requireSenderIdentity = input.requireSenderIdentity ?? true;

  if (requireSenderIdentity && !from && !messagingServiceSid) {
    throw new TwilioClientError({
      code: "CONFIG",
      message: "Configure TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID.",
      retryable: false,
    });
  }

  if (from && !from.startsWith("+")) {
    throw new TwilioClientError({
      code: "CONFIG",
      message: "TWILIO_FROM_NUMBER must be an E.164 phone number.",
      retryable: false,
    });
  }

  if (messagingServiceSid && !messagingServiceSid.startsWith("MG")) {
    throw new TwilioClientError({
      code: "CONFIG",
      message: "TWILIO_MESSAGING_SERVICE_SID must start with 'MG'.",
      retryable: false,
    });
  }

  return {
    client: createTwilioClient({
      accountSid,
      authToken,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs,
    }),
    senderIdentity: {
      from,
      messagingServiceSid,
    },
    statusCallbackUrl: resolveTwilioStatusCallbackUrl({
      explicitUrl: readOptionalEnv(input.getEnv, "TWILIO_STATUS_CALLBACK_URL"),
      projectRef: readOptionalEnv(input.getEnv, "PROJECT_REF"),
    }),
  };
}

export function resolveTwilioRuntimeFromEnv(input: {
  getEnv: EnvReader;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  requireSenderIdentity?: boolean;
}): TwilioEnvClient {
  return createTwilioClientFromEnv(input);
}

export function createNodeEnvReader(
  env: Record<string, string | undefined> = process.env,
): EnvReader {
  return (name) => normalizeOptionalString(env[name]) ?? undefined;
}

export function resolveTwilioStatusCallbackUrl(input: {
  explicitUrl: string | null;
  projectRef: string | null;
}): string | null {
  if (input.explicitUrl) {
    return input.explicitUrl;
  }

  if (!input.projectRef) {
    return null;
  }

  return `https://${input.projectRef}.supabase.co/functions/v1/twilio-status-callback`;
}

export function isTransientTwilioError(error: unknown): boolean {
  if (error instanceof TwilioClientError) {
    return error.retryable;
  }
  return false;
}

export function getTwilioErrorStatusCode(error: unknown): number | null {
  if (error instanceof TwilioClientError) {
    return error.statusCode;
  }
  return null;
}

function normalizeRequiredString(name: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TwilioClientError({
      code: "CONFIG",
      message: `${name} is required.`,
      retryable: false,
    });
  }
  return normalized;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort("twilio_timeout");
  }, timeoutMs);

  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new TwilioClientError({
        code: "TIMEOUT",
        message: "Twilio request timed out.",
        retryable: true,
      });
    }

    throw new TwilioClientError({
      code: "REQUEST",
      message: "Twilio request failed.",
      retryable: true,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildTwilioResponseError(statusCode: number, payload: unknown): TwilioClientError {
  const errorCode = readString(payload, "code");
  const errorMessage = readString(payload, "message") ?? "Twilio API request failed.";
  return new TwilioClientError({
    code: "RESPONSE",
    message: errorCode ? `${errorMessage} (code=${errorCode})` : errorMessage,
    statusCode,
    retryable: statusCode >= 500 && statusCode < 600,
  });
}

function readString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readRequiredEnv(getEnv: EnvReader, name: string): string {
  const value = readOptionalEnv(getEnv, name);
  if (!value) {
    throw new TwilioClientError({
      code: "CONFIG",
      message: `Missing required env var: ${name}`,
      retryable: false,
    });
  }
  return value;
}

function readOptionalEnv(getEnv: EnvReader, name: string): string | null {
  return normalizeOptionalString(getEnv(name));
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { name?: string; message?: string };
  return candidate.name === "AbortError" || candidate.message === "The operation was aborted.";
}

function base64Encode(input: string): string {
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(input);
  }

  // Node fallback when btoa is not available.
  return Buffer.from(input).toString("base64");
}
