import type { DbClient } from "../../../db/src/types";
import { GroupSizePreferenceSchema } from "../../../db/src/types/profile";
import type { Database } from "../../../../supabase/types/database";

type DbClientLike = Pick<DbClient, "from" | "rpc">;

type InvitationRow = Database["public"]["Tables"]["invitations"]["Row"];

type LinkupQuorumInvitation = Pick<
  InvitationRow,
  | "id"
  | "user_id"
  | "state"
  | "group_size_preference_snapshot"
  | "expires_at"
  | "activity_key"
  | "proposed_time_window"
>;

type GroupSizePreference = {
  min: number;
  max: number;
};

type LockLinkupQuorumResult = {
  status: "locked" | "already_locked" | "not_broadcasting" | "not_found";
};

export type QuorumResult =
  | { locked: true; acceptedCount: number }
  | {
    locked: false;
    reason: "min_not_met" | "preferences_not_satisfied" | "still_pending";
  };

export type LinkupQuorumRepository = {
  fetchLinkupInvitations(linkupId: string): Promise<LinkupQuorumInvitation[]>;
  fetchActivityDisplayName(activityKey: string): Promise<string | null>;
  lockLinkupQuorum(input: {
    linkupId: string;
    confirmationMessage: string;
    smsEncryptionKey: string;
    nowIso: string;
  }): Promise<LockLinkupQuorumResult>;
};

const DEFAULT_GROUP_SIZE_PREFERENCE: GroupSizePreference = { min: 2, max: 10 };

export async function evaluateLinkupQuorum(
  linkupId: string,
): Promise<QuorumResult> {
  const db = await createServiceRoleDbClientRuntime();

  return evaluateLinkupQuorumWithRepository({
    linkupId,
    repository: createSupabaseLinkupQuorumRepository(db),
    smsEncryptionKey: requireSmsEncryptionKey(),
  });
}

export async function evaluateLinkupQuorumWithRepository(input: {
  linkupId: string;
  repository: LinkupQuorumRepository;
  smsEncryptionKey: string;
  now?: () => Date;
}): Promise<QuorumResult> {
  const invitations = await input.repository.fetchLinkupInvitations(input.linkupId);
  const acceptedInvites = invitations.filter((invitation) => invitation.state === "accepted");
  const pendingInvites = invitations.filter((invitation) => invitation.state === "pending");
  const acceptedCount = acceptedInvites.length;

  if (acceptedCount < 2) {
    return { locked: false, reason: "min_not_met" };
  }

  const prefSatisfied = isPreferenceSatisfied(acceptedInvites, acceptedCount);
  if (prefSatisfied && pendingInvites.length > 0) {
    return { locked: false, reason: "still_pending" };
  }

  if (!prefSatisfied && pendingInvites.length > 0) {
    return { locked: false, reason: "preferences_not_satisfied" };
  }

  const firstAcceptedInvitation = acceptedInvites[0];
  if (!firstAcceptedInvitation) {
    return { locked: false, reason: "min_not_met" };
  }

  const activityDisplayName = await input.repository.fetchActivityDisplayName(
    firstAcceptedInvitation.activity_key,
  );
  const confirmationMessage = buildLinkupConfirmationMessage({
    activityKey: firstAcceptedInvitation.activity_key,
    activityDisplayName,
    proposedTimeWindow: firstAcceptedInvitation.proposed_time_window,
    acceptedCount,
  });

  const result = await input.repository.lockLinkupQuorum({
    linkupId: input.linkupId,
    confirmationMessage,
    smsEncryptionKey: input.smsEncryptionKey,
    nowIso: (input.now ?? (() => new Date()))().toISOString(),
  });

  if (result.status === "locked" || result.status === "already_locked") {
    return { locked: true, acceptedCount };
  }

  throw new Error(
    `lock_linkup_quorum returned unexpected status '${result.status}' for ${input.linkupId}.`,
  );
}

