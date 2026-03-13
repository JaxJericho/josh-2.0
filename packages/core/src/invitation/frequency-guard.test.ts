import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createServiceRoleDbClientMock,
  createSupabaseEligibilityRepositoryMock,
  evaluateEligibilityMock,
} = vi.hoisted(() => ({
  createServiceRoleDbClientMock: vi.fn(),
  createSupabaseEligibilityRepositoryMock: vi.fn((db) => ({ db })),
  evaluateEligibilityMock: vi.fn(),
}));

vi.mock("../../../db/src/client-node.mjs", () => ({
  createServiceRoleDbClient: createServiceRoleDbClientMock,
}));

vi.mock("../entitlements/evaluate-eligibility.ts", () => ({
  createSupabaseEligibilityRepository: createSupabaseEligibilityRepositoryMock,
  evaluateEligibility: evaluateEligibilityMock,
}));

import {
  checkInvitationEligibility,
} from "./frequency-guard";
import {
  INVITATION_BACKOFF_THRESHOLD,
  INVITATION_WEEKLY_CAP,
} from "./constants";

type MockUserInvitationState = {
  last_invited_at: string | null;
  invitation_week_start: string | null;
  invitation_count_this_week: number;
  invitation_backoff_count: number;
};

function buildDbClient(userState: MockUserInvitationState) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: userState,
    error: null,
  });
  const eq = vi.fn(() => ({
    maybeSingle,
  }));
  const select = vi.fn(() => ({
    eq,
  }));
  const from = vi.fn(() => ({
    select,
  }));

  return {
    db: { from },
    from,
    select,
    eq,
    maybeSingle,
  };
}

function buildUserState(
  overrides: Partial<MockUserInvitationState> = {},
): MockUserInvitationState {
  return {
    last_invited_at: null,
    invitation_week_start: null,
    invitation_count_this_week: 0,
    invitation_backoff_count: 0,
    ...overrides,
  };
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("checkInvitationEligibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T12:00:00.000Z"));
    evaluateEligibilityMock.mockResolvedValue({ eligible: true });
    createSupabaseEligibilityRepositoryMock.mockImplementation((db) => ({ db }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("returns eligibility_gate when evaluateEligibility denies the user", async () => {
    const dbClient = buildDbClient(buildUserState());
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);
    evaluateEligibilityMock.mockResolvedValue({
      eligible: false,
      reason: "INELIGIBLE_SAFETY_HOLD",
    });

    await expect(checkInvitationEligibility("usr_gate_blocked")).resolves.toEqual({
      eligible: false,
      reason: "eligibility_gate",
    });

    expect(dbClient.from).not.toHaveBeenCalled();
  });

  it("returns cooldown when the user was invited 25 hours ago", async () => {
    const dbClient = buildDbClient(buildUserState({
      last_invited_at: isoHoursAgo(25),
    }));
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(checkInvitationEligibility("usr_cooldown")).resolves.toEqual({
      eligible: false,
      reason: "cooldown",
    });
  });

  it("passes the cooldown check when the user was invited 49 hours ago", async () => {
    const dbClient = buildDbClient(buildUserState({
      last_invited_at: isoHoursAgo(49),
    }));
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(checkInvitationEligibility("usr_cooldown_boundary")).resolves.toEqual({
      eligible: true,
    });
  });

  it("returns weekly_cap when the rolling window is active and count is at the cap", async () => {
    const dbClient = buildDbClient(buildUserState({
      invitation_week_start: isoDaysAgo(6),
      invitation_count_this_week: INVITATION_WEEKLY_CAP,
    }));
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(checkInvitationEligibility("usr_weekly_cap")).resolves.toEqual({
      eligible: false,
      reason: "weekly_cap",
    });
  });

  it("keeps the weekly cap active exactly at the 7 day boundary", async () => {
    const dbClient = buildDbClient(buildUserState({
      invitation_week_start: isoDaysAgo(7),
      invitation_count_this_week: INVITATION_WEEKLY_CAP,
    }));
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(checkInvitationEligibility("usr_weekly_cap_boundary")).resolves.toEqual({
      eligible: false,
      reason: "weekly_cap",
    });
  });

  it("ignores the weekly count when the rolling window expired 8 days ago", async () => {
    const dbClient = buildDbClient(buildUserState({
      invitation_week_start: isoDaysAgo(8),
      invitation_count_this_week: INVITATION_WEEKLY_CAP,
    }));
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(checkInvitationEligibility("usr_weekly_reset")).resolves.toEqual({
      eligible: true,
    });
  });

  it("returns backoff_suppressed when the user reached the backoff threshold", async () => {
    const dbClient = buildDbClient(buildUserState({
      invitation_backoff_count: INVITATION_BACKOFF_THRESHOLD,
    }));
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(checkInvitationEligibility("usr_backoff")).resolves.toEqual({
      eligible: false,
      reason: "backoff_suppressed",
    });
  });

  it("passes the backoff check when the count is below the threshold", async () => {
    const dbClient = buildDbClient(buildUserState({
      invitation_backoff_count: INVITATION_BACKOFF_THRESHOLD - 1,
    }));
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(checkInvitationEligibility("usr_backoff_boundary")).resolves.toEqual({
      eligible: true,
    });
  });

  it("returns eligible when all checks pass and uses the invitation action_type", async () => {
    const dbClient = buildDbClient(buildUserState());
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(checkInvitationEligibility("usr_eligible")).resolves.toEqual({
      eligible: true,
    });

    expect(createSupabaseEligibilityRepositoryMock).toHaveBeenCalledWith(dbClient.db);
    expect(evaluateEligibilityMock).toHaveBeenCalledWith({
      userId: "usr_eligible",
      action_type: "can_receive_invitation",
      repository: { db: dbClient.db },
    });
  });

  it("fails fast in the documented order after the eligibility gate", async () => {
    const dbClient = buildDbClient(buildUserState({
      last_invited_at: isoHoursAgo(25),
      invitation_week_start: isoDaysAgo(6),
      invitation_count_this_week: INVITATION_WEEKLY_CAP,
      invitation_backoff_count: INVITATION_BACKOFF_THRESHOLD,
    }));
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(checkInvitationEligibility("usr_ordered")).resolves.toEqual({
      eligible: false,
      reason: "cooldown",
    });
  });
});
