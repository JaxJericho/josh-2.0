import { logEvent } from "../observability/logger.ts";
import { dispatchInvitation } from "./dispatch-invitation.ts";
import { selectSoloInvitation } from "./solo-invitation-selector.ts";

const COLD_START_NO_ACTIVITY_AVAILABLE_EVENT = "cold_start.no_activity_available";

export async function dispatchSingleUserInvitation(
  userId: string,
): Promise<void> {
  const candidate = await selectSoloInvitation(userId);

  if (!candidate) {
    logEvent({
      event: COLD_START_NO_ACTIVITY_AVAILABLE_EVENT,
      user_id: userId,
      payload: {
        userId,
      },
    });
    return;
  }

  await dispatchInvitation({
    userId,
    invitationType: "solo",
    activityKey: candidate.activityKey,
    proposedTimeWindow: candidate.proposedTimeWindow,
    locationHint: candidate.locationHint ?? undefined,
    correlationId: crypto.randomUUID(),
  });
}
