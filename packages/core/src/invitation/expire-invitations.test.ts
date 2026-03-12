import { describe, expect, it } from "vitest";

import {
  createSupabaseInvitationExpiryRepository,
  expireStaleInvitations,
  type ExpirableInvitation,
  type ExpireInvitationResult,
  type InvitationExpiryLogInput,
  type InvitationExpiryRepository,
} from "./expire-invitations";

type MutableInvitation = ExpirableInvitation & {
  state: "pending" | "expired";
};

class InMemoryInvitationExpiryRepository implements InvitationExpiryRepository {
  readonly invitations: MutableInvitation[];
  readonly sessionModes = new Map<string, string>();
  readonly backoffCounts = new Map<string, number>();
  readonly learningSignals: string[] = [];
  readonly failureIds = new Set<string>();

  constructor(input: {
    invitations: MutableInvitation[];
    sessionModes?: Record<string, string>;
    backoffCounts?: Record<string, number>;
    failureIds?: string[];
  }) {
    this.invitations = input.invitations;
    for (const [userId, mode] of Object.entries(input.sessionModes ?? {})) {
      this.sessionModes.set(userId, mode);
    }
    for (const [userId, count] of Object.entries(input.backoffCounts ?? {})) {
      this.backoffCounts.set(userId, count);
    }
    for (const invitationId of input.failureIds ?? []) {
      this.failureIds.add(invitationId);
    }
  }

  async fetchStaleInvitations({ limit, nowIso }: { limit: number; nowIso: string }) {
    return this.invitations
      .filter((invitation) =>
        invitation.state === "pending" &&
        invitation.expires_at <= nowIso
      )
      .sort((left, right) => {
        if (left.expires_at === right.expires_at) {
          return left.id.localeCompare(right.id);
        }
        return left.expires_at.localeCompare(right.expires_at);
      })
      .slice(0, limit)
      .map((invitation) => ({
        id: invitation.id,
        user_id: invitation.user_id,
        invitation_type: invitation.invitation_type,
        activity_key: invitation.activity_key,
        time_window: invitation.time_window,
        expires_at: invitation.expires_at,
      }));
  }

  async expireInvitation({ invitationId }: {
    invitationId: string;
    correlationId: string;
    nowIso: string;
  }): Promise<ExpireInvitationResult> {
    const invitation = this.invitations.find((candidate) => candidate.id === invitationId);
    if (!invitation) {
      throw new Error(`Unknown invitation ${invitationId}`);
    }

    if (this.failureIds.has(invitationId)) {
      throw new Error(`simulated failure for ${invitationId}`);
    }

    if (invitation.state !== "pending") {
      return {
        expired: false,
        reason: "already_expired",
      };
    }

    invitation.state = "expired";

    const signalKey = `invitation_expired:${invitation.id}`;
    if (!this.learningSignals.includes(signalKey)) {
      this.learningSignals.push(signalKey);
    }

    if (this.sessionModes.get(invitation.user_id) === "awaiting_invitation_response") {
      this.sessionModes.set(invitation.user_id, "idle");
    }

    this.backoffCounts.set(
      invitation.user_id,
      (this.backoffCounts.get(invitation.user_id) ?? 0) + 1,
    );

    return {
      expired: true,
      reason: "expired",
    };
  }
}

