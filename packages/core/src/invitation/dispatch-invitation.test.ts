import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createServiceRoleDbClientMock,
  checkInvitationEligibilityMock,
} = vi.hoisted(() => ({
  createServiceRoleDbClientMock: vi.fn(),
  checkInvitationEligibilityMock: vi.fn(),
}));

vi.mock("../../../db/src/client-node.mjs", () => ({
  createServiceRoleDbClient: createServiceRoleDbClientMock,
}));

vi.mock("./frequency-guard.ts", () => ({
  checkInvitationEligibility: checkInvitationEligibilityMock,
}));

import {
  __private__,
  dispatchInvitation,
  type DispatchParams,
} from "./dispatch-invitation";

type MaybeSingleResult = {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
};

function buildDbClient(fixtures?: {
  invitationId?: string | null;
  user?: Record<string, unknown> | null;
  activityCatalog?: Record<string, unknown> | null;
  rpcResult?: Record<string, unknown> | null;
}) {
  const rpc = vi.fn().mockResolvedValue({
    data: fixtures?.rpcResult ?? {
      invitation_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      dispatched: true,
      reason: null,
    },
    error: null,
  });

  function buildMaybeSingle(result: MaybeSingleResult) {
    return vi.fn().mockResolvedValue(result);
  }

  const invitationsMaybeSingle = buildMaybeSingle({
    data: fixtures?.invitationId ? { id: fixtures.invitationId } : null,
    error: null,
  });
  const usersMaybeSingle = buildMaybeSingle({
    data: fixtures?.user ?? {
      first_name: "Alex",
      region_id: null,
    },
    error: null,
  });
  const activityMaybeSingle = buildMaybeSingle({
    data: fixtures?.activityCatalog === undefined ? {
      display_name: "Coffee Walk",
    } : fixtures.activityCatalog,
    error: null,
  });

  const from = vi.fn((table: string) => {
    if (table === "invitations") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: invitationsMaybeSingle,
          })),
        })),
      };
    }

    if (table === "users") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: usersMaybeSingle,
          })),
        })),
      };
    }

    if (table === "activity_catalog") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: activityMaybeSingle,
          })),
        })),
      };
    }

    throw new Error(`Unexpected table '${table}'.`);
  });

  return {
    db: {
      from,
      rpc,
    },
    rpc,
    from,
  };
}

function buildParams(overrides: Partial<DispatchParams> = {}): DispatchParams {
  return {
    userId: "11111111-1111-1111-1111-111111111111",
    invitationType: "solo",
    activityKey: "coffee_walk",
    proposedTimeWindow: "this Saturday afternoon",
    correlationId: "22222222-2222-2222-2222-222222222222",
    ...overrides,
  };
}

describe("dispatchInvitation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("SMS_BODY_ENCRYPTION_KEY", "test-key");
    vi.setSystemTime(new Date("2026-03-13T19:00:00.000Z"));
    checkInvitationEligibilityMock.mockResolvedValue({ eligible: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns eligibility_gate before creating a db client", async () => {
    checkInvitationEligibilityMock.mockResolvedValue({
      eligible: false,
      reason: "eligibility_gate",
    });

    await expect(dispatchInvitation(buildParams())).resolves.toEqual({
      dispatched: false,
      reason: "eligibility_gate",
    });

    expect(createServiceRoleDbClientMock).not.toHaveBeenCalled();
  });

  it("returns already_invited_this_week when the idempotency key already exists", async () => {
    const dbClient = buildDbClient({
      invitationId: "33333333-3333-3333-3333-333333333333",
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(dispatchInvitation(buildParams())).resolves.toEqual({
      dispatched: false,
      reason: "already_invited_this_week",
    });

    expect(dbClient.rpc).not.toHaveBeenCalled();
  });

  it("returns quiet_hours when local time is 23:00 in the fallback timezone", async () => {
    const dbClient = buildDbClient();
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);
    vi.setSystemTime(new Date("2026-03-14T06:00:00.000Z"));

    await expect(dispatchInvitation(buildParams())).resolves.toEqual({
      dispatched: false,
      reason: "quiet_hours",
    });

    expect(dbClient.rpc).not.toHaveBeenCalled();
  });

  it("dispatches successfully at the 08:00 quiet-hours boundary", async () => {
    const dbClient = buildDbClient();
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);
    vi.setSystemTime(new Date("2026-03-13T15:00:00.000Z"));

    await expect(dispatchInvitation(buildParams())).resolves.toEqual({
      dispatched: true,
      invitationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });

    expect(dbClient.rpc).toHaveBeenCalledTimes(1);
  });

  it("maps weekly-cap duplicate protection from the rpc when a concurrent insert wins", async () => {
    const dbClient = buildDbClient({
      rpcResult: {
        invitation_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        dispatched: false,
        reason: "already_invited_this_week",
      },
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(dispatchInvitation(buildParams())).resolves.toEqual({
      dispatched: false,
      reason: "already_invited_this_week",
    });
  });

  it("builds the exact solo sms copy for the rpc payload", async () => {
    const dbClient = buildDbClient();
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await dispatchInvitation(buildParams());

    expect(dbClient.rpc).toHaveBeenCalledWith("dispatch_invitation", expect.objectContaining({
      p_outbound_message:
        "Hey Alex — JOSH found something for you: Coffee Walk this Saturday afternoon. Interested? Reply YES to confirm or PASS to skip.",
    }));
  });

  it("builds the exact linkup sms copy and requires linkupId", async () => {
    const dbClient = buildDbClient({
      activityCatalog: { display_name: "Board Game Night" },
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await dispatchInvitation(buildParams({
      invitationType: "linkup",
      linkupId: "44444444-4444-4444-4444-444444444444",
      activityKey: "board_game_night",
    }));

    expect(dbClient.rpc).toHaveBeenCalledWith("dispatch_invitation", expect.objectContaining({
      p_invitation_type: "linkup",
      p_linkup_id: "44444444-4444-4444-4444-444444444444",
      p_outbound_message:
        "Hey Alex — JOSH found a group activity that fits you: Board Game Night this Saturday afternoon with a small group. Reply YES to join or PASS to skip.",
    }));
  });

  it("falls back to a title-cased activity key when display_name is unavailable", async () => {
    const dbClient = buildDbClient({
      activityCatalog: null,
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await dispatchInvitation(buildParams({
      activityKey: "late_night_dessert",
    }));

    expect(dbClient.rpc).toHaveBeenCalledWith("dispatch_invitation", expect.objectContaining({
      p_outbound_message:
        "Hey Alex — JOSH found something for you: Late Night Dessert this Saturday afternoon. Interested? Reply YES to confirm or PASS to skip.",
    }));
  });
});

describe("dispatch invitation helpers", () => {
  it("formats iso weeks deterministically", () => {
    expect(__private__.formatIsoWeek(new Date("2026-03-13T12:00:00.000Z"))).toBe("2026-W11");
  });

  it("treats 22:00-07:59 as quiet hours", () => {
    expect(__private__.isQuietHours(new Date("2026-03-14T05:00:00.000Z"), "America/Los_Angeles"))
      .toBe(true);
    expect(__private__.isQuietHours(new Date("2026-03-13T15:00:00.000Z"), "America/Los_Angeles"))
      .toBe(false);
  });
});
