import type { TwilioClient } from "./client";

export type MessageTemplate<TParams extends Record<string, unknown>> = (
  params: Readonly<TParams>,
) => string;

export type SendSmsLogLevel = "info" | "warn" | "error";

export type SendSmsLogger = (
  level: SendSmsLogLevel,
  event: string,
  metadata: Record<string, unknown>,
) => void;

export type SmsDbClient = {
  from: (table: "sms_messages") => unknown;
};

export type PersistedDeliveredSms = {
  messageId: string;
  twilioMessageSid: string;
  status: string | null;
  fromE164: string;
};

export type PersistedPendingSms = {
  messageId: string;
};

export type InsertPendingSmsInput = {
  userId: string | null;
  profileId: string | null;
  fromE164: string;
  toE164: string;
  idempotencyKey: string;
  bodyCiphertext: string | null;
  bodyIv: string | null;
  bodyTag: string | null;
  keyVersion: number;
  mediaCount: number;
  status: string;
  createdAtIso: string;
};

export type FinalizeSentSmsInput = {
  messageId: string;
  fromE164: string;
  twilioMessageSid: string;
  status: string;
  finalizedAtIso: string;
};

export type SmsMessagePersistence = {
  findDeliveredByIdempotencyKey: (
    idempotencyKey: string,
  ) => Promise<PersistedDeliveredSms | null>;
  findPendingByIdempotencyKey: (
    idempotencyKey: string,
  ) => Promise<PersistedPendingSms | null>;
  insertPending: (input: InsertPendingSmsInput) => Promise<PersistedPendingSms>;
  finalizeSent: (input: FinalizeSentSmsInput) => Promise<void>;
};

export type SendSmsRequest = {
  client: TwilioClient;
  db?: SmsDbClient;
  persistence?: SmsMessagePersistence;
  to: string;
  from: string;
  body: string;
  correlationId: string;
  purpose: string;
  idempotencyKey: string;
  userId?: string | null;
  profileId?: string | null;
  messagingServiceSid?: string | null;
  statusCallbackUrl?: string | null;
  bodyCiphertext?: string | null;
  bodyIv?: string | null;
  bodyTag?: string | null;
  keyVersion?: number;
  mediaCount?: number;
  logger?: SendSmsLogger;
  now?: () => Date;
};

export type SendSmsResult = {
  messageId: string;
  twilioMessageSid: string;
  status: string;
  fromE164: string;
  deduplicated: boolean;
  attempts: number;
};
