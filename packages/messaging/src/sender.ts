import {
  getTwilioErrorStatusCode,
  isTransientTwilioError,
} from "./client.ts";
import type {
  SendSmsRequest,
  SendSmsResult,
  SmsDbClient,
  SmsMessagePersistence,
} from "./types.ts";

type QueryError = {
  code?: string;
  message?: string;
};

type QueryResult<T> = {
  data: T | null;
  error: QueryError | null;
};

type SmsMessagesQuery = {
  select: (columns: string) => SmsMessagesQuery;
  eq: (column: string, value: unknown) => SmsMessagesQuery;
  not: (column: string, operator: string, value: unknown) => SmsMessagesQuery;
  is: (column: string, value: null) => SmsMessagesQuery;
  order: (column: string, options: { ascending: boolean }) => SmsMessagesQuery;
  limit: (count: number) => SmsMessagesQuery;
  maybeSingle: () => Promise<QueryResult<Record<string, unknown>>>;
  single: () => Promise<QueryResult<Record<string, unknown>>>;
  insert: (payload: Record<string, unknown>) => SmsMessagesQuery;
  update: (payload: Record<string, unknown>) => SmsMessagesQuery;
};

const LEGACY_REGION_LAUNCH_NOTIFY_PURPOSE = "region_launch_notify";
const LEGACY_REGION_LAUNCH_NOTIFY_IDEMPOTENCY_PREFIX = "region_launch_notify:";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SendSmsError extends Error {
  readonly correlationId: string;
  readonly purpose: string;
  readonly idempotencyKey: string;
  readonly statusCode: number | null;
  readonly retryable: boolean;

  constructor(input: {
    message: string;
    correlationId: string;
    purpose: string;
    idempotencyKey: string;
    statusCode: number | null;
    retryable: boolean;
  }) {
    super(input.message);
    this.name = "SendSmsError";
    this.correlationId = input.correlationId;
    this.purpose = input.purpose;
    this.idempotencyKey = input.idempotencyKey;
    this.statusCode = input.statusCode;
    this.retryable = input.retryable;
  }
}

export async function sendSms(request: SendSmsRequest): Promise<SendSmsResult> {
  validateSendRequest(request);
  const normalizedFrom = normalizeOptionalString(request.from);
  const normalizedMessagingServiceSid = normalizeOptionalString(request.messagingServiceSid);
  const persistenceFromE164 = resolvePersistenceFromSenderIdentity(
    normalizedFrom,
    normalizedMessagingServiceSid,
  );
  const persistenceCorrelationId = normalizeIdempotencyKeyForSmsCorrelation(
    request.idempotencyKey,
  );

  const log = request.logger ?? noopLogger;
  const now = request.now ?? (() => new Date());
  const persistence = resolvePersistence(request);

  const existingDelivery = await persistence.findDeliveredByIdempotencyKey(persistenceCorrelationId);
  if (existingDelivery) {
    return {
      messageId: existingDelivery.messageId,
      twilioMessageSid: existingDelivery.twilioMessageSid,
      status: existingDelivery.status ?? "queued",
      fromE164: existingDelivery.fromE164,
      deduplicated: true,
      attempts: 0,
    };
  }

  let pendingMessage = await persistence.findPendingByIdempotencyKey(persistenceCorrelationId);
  if (!pendingMessage) {
    pendingMessage = await persistence.insertPending({
      userId: request.userId ?? null,
      profileId: request.profileId ?? null,
      fromE164: persistenceFromE164,
      toE164: request.to,
      idempotencyKey: persistenceCorrelationId,
      bodyCiphertext: request.bodyCiphertext ?? null,
      bodyIv: request.bodyIv ?? null,
      bodyTag: request.bodyTag ?? null,
      keyVersion: request.keyVersion ?? 1,
      mediaCount: request.mediaCount ?? 0,
      status: "queued",
      createdAtIso: now().toISOString(),
    });
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const sent = await request.client.sendMessage({
        to: request.to,
        body: request.body,
        idempotencyKey: request.idempotencyKey,
        from: normalizedFrom,
        messagingServiceSid: normalizedMessagingServiceSid,
        statusCallbackUrl: request.statusCallbackUrl ?? null,
      });

      const resolvedFromE164 = sent.from ?? persistenceFromE164;
      const status = sent.status ?? "queued";

      await persistence.finalizeSent({
        messageId: pendingMessage.messageId,
        fromE164: resolvedFromE164,
        twilioMessageSid: sent.sid,
        status,
        finalizedAtIso: now().toISOString(),
      });

      return {
        messageId: pendingMessage.messageId,
        twilioMessageSid: sent.sid,
        status,
        fromE164: resolvedFromE164,
        deduplicated: false,
        attempts: attempt,
      };
    } catch (error) {
      const statusCode = getTwilioErrorStatusCode(error);
      const retryable = isTransientTwilioError(error);
      const is4xx = statusCode !== null && statusCode >= 400 && statusCode < 500;

      if (is4xx) {
        log("warn", "messaging.send.non_retryable_4xx", {
          correlation_id: request.correlationId,
          purpose: request.purpose,
          idempotency_key: request.idempotencyKey,
          status_code: statusCode,
        });
      }

      if (retryable && attempt < 2) {
        log("info", "messaging.send.retrying_once", {
          correlation_id: request.correlationId,
          purpose: request.purpose,
          idempotency_key: request.idempotencyKey,
          attempt,
          status_code: statusCode,
        });
        continue;
      }

      throw toSendSmsError({
        error,
        correlationId: request.correlationId,
        purpose: request.purpose,
        idempotencyKey: request.idempotencyKey,
        statusCode,
        retryable,
      });
    }
  }

  throw new SendSmsError({
    message: "SMS send failed after retry policy exhausted.",
    correlationId: request.correlationId,
    purpose: request.purpose,
    idempotencyKey: request.idempotencyKey,
    statusCode: null,
    retryable: false,
  });
}

