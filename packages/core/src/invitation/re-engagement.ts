import type { DbClient } from "../../../db/src/types";
import { INVITATION_BACKOFF_THRESHOLD } from "./constants";

const RE_ENGAGEMENT_MESSAGE_TEMPLATE =
  "Hey {firstName} - it's been a while. JOSH wants to make sure it's sending you the right things. What kinds of plans sound good to you lately?";
const RE_ENGAGEMENT_STATE_TOKEN = "interview:awaiting_next_input";

type DbClientLike = Pick<DbClient, "rpc">;

type ReEngagementRpcRow = {
  sent?: unknown;
  user_id?: unknown;
  reason?: unknown;
};

export type ReEngagementResult =
  | { sent: true; userId: string }
  | { sent: false; reason: "safety_hold" | "threshold_not_met" };

export type ReEngagementRepository = {
  sendReEngagementMessage(input: {
    userId: string;
    threshold: number;
    messageTemplate: string;
    smsEncryptionKey: string;
    stateToken: string;
    nowIso: string;
  }): Promise<ReEngagementResult>;
};

export async function sendReEngagementMessage(
  userId: string,
): Promise<ReEngagementResult> {
  const { createServiceRoleDbClient } = await import("../../../db/src/client-node.mjs");
  const db = createServiceRoleDbClient();

  return sendReEngagementMessageWithRepository({
    userId,
    repository: createSupabaseReEngagementRepository(db),
    smsEncryptionKey: requireSmsEncryptionKey(),
  });
}

export async function sendReEngagementMessageWithRepository(input: {
  userId: string;
  repository: ReEngagementRepository;
  smsEncryptionKey: string;
  now?: () => Date;
}): Promise<ReEngagementResult> {
  return input.repository.sendReEngagementMessage({
    userId: input.userId,
    threshold: INVITATION_BACKOFF_THRESHOLD,
    messageTemplate: RE_ENGAGEMENT_MESSAGE_TEMPLATE,
    smsEncryptionKey: input.smsEncryptionKey,
    stateToken: RE_ENGAGEMENT_STATE_TOKEN,
    nowIso: (input.now ?? (() => new Date()))().toISOString(),
  });
}

export function createSupabaseReEngagementRepository(
  supabase: DbClientLike,
): ReEngagementRepository {
  return {
    async sendReEngagementMessage({
      userId,
      threshold,
      messageTemplate,
      smsEncryptionKey,
      stateToken,
      nowIso,
    }) {
      const rpc = supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{
        data: unknown;
        error: { message: string } | null;
      }>;

      const { data, error } = await rpc("send_reengagement_message", {
        p_user_id: userId,
        p_threshold: threshold,
        p_message_template: messageTemplate,
        p_sms_encryption_key: smsEncryptionKey,
        p_state_token: stateToken,
        p_now: nowIso,
      });

      if (error) {
        throw new Error(`Unable to send re-engagement message: ${error.message}`);
      }

      const row = (Array.isArray(data) ? data[0] : data) as ReEngagementRpcRow | null;
      if (!row) {
        throw new Error("send_reengagement_message RPC returned no result row.");
      }

      if (row.sent === true && typeof row.user_id === "string") {
        return {
          sent: true,
          userId: row.user_id,
        };
      }

      if (row.sent === false && isReEngagementReason(row.reason)) {
        return {
          sent: false,
          reason: row.reason,
        };
      }

      throw new Error("send_reengagement_message RPC returned an unexpected result.");
    },
  };
}

function requireSmsEncryptionKey(): string {
  const value = process.env.SMS_BODY_ENCRYPTION_KEY?.trim();
  if (!value) {
    throw new Error("Missing required env var: SMS_BODY_ENCRYPTION_KEY");
  }
  return value;
}

function isReEngagementReason(
  value: unknown,
): value is "safety_hold" | "threshold_not_met" {
  return value === "safety_hold" || value === "threshold_not_met";
}
