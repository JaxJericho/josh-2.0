import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../../../supabase/types/database";
import type { LogLevel } from "../observability/logger.ts";

type DbClientLike = Pick<SupabaseClient<Database>, "from" | "rpc">;

type InvitationRow = Database["public"]["Tables"]["invitations"]["Row"];

export type ExpirableInvitation = Pick<
  InvitationRow,
  "id" | "user_id" | "invitation_type" | "activity_key" | "time_window" | "expires_at"
>;

export type ExpireInvitationResult = {
  expired: boolean;
  reason: string;
};

export type InvitationExpiryLogInput = {
  level?: LogLevel;
  event: string;
  correlation_id: string;
  user_id?: string | null;
  payload: Record<string, unknown>;
};

export type InvitationExpiryRepository = {
  fetchStaleInvitations(input: {
    limit: number;
    nowIso: string;
  }): Promise<ExpirableInvitation[]>;
  expireInvitation(input: {
    invitationId: string;
    correlationId: string;
    nowIso: string;
  }): Promise<ExpireInvitationResult>;
};

const BATCH_SIZE = 50;

export async function expireStaleInvitations(input: {
  repository: InvitationExpiryRepository;
  correlationId: string;
  now?: () => Date;
  log?: (entry: InvitationExpiryLogInput) => void;
}): Promise<{ expiredCount: number }> {
  let expiredCount = 0;

  while (true) {
    const nowIso = (input.now ?? (() => new Date()))().toISOString();
    const invitations = await input.repository.fetchStaleInvitations({
      limit: BATCH_SIZE,
      nowIso,
    });

    if (invitations.length === 0) {
      return { expiredCount };
    }

    let batchExpiredCount = 0;

    for (const invitation of invitations) {
      try {
        const result = await input.repository.expireInvitation({
          invitationId: invitation.id,
          correlationId: input.correlationId,
          nowIso,
        });

        if (result.expired) {
          expiredCount += 1;
          batchExpiredCount += 1;
        }
      } catch (error) {
        input.log?.({
          level: "error",
          event: "system.unhandled_error",
          correlation_id: input.correlationId,
          user_id: invitation.user_id,
          payload: {
            phase: "expire_invitation",
            error_name: normalizeErrorName(error),
            error_message: normalizeErrorMessage(error),
            invitation_id: invitation.id,
            request_id: input.correlationId,
          },
        });
      }
    }

    // Avoid re-reading the same permanently failing stale rows forever.
    if (batchExpiredCount === 0) {
      return { expiredCount };
    }
  }
}

export function createSupabaseInvitationExpiryRepository(
  supabase: DbClientLike,
): InvitationExpiryRepository {
  return {
    async fetchStaleInvitations({ limit, nowIso }) {
      const { data, error } = await supabase
        .from("invitations")
        .select("id,user_id,invitation_type,activity_key,time_window,expires_at")
        .eq("state", "pending")
        .lte("expires_at", nowIso)
        .order("expires_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to fetch stale invitations: ${error.message}`);
      }

      return (data ?? []) as ExpirableInvitation[];
    },

    async expireInvitation({ invitationId, correlationId, nowIso }) {
      const rpc = supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{
        data: unknown;
        error: { message: string } | null;
      }>;
      const { data, error } = await rpc("expire_invitation", {
        p_invitation_id: invitationId,
        p_correlation_id: correlationId,
        p_now: nowIso,
      });

      if (error) {
        throw new Error(`Failed to expire invitation ${invitationId}: ${error.message}`);
      }

      const row = (Array.isArray(data) ? data[0] : data) as
        | { expired?: unknown; reason?: unknown }
        | null
        | undefined;

      if (!row) {
        throw new Error(`Invitation expiry RPC returned no row for ${invitationId}`);
      }

      return {
        expired: row.expired === true,
        reason: typeof row.reason === "string" ? row.reason : "unknown",
      };
    },
  };
}

function normalizeErrorName(error: unknown): string {
  if (error instanceof Error && error.name.trim().length > 0) {
    return error.name;
  }

  return "Error";
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Unknown error";
}
