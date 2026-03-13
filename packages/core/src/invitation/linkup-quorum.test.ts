import { describe, expect, it } from "vitest";

import {
  evaluateLinkupQuorumWithRepository,
  type LinkupQuorumRepository,
} from "./linkup-quorum";

type TestInvitation = {
  id: string;
  user_id: string;
  state: "pending" | "accepted" | "passed" | "expired";
  group_size_preference_snapshot: { min: number; max: number } | null;
  expires_at: string;
  activity_key: string;
  proposed_time_window: string;
};

class InMemoryLinkupQuorumRepository implements LinkupQuorumRepository {
  readonly invitations: TestInvitation[];
  readonly activityDisplayName: string | null;
  readonly lockCalls: Array<{
    linkupId: string;
    confirmationMessage: string;
    smsEncryptionKey: string;
    nowIso: string;
  }> = [];
  lockStatus: "locked" | "already_locked" | "not_broadcasting" | "not_found" = "locked";

  constructor(input: {
    invitations: TestInvitation[];
    activityDisplayName?: string | null;
    lockStatus?: "locked" | "already_locked" | "not_broadcasting" | "not_found";
  }) {
    this.invitations = input.invitations;
    this.activityDisplayName = input.activityDisplayName ?? "Board Game Night";
    if (input.lockStatus) {
      this.lockStatus = input.lockStatus;
    }
  }

  async fetchLinkupInvitations() {
    return this.invitations;
  }

  async fetchActivityDisplayName() {
    return this.activityDisplayName;
  }

  async lockLinkupQuorum(input: {
    linkupId: string;
    confirmationMessage: string;
    smsEncryptionKey: string;
    nowIso: string;
  }) {
    this.lockCalls.push(input);
    return { status: this.lockStatus };
  }
}

describe("evaluateLinkupQuorumWithRepository", () => {
  it("locks when accepted users satisfy their preferences and no pending invitations remain", async () => {
    const repository = new InMemoryLinkupQuorumRepository({
      invitations: [
        buildAcceptedInvitation("user-1", { min: 2, max: 5 }),
        buildAcceptedInvitation("user-2", { min: 2, max: 5 }),
        buildAcceptedInvitation("user-3", { min: 2, max: 5 }),
      ],
    });

    const result = await evaluateLinkupQuorumWithRepository({
      linkupId: "linkup-1",
      repository,
      smsEncryptionKey: "sms-key",
      now: () => new Date("2026-03-13T17:00:00.000Z"),
    });

    expect(result).toEqual({ locked: true, acceptedCount: 3 });
    expect(repository.lockCalls).toHaveLength(1);
    expect(repository.lockCalls[0]).toEqual({
      linkupId: "linkup-1",
      confirmationMessage:
        "You're confirmed for Board Game Night with 2 other people this Saturday afternoon. JOSH will send a reminder closer to the time.",
      smsEncryptionKey: "sms-key",
      nowIso: "2026-03-13T17:00:00.000Z",
    });
  });

  it("uses the conflict fallback and locks at two when no pending invitations remain", async () => {
    const repository = new InMemoryLinkupQuorumRepository({
      invitations: [
        buildAcceptedInvitation("user-1", { min: 2, max: 3 }),
        buildAcceptedInvitation("user-2", { min: 4, max: 8 }),
      ],
    });

    const result = await evaluateLinkupQuorumWithRepository({
      linkupId: "linkup-1",
      repository,
      smsEncryptionKey: "sms-key",
    });

    expect(result).toEqual({ locked: true, acceptedCount: 2 });
    expect(repository.lockCalls).toHaveLength(1);
  });

  it("returns still_pending when accepted users satisfy preferences but pending invitations remain", async () => {
    const repository = new InMemoryLinkupQuorumRepository({
      invitations: [
        buildAcceptedInvitation("user-1", { min: 2, max: 5 }),
        buildAcceptedInvitation("user-2", { min: 2, max: 5 }),
        buildPendingInvitation("user-3"),
      ],
    });

    const result = await evaluateLinkupQuorumWithRepository({
      linkupId: "linkup-1",
      repository,
      smsEncryptionKey: "sms-key",
    });

    expect(result).toEqual({ locked: false, reason: "still_pending" });
    expect(repository.lockCalls).toHaveLength(0);
  });

  it("returns min_not_met when fewer than two invitations were accepted", async () => {
    const repository = new InMemoryLinkupQuorumRepository({
      invitations: [
        buildAcceptedInvitation("user-1", { min: 2, max: 5 }),
      ],
    });

    const result = await evaluateLinkupQuorumWithRepository({
      linkupId: "linkup-1",
      repository,
      smsEncryptionKey: "sms-key",
    });

    expect(result).toEqual({ locked: false, reason: "min_not_met" });
    expect(repository.lockCalls).toHaveLength(0);
  });

  it("returns preferences_not_satisfied while pending invitations remain", async () => {
    const repository = new InMemoryLinkupQuorumRepository({
      invitations: [
        buildAcceptedInvitation("user-1", { min: 4, max: 6 }),
        buildAcceptedInvitation("user-2", { min: 4, max: 6 }),
        buildPendingInvitation("user-3"),
      ],
    });

    const result = await evaluateLinkupQuorumWithRepository({
      linkupId: "linkup-1",
      repository,
      smsEncryptionKey: "sms-key",
    });

    expect(result).toEqual({ locked: false, reason: "preferences_not_satisfied" });
    expect(repository.lockCalls).toHaveLength(0);
  });

  it("treats an already-locked rpc result as a successful idempotent lock", async () => {
    const repository = new InMemoryLinkupQuorumRepository({
      invitations: [
        buildAcceptedInvitation("user-1", { min: 2, max: 5 }),
        buildAcceptedInvitation("user-2", { min: 2, max: 5 }),
      ],
      lockStatus: "already_locked",
    });

    const result = await evaluateLinkupQuorumWithRepository({
      linkupId: "linkup-1",
      repository,
      smsEncryptionKey: "sms-key",
    });

    expect(result).toEqual({ locked: true, acceptedCount: 2 });
    expect(repository.lockCalls).toHaveLength(1);
  });
});

function buildAcceptedInvitation(
  userId: string,
  preference: { min: number; max: number } | null,
): TestInvitation {
  return {
    id: `invite-${userId}`,
    user_id: userId,
    state: "accepted",
    group_size_preference_snapshot: preference,
    expires_at: "2026-03-20T00:00:00.000Z",
    activity_key: "board_game_night",
    proposed_time_window: "this Saturday afternoon",
  };
}

function buildPendingInvitation(userId: string): TestInvitation {
  return {
    id: `invite-${userId}`,
    user_id: userId,
    state: "pending",
    group_size_preference_snapshot: { min: 2, max: 5 },
    expires_at: "2026-03-20T00:00:00.000Z",
    activity_key: "board_game_night",
    proposed_time_window: "this Saturday afternoon",
  };
}
