import { createServiceRoleDbClient } from "../../../db/src/client-node.mjs";
import type { DbClient, DbRow } from "../../../db/src/types";
import {
  createSupabaseEligibilityRepository,
  evaluateEligibility,
} from "../entitlements/evaluate-eligibility.ts";
import {
  INVITATION_BACKOFF_THRESHOLD,
  INVITATION_COOLDOWN_DAYS,
  INVITATION_WEEK_ROLLING_DAYS,
  INVITATION_WEEKLY_CAP,
} from "./constants";

type DbClientLike = Pick<DbClient, "from">;

type UserInvitationFrequencyState = Pick<
  DbRow<"users">,
  | "last_invited_at"
  | "invitation_week_start"
  | "invitation_count_this_week"
  | "invitation_backoff_count"
>;

export type FrequencyGuardResult =
  | { eligible: true }
  | {
    eligible: false;
    reason:
      | "weekly_cap"
      | "cooldown"
      | "backoff_suppressed"
      | "eligibility_gate";
  };

export async function checkInvitationEligibility(
  userId: string,
): Promise<FrequencyGuardResult> {
  const db = createServiceRoleDbClient();
  const eligibility = await evaluateEligibility({
    userId,
    action_type: "can_receive_invitation",
    repository: createSupabaseEligibilityRepository(db),
  });

  if (!eligibility.eligible) {
    return {
      eligible: false,
      reason: "eligibility_gate",
    };
  }

  const now = new Date();
  const userState = await fetchUserInvitationFrequencyState(db, userId);

  if (isCooldownActive(userState.last_invited_at, now)) {
    return {
      eligible: false,
      reason: "cooldown",
    };
  }

  if (isWeeklyCapReached(userState, now)) {
    return {
      eligible: false,
      reason: "weekly_cap",
    };
  }

  if (userState.invitation_backoff_count >= INVITATION_BACKOFF_THRESHOLD) {
    return {
      eligible: false,
      reason: "backoff_suppressed",
    };
  }

  return { eligible: true };
}

async function fetchUserInvitationFrequencyState(
  db: DbClientLike,
  userId: string,
): Promise<UserInvitationFrequencyState> {
  const { data, error } = await db
    .from("users")
    .select(
      "last_invited_at,invitation_week_start,invitation_count_this_week,invitation_backoff_count",
    )
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to resolve user invitation frequency state.");
  }

  if (!data) {
    throw new Error(`User '${userId}' not found for invitation frequency guard.`);
  }

  return {
    last_invited_at:
      typeof data.last_invited_at === "string" ? data.last_invited_at : null,
    invitation_week_start:
      typeof data.invitation_week_start === "string"
        ? data.invitation_week_start
        : null,
    invitation_count_this_week:
      typeof data.invitation_count_this_week === "number"
        ? data.invitation_count_this_week
        : 0,
    invitation_backoff_count:
      typeof data.invitation_backoff_count === "number"
        ? data.invitation_backoff_count
        : 0,
  };
}

function isCooldownActive(lastInvitedAtIso: string | null, now: Date): boolean {
  if (!lastInvitedAtIso) {
    return false;
  }

  const cooldownEndsAt = new Date(lastInvitedAtIso);
  cooldownEndsAt.setUTCDate(
    cooldownEndsAt.getUTCDate() + INVITATION_COOLDOWN_DAYS,
  );

  return now < cooldownEndsAt;
}

function isWeeklyCapReached(
  userState: UserInvitationFrequencyState,
  now: Date,
): boolean {
  if (!userState.invitation_week_start) {
    return false;
  }

  const rollingWindowEndsAt = new Date(userState.invitation_week_start);
  rollingWindowEndsAt.setUTCDate(
    rollingWindowEndsAt.getUTCDate() + INVITATION_WEEK_ROLLING_DAYS,
  );

  if (now > rollingWindowEndsAt) {
    return false;
  }

  return userState.invitation_count_this_week >= INVITATION_WEEKLY_CAP;
}
