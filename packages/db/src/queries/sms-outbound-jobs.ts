import { DB_ERROR_CODES, DbError } from "../errors.mjs";
import type { DbClient } from "../types";

/** Update sms_outbound_jobs status by Twilio MessageSid. */
export async function updateSmsOutboundJobStatusByTwilioSid(
  db: DbClient,
  input: {
    twilioMessageSid: string;
    status: string;
    lastStatusAt?: string;
    lastError?: string | null;
  },
): Promise<void> {
  const updatePayload: Record<string, unknown> = {
    status: input.status,
    last_status_at: input.lastStatusAt ?? new Date().toISOString(),
  };

  if (input.lastError) {
    updatePayload.last_error = input.lastError;
  }

  const { error } = await db
    .from("sms_outbound_jobs")
    .update(updatePayload)
    .eq("twilio_message_sid", input.twilioMessageSid)
    .neq("status", "canceled");

  if (error) {
    throw new DbError(DB_ERROR_CODES.QUERY_FAILED, "Unable to update outbound sms job status.", {
      status: 500,
      cause: error,
      context: { twilio_message_sid: input.twilioMessageSid, table: "sms_outbound_jobs" },
    });
  }
}
