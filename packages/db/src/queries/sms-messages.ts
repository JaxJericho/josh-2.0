import { DB_ERROR_CODES, DbError } from "../errors.mjs";
import type { DbClient, DbInsert } from "../types";

export type PendingSmsMessage = {
  id: string;
  from_e164: string | null;
};

export type InsertOutboundSmsMessageInput = {
  user_id: string;
  profile_id: string;
  from_e164: string;
  to_e164: string;
  body_ciphertext: string;
  correlation_id: string;
  status?: string;
  key_version?: number;
  media_count?: number;
  last_status_at?: string;
};

/** Return whether an outbound message correlation id has already been delivered. */
export async function hasDeliveredSmsMessage(
  db: DbClient,
  correlationId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("sms_messages")
    .select("id")
    .eq("correlation_id", correlationId)
    .not("twilio_message_sid", "is", null)
    .limit(1);

  if (error) {
    throw new DbError(DB_ERROR_CODES.QUERY_FAILED, "Unable to resolve sms message delivery state.", {
      status: 500,
      cause: error,
      context: { correlation_id: correlationId, table: "sms_messages" },
    });
  }

  return Array.isArray(data) && data.length > 0;
}

/** Load the newest pending outbound sms message row for a correlation id. */
export async function loadPendingSmsMessage(
  db: DbClient,
  correlationId: string,
): Promise<PendingSmsMessage | null> {
  const { data, error } = await db
    .from("sms_messages")
    .select("id,from_e164")
    .eq("correlation_id", correlationId)
    .is("twilio_message_sid", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new DbError(
      DB_ERROR_CODES.QUERY_FAILED,
      "Unable to inspect pending outbound sms message state.",
      {
        status: 500,
        cause: error,
        context: { correlation_id: correlationId, table: "sms_messages" },
      },
    );
  }

  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!row?.id) {
    return null;
  }

  return {
    id: row.id,
    from_e164: row.from_e164 ?? null,
  };
}

/** Insert a queued outbound sms message row and return the new id. */
export async function insertOutboundSmsMessage(
  db: DbClient,
  input: InsertOutboundSmsMessageInput,
): Promise<{ id: string }> {
  const payload: DbInsert<"sms_messages"> = {
    user_id: input.user_id,
    profile_id: input.profile_id,
    direction: "out",
    from_e164: input.from_e164,
    to_e164: input.to_e164,
    twilio_message_sid: null,
    body_ciphertext: input.body_ciphertext,
    body_iv: null,
    body_tag: null,
    key_version: input.key_version ?? 1,
    media_count: input.media_count ?? 0,
    status: input.status ?? "queued",
    last_status_at: input.last_status_at ?? new Date().toISOString(),
    correlation_id: input.correlation_id,
  };

  const { data, error } = await db
    .from("sms_messages")
    .insert(payload)
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new DbError(DB_ERROR_CODES.QUERY_FAILED, "Unable to insert outbound sms message.", {
      status: 500,
      cause: error ?? undefined,
      context: { correlation_id: input.correlation_id, table: "sms_messages" },
    });
  }

  return { id: data.id };
}

/** Finalize a pending outbound sms message with Twilio delivery metadata. */
export async function finalizeSmsMessageDelivery(
  db: DbClient,
  input: {
    messageId: string;
    fromE164: string;
    twilioMessageSid: string;
    status: string;
    lastStatusAt?: string;
  },
): Promise<void> {
  const { error } = await db
    .from("sms_messages")
    .update({
      from_e164: input.fromE164,
      twilio_message_sid: input.twilioMessageSid,
      status: input.status,
      last_status_at: input.lastStatusAt ?? new Date().toISOString(),
    })
    .eq("id", input.messageId)
    .is("twilio_message_sid", null);

  if (error) {
    throw new DbError(DB_ERROR_CODES.QUERY_FAILED, "Unable to finalize outbound sms message.", {
      status: 500,
      cause: error,
      context: { message_id: input.messageId, table: "sms_messages" },
    });
  }
}

/** Update sms_messages status by Twilio MessageSid. */
export async function updateSmsMessageStatusByTwilioSid(
  db: DbClient,
  input: {
    twilioMessageSid: string;
    status: string;
    lastStatusAt?: string;
  },
): Promise<void> {
  const { error } = await db
    .from("sms_messages")
    .update({
      status: input.status,
      last_status_at: input.lastStatusAt ?? new Date().toISOString(),
    })
    .eq("twilio_message_sid", input.twilioMessageSid);

  if (error) {
    throw new DbError(DB_ERROR_CODES.QUERY_FAILED, "Unable to update sms message status.", {
      status: 500,
      cause: error,
      context: { twilio_message_sid: input.twilioMessageSid, table: "sms_messages" },
    });
  }
}
