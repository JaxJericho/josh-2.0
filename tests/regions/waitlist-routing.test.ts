import { describe, expect, it } from "vitest";
import {
  resolveWaitlistReplay,
  type WaitlistEntrySnapshot,
} from "../../packages/core/src/regions/waitlist-routing";

describe("waitlist replay routing", () => {
  it("non-launch regions keep exactly one waitlist entry across replays", () => {
    const profileId = "pro_waitlist_1";
    const regionId = "reg_waitlist";

    const first = resolveWaitlistReplay({
      is_active_launch_region: false,
      profile_id: profileId,
      region_id: regionId,
      now_iso: "2026-02-17T18:00:00.000Z",
      existing_entry: null,
    });

    expect(first.should_upsert_entry).toBe(true);
    expect(first.should_send_confirmation).toBe(true);
    expect(first.next_entry).not.toBeNull();

    const replay = resolveWaitlistReplay({
      is_active_launch_region: false,
      profile_id: profileId,
      region_id: regionId,
      now_iso: "2026-02-17T18:05:00.000Z",
      existing_entry: first.next_entry as WaitlistEntrySnapshot,
    });

    expect(replay.should_upsert_entry).toBe(true);
    expect(replay.should_send_confirmation).toBe(false);
    expect(replay.next_entry?.profile_id).toBe(profileId);
  });

  it("waitlist confirmation is emitted once under replay", () => {
    const initial = resolveWaitlistReplay({
      is_active_launch_region: false,
      profile_id: "pro_waitlist_2",
      region_id: "reg_waitlist",
      now_iso: "2026-02-17T19:00:00.000Z",
      existing_entry: null,
    });

    const second = resolveWaitlistReplay({
      is_active_launch_region: false,
      profile_id: "pro_waitlist_2",
      region_id: "reg_waitlist",
      now_iso: "2026-02-17T19:01:00.000Z",
      existing_entry: initial.next_entry,
    });

    expect(initial.should_send_confirmation).toBe(true);
    expect(second.should_send_confirmation).toBe(false);
  });

  it("active launch regions do not create waitlist entries", () => {
    const result = resolveWaitlistReplay({
      is_active_launch_region: true,
      profile_id: "pro_launch",
      region_id: "reg_us_wa",
      now_iso: "2026-02-17T20:00:00.000Z",
      existing_entry: null,
    });

    expect(result.should_upsert_entry).toBe(false);
    expect(result.should_send_confirmation).toBe(false);
    expect(result.next_entry).toBeNull();
  });
});