describe("expireStaleInvitations", () => {
  it("expires stale invitations in batches and writes learning side effects", async () => {
    const repository = new InMemoryInvitationExpiryRepository({
      invitations: [
        buildInvitation("11111111-1111-1111-1111-111111111111", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        buildInvitation("22222222-2222-2222-2222-222222222222", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
        buildInvitation("33333333-3333-3333-3333-333333333333", "cccccccc-cccc-cccc-cccc-cccccccccccc"),
      ],
      sessionModes: {
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa": "awaiting_invitation_response",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb": "awaiting_invitation_response",
        "cccccccc-cccc-cccc-cccc-cccccccccccc": "awaiting_invitation_response",
      },
    });

    const result = await expireStaleInvitations({
      repository,
      correlationId: "99999999-9999-9999-9999-999999999999",
      now: () => new Date("2026-03-12T12:00:00.000Z"),
    });

    expect(result).toEqual({ expiredCount: 3 });
    expect(repository.invitations.map((invitation) => invitation.state)).toEqual([
      "expired",
      "expired",
      "expired",
    ]);
    expect(repository.learningSignals).toHaveLength(3);
    expect(repository.backoffCounts.get("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).toBe(1);
    expect(repository.backoffCounts.get("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")).toBe(1);
    expect(repository.backoffCounts.get("cccccccc-cccc-cccc-cccc-cccccccccccc")).toBe(1);
  });

  it("only resets awaiting_invitation_response sessions", async () => {
    const repository = new InMemoryInvitationExpiryRepository({
      invitations: [
        buildInvitation("11111111-1111-1111-1111-111111111111", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        buildInvitation("22222222-2222-2222-2222-222222222222", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
      ],
      sessionModes: {
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa": "awaiting_invitation_response",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb": "post_event",
      },
    });

    await expireStaleInvitations({
      repository,
      correlationId: "99999999-9999-9999-9999-999999999999",
      now: () => new Date("2026-03-12T12:00:00.000Z"),
    });

    expect(repository.sessionModes.get("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).toBe("idle");
    expect(repository.sessionModes.get("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")).toBe("post_event");
  });

  it("does not count or duplicate side effects when the invitation was already expired", async () => {
    const seenSignals = ["invitation_expired:11111111-1111-1111-1111-111111111111"];
    const repository: InvitationExpiryRepository = {
      async fetchStaleInvitations() {
        return [
          buildInvitation("11111111-1111-1111-1111-111111111111", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        ];
      },
      async expireInvitation() {
        return {
          expired: false,
          reason: "already_expired",
        };
      },
    };

    const result = await expireStaleInvitations({
      repository,
      correlationId: "99999999-9999-9999-9999-999999999999",
      now: () => new Date("2026-03-12T12:00:00.000Z"),
    });

    expect(result).toEqual({ expiredCount: 0 });
    expect(seenSignals).toEqual([
      "invitation_expired:11111111-1111-1111-1111-111111111111",
    ]);
  });

  it("continues after an individual invitation failure and counts only successful expiries", async () => {
    const repository = new InMemoryInvitationExpiryRepository({
      invitations: [
        buildInvitation("11111111-1111-1111-1111-111111111111", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        buildInvitation("22222222-2222-2222-2222-222222222222", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
        buildInvitation("33333333-3333-3333-3333-333333333333", "cccccccc-cccc-cccc-cccc-cccccccccccc"),
      ],
      failureIds: ["22222222-2222-2222-2222-222222222222"],
    });
    const logs: InvitationExpiryLogInput[] = [];

    const result = await expireStaleInvitations({
      repository,
      correlationId: "99999999-9999-9999-9999-999999999999",
      now: () => new Date("2026-03-12T12:00:00.000Z"),
      log: (entry) => logs.push(entry),
    });

    expect(result).toEqual({ expiredCount: 2 });
    expect(repository.invitations.find((invitation) => invitation.id === "22222222-2222-2222-2222-222222222222")?.state)
      .toBe("pending");
    expect(repository.learningSignals).toHaveLength(2);
    expect(logs.some((entry) =>
      entry.event === "system.unhandled_error" &&
      entry.payload.invitation_id === "22222222-2222-2222-2222-222222222222"
    )).toBe(true);
  });
});

describe("createSupabaseInvitationExpiryRepository", () => {
  it("fetches stale invitations and applies the expiry RPC", async () => {
    const calls: Array<{ kind: string; payload?: Record<string, unknown> }> = [];
    const queryBuilder = {
      select() {
        return queryBuilder;
      },
      eq() {
        return queryBuilder;
      },
      lte() {
        return queryBuilder;
      },
      order() {
        return queryBuilder;
      },
      limit: async () => {
        calls.push({ kind: "limit" });
        return {
          data: [buildInvitation("11111111-1111-1111-1111-111111111111", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")],
          error: null,
        };
      },
    };
    const supabase = {
      from(table: string) {
        calls.push({ kind: "from", payload: { table } });
        return queryBuilder;
      },
      async rpc(name: string, payload: Record<string, unknown>) {
        calls.push({ kind: "rpc", payload: { name, ...payload } });
        return {
          data: [{
            expired: true,
            reason: "expired",
          }],
          error: null,
        };
      },
    } as never;

    const repository = createSupabaseInvitationExpiryRepository(supabase);
    const invitations = await repository.fetchStaleInvitations({
      limit: 50,
      nowIso: "2026-03-12T12:00:00.000Z",
    });
    const result = await repository.expireInvitation({
      invitationId: "11111111-1111-1111-1111-111111111111",
      correlationId: "99999999-9999-9999-9999-999999999999",
      nowIso: "2026-03-12T12:00:00.000Z",
    });

    expect(invitations).toHaveLength(1);
    expect(result).toEqual({
      expired: true,
      reason: "expired",
    });
    expect(calls).toContainEqual({
      kind: "rpc",
      payload: {
        name: "expire_invitation",
        p_invitation_id: "11111111-1111-1111-1111-111111111111",
        p_correlation_id: "99999999-9999-9999-9999-999999999999",
        p_now: "2026-03-12T12:00:00.000Z",
      },
    });
  });
});

function buildInvitation(id: string, userId: string): MutableInvitation {
  return {
    id,
    user_id: userId,
    invitation_type: "solo",
    activity_key: "coffee_walk",
    time_window: "this Saturday afternoon",
    expires_at: "2026-03-12T11:00:00.000Z",
    state: "pending",
  };
}