export function createSupabaseLinkupQuorumRepository(
  supabase: DbClientLike,
): LinkupQuorumRepository {
  return {
    async fetchLinkupInvitations(linkupId) {
      const { data, error } = await supabase
        .from("invitations")
        .select(
          "id,user_id,state,group_size_preference_snapshot,expires_at,activity_key,proposed_time_window",
        )
        .eq("linkup_id", linkupId)
        .order("offered_at", { ascending: true });

      if (error) {
        throw new Error(`Unable to load invitations for quorum evaluation: ${error.message}`);
      }

      return (data ?? []) as LinkupQuorumInvitation[];
    },

    async fetchActivityDisplayName(activityKey) {
      const { data, error } = await supabase
        .from("activity_catalog")
        .select("display_name")
        .eq("activity_key", activityKey)
        .maybeSingle();

      if (error) {
        throw new Error(`Unable to load activity display name for quorum evaluation: ${error.message}`);
      }

      if (!data?.display_name || typeof data.display_name !== "string") {
        return null;
      }

      return data.display_name.trim();
    },

    async lockLinkupQuorum({ linkupId, confirmationMessage, smsEncryptionKey, nowIso }) {
      const rpc = supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{
        data: unknown;
        error: { message: string } | null;
      }>;
      const { data, error } = await rpc("lock_linkup_quorum", {
        p_linkup_id: linkupId,
        p_confirmation_message: confirmationMessage,
        p_sms_encryption_key: smsEncryptionKey,
        p_now: nowIso,
      });

      if (error) {
        throw new Error(`Unable to lock linkup quorum: ${error.message}`);
      }

      const row = (Array.isArray(data) ? data[0] : data) as
        | { status?: unknown }
        | null
        | undefined;

      if (!row || !isLockLinkupQuorumStatus(row.status)) {
        throw new Error("lock_linkup_quorum returned an unexpected result.");
      }

      return { status: row.status };
    },
  };
}

function isPreferenceSatisfied(
  acceptedInvites: LinkupQuorumInvitation[],
  acceptedCount: number,
): boolean {
  const preferences = acceptedInvites.map((invitation) =>
    normalizeGroupSizePreference(invitation.group_size_preference_snapshot)
  );
  const minRequired = Math.max(...preferences.map((preference) => preference.min));
  const maxAllowed = Math.min(...preferences.map((preference) => preference.max));

  return acceptedCount >= minRequired && acceptedCount <= maxAllowed;
}

function normalizeGroupSizePreference(value: unknown): GroupSizePreference {
  const parsed = GroupSizePreferenceSchema.safeParse(value);
  if (!parsed.success) {
    return DEFAULT_GROUP_SIZE_PREFERENCE;
  }

  return parsed.data;
}

function buildLinkupConfirmationMessage(input: {
  activityKey: string;
  activityDisplayName: string | null;
  proposedTimeWindow: string;
  acceptedCount: number;
}): string {
  const activityDisplayName = resolveActivityDisplayName(
    input.activityKey,
    input.activityDisplayName,
  );

  return `You're confirmed for ${activityDisplayName} with ${input.acceptedCount - 1} other people ${input.proposedTimeWindow}. JOSH will send a reminder closer to the time.`;
}

function resolveActivityDisplayName(
  activityKey: string,
  activityDisplayName: string | null,
): string {
  if (typeof activityDisplayName === "string" && activityDisplayName.trim()) {
    return activityDisplayName.trim();
  }

  return activityKey
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
}

async function createServiceRoleDbClientRuntime() {
  if (typeof (globalThis as { Deno?: unknown }).Deno !== "undefined") {
    const module = await import("../../../db/src/client-deno.mjs");
    return module.createServiceRoleDbClient();
  }

  const module = await import("../../../db/src/client-node.mjs");
  return module.createServiceRoleDbClient();
}

function requireSmsEncryptionKey(): string {
  const denoRuntime = (globalThis as unknown as {
    Deno?: { env?: { get?: (name: string) => string | undefined } };
  }).Deno;
  const denoValue = denoRuntime?.env?.get?.("SMS_BODY_ENCRYPTION_KEY");
  if (typeof denoValue === "string" && denoValue.trim()) {
    return denoValue.trim();
  }

  const nodeRuntime = (globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  const nodeValue = nodeRuntime?.env?.SMS_BODY_ENCRYPTION_KEY;
  if (typeof nodeValue === "string" && nodeValue.trim()) {
    return nodeValue.trim();
  }

  throw new Error("SMS_BODY_ENCRYPTION_KEY is required to evaluate linkup quorum.");
}

function isLockLinkupQuorumStatus(
  value: unknown,
): value is LockLinkupQuorumResult["status"] {
  return value === "locked" ||
    value === "already_locked" ||
    value === "not_broadcasting" ||
    value === "not_found";
}

export const __private__ = {
  buildLinkupConfirmationMessage,
  normalizeGroupSizePreference,
  resolveActivityDisplayName,
};