export function createSupabaseSmsMessagePersistence(db: SmsDbClient): SmsMessagePersistence {
  return {
    findDeliveredByIdempotencyKey: async (idempotencyKey) => {
      const { data, error } = await smsMessagesQuery(db)
        .select("id,twilio_message_sid,status,from_e164")
        .eq("direction", "out")
        .eq("correlation_id", idempotencyKey)
        .not("twilio_message_sid", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to resolve prior sms delivery state.");
      }

      const messageId = readRequiredString(data, "id");
      const twilioMessageSid = readRequiredString(data, "twilio_message_sid");
      const fromE164 = readRequiredString(data, "from_e164");
      if (!messageId || !twilioMessageSid || !fromE164) {
        return null;
      }

      return {
        messageId,
        twilioMessageSid,
        status: readOptionalString(data, "status"),
        fromE164,
      };
    },

    findPendingByIdempotencyKey: async (idempotencyKey) => {
      const { data, error } = await smsMessagesQuery(db)
        .select("id")
        .eq("direction", "out")
        .eq("correlation_id", idempotencyKey)
        .is("twilio_message_sid", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to resolve pending sms delivery state.");
      }

      const messageId = readRequiredString(data, "id");
      return messageId ? { messageId } : null;
    },

    insertPending: async (input) => {
      const payload: Record<string, unknown> = {
        user_id: input.userId,
        profile_id: input.profileId,
        direction: "out",
        from_e164: input.fromE164,
        to_e164: input.toE164,
        twilio_message_sid: null,
        body_ciphertext: input.bodyCiphertext,
        body_iv: input.bodyIv,
        body_tag: input.bodyTag,
        key_version: input.keyVersion,
        media_count: input.mediaCount,
        status: input.status,
        last_status_at: input.createdAtIso,
        correlation_id: input.idempotencyKey,
      };

      const { data, error } = await smsMessagesQuery(db)
        .insert(payload)
        .select("id")
        .single();

      if (error) {
        throw new Error("Unable to insert pending sms row.");
      }

      const messageId = readRequiredString(data, "id");
      if (!messageId) {
        throw new Error("Pending sms insert did not return a message id.");
      }

      return { messageId };
    },

    finalizeSent: async (input) => {
      const { error } = await smsMessagesQuery(db)
        .update({
          from_e164: input.fromE164,
          twilio_message_sid: input.twilioMessageSid,
          status: input.status,
          last_status_at: input.finalizedAtIso,
        })
        .eq("id", input.messageId)
        .is("twilio_message_sid", null)
        .select("id")
        .maybeSingle();

      if (error) {
        throw new Error("Unable to finalize sms delivery state.");
      }
    },
  };
}

