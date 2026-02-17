export type WaitlistStatus = "waiting" | "onboarded" | "notified" | "activated" | "removed";

export type WaitlistEntrySnapshot = {
  profile_id: string;
  region_id: string;
  status: WaitlistStatus;
  last_notified_at: string | null;
};

export type ResolveWaitlistReplayInput = {
  is_active_launch_region: boolean;
  profile_id: string;
  region_id: string;
  now_iso: string;
  existing_entry: WaitlistEntrySnapshot | null;
};

export type ResolveWaitlistReplayResult = {
  should_upsert_entry: boolean;
  should_send_confirmation: boolean;
  next_entry: WaitlistEntrySnapshot | null;
};

export function resolveWaitlistReplay(
  input: ResolveWaitlistReplayInput,
): ResolveWaitlistReplayResult {
  if (input.is_active_launch_region) {
    return {
      should_upsert_entry: false,
      should_send_confirmation: false,
      next_entry: null,
    };
  }

  const baseEntry: WaitlistEntrySnapshot = input.existing_entry ?? {
    profile_id: input.profile_id,
    region_id: input.region_id,
    status: "waiting",
    last_notified_at: null,
  };

  const shouldSendConfirmation = baseEntry.last_notified_at === null;

  return {
    should_upsert_entry: true,
    should_send_confirmation: shouldSendConfirmation,
    next_entry: {
      ...baseEntry,
      region_id: input.region_id,
      status: shouldSendConfirmation ? "notified" : baseEntry.status,
      last_notified_at: shouldSendConfirmation ? input.now_iso : baseEntry.last_notified_at,
    },
  };
}