function validateSendRequest(request: SendSmsRequest): void {
  assertNonEmpty("to", request.to);
  assertNonEmpty("body", request.body);
  assertNonEmpty("correlationId", request.correlationId);
  assertNonEmpty("purpose", request.purpose);
  assertNonEmpty("idempotencyKey", request.idempotencyKey);
  assertSenderIdentityPresent(request.from, request.messagingServiceSid);
  assertNoLegacyRegionLaunchNotifyContract(request.purpose, request.idempotencyKey);

  if (!request.client || typeof request.client.sendMessage !== "function") {
    throw new Error("A valid Twilio client is required.");
  }
}

function assertNonEmpty(name: string, value: string): void {
  if (!value || value.trim().length === 0) {
    throw new Error(`sendSms requires a non-empty ${name}.`);
  }
}

function assertSenderIdentityPresent(
  from: string | null | undefined,
  messagingServiceSid: string | null | undefined,
): void {
  if (!normalizeOptionalString(from) && !normalizeOptionalString(messagingServiceSid)) {
    throw new Error("sendSms requires a non-empty from or messagingServiceSid.");
  }
}

function resolvePersistenceFromSenderIdentity(
  from: string | null,
  messagingServiceSid: string | null,
): string {
  if (from) {
    return from;
  }
  if (messagingServiceSid) {
    return messagingServiceSid;
  }

  throw new Error("sendSms requires a non-empty from or messagingServiceSid.");
}

function assertNoLegacyRegionLaunchNotifyContract(purpose: string, idempotencyKey: string): void {
  if (purpose === LEGACY_REGION_LAUNCH_NOTIFY_PURPOSE) {
    throw new Error("Legacy region_launch_notify purpose is forbidden.");
  }
  if (idempotencyKey.startsWith(LEGACY_REGION_LAUNCH_NOTIFY_IDEMPOTENCY_PREFIX)) {
    throw new Error("Legacy region_launch_notify idempotency keys are forbidden.");
  }
}

function resolvePersistence(request: SendSmsRequest): SmsMessagePersistence {
  if (request.persistence) {
    return request.persistence;
  }

  if (!request.db) {
    throw new Error("sendSms requires either persistence or db.");
  }

  return createSupabaseSmsMessagePersistence(request.db);
}

function smsMessagesQuery(db: SmsDbClient): SmsMessagesQuery {
  return db.from("sms_messages") as SmsMessagesQuery;
}

function readRequiredString(
  data: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!data) {
    return null;
  }

  const value = data[key];
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readOptionalString(
  data: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!data) {
    return null;
  }

  const value = data[key];
  return typeof value === "string" ? value : null;
}

function toSendSmsError(input: {
  error: unknown;
  correlationId: string;
  purpose: string;
  idempotencyKey: string;
  statusCode: number | null;
  retryable: boolean;
}): SendSmsError {
  const message = toSafeMessage(input.error);

  return new SendSmsError({
    message,
    correlationId: input.correlationId,
    purpose: input.purpose,
    idempotencyKey: input.idempotencyKey,
    statusCode: input.statusCode,
    retryable: input.retryable,
  });
}

function toSafeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "SMS send failed.";
}

function noopLogger(): void {
  // No-op when no logger is provided.
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIdempotencyKeyForSmsCorrelation(idempotencyKey: string): string {
  const normalized = idempotencyKey.trim();
  if (UUID_PATTERN.test(normalized)) {
    return normalized;
  }

  return deterministicUuidFromString(normalized);
}

function deterministicUuidFromString(input: string): string {
  const hex = [
    fnv1a32(`0:${input}`),
    fnv1a32(`1:${input}`),
    fnv1a32(`2:${input}`),
    fnv1a32(`3:${input}`),
  ]
    .map((part) => part.toString(16).padStart(8, "0"))
    .join("");

  const chars = hex.split("");
  chars[12] = "5";
  const variant = parseInt(chars[16] ?? "0", 16);
  chars[16] = ((variant & 0x3) | 0x8).toString(16);
  const canonical = chars.join("");

  return `${canonical.slice(0, 8)}-${canonical.slice(8, 12)}-${canonical.slice(12, 16)}-${
    canonical.slice(16, 20)
  }-${canonical.slice(20, 32)}`;
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}
