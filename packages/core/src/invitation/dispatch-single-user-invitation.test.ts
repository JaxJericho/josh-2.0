import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  dispatchInvitationMock,
  logEventMock,
  selectSoloInvitationMock,
} = vi.hoisted(() => ({
  dispatchInvitationMock: vi.fn(),
  logEventMock: vi.fn(),
  selectSoloInvitationMock: vi.fn(),
}));

vi.mock("./dispatch-invitation.ts", () => ({
  dispatchInvitation: dispatchInvitationMock,
}));

vi.mock("./solo-invitation-selector.ts", () => ({
  selectSoloInvitation: selectSoloInvitationMock,
}));

vi.mock("../observability/logger.ts", () => ({
  logEvent: logEventMock,
}));

import { dispatchSingleUserInvitation } from "./dispatch-single-user-invitation";

describe("dispatchSingleUserInvitation", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "99999999-9999-9999-9999-999999999999"),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("dispatches a solo invitation when the selector returns a candidate", async () => {
    selectSoloInvitationMock.mockResolvedValue({
      activityKey: "coffee_walk",
      proposedTimeWindow: "this Saturday afternoon",
      locationHint: "Capitol Hill",
    });

    await dispatchSingleUserInvitation("11111111-1111-1111-1111-111111111111");

    expect(dispatchInvitationMock).toHaveBeenCalledWith({
      userId: "11111111-1111-1111-1111-111111111111",
      invitationType: "solo",
      activityKey: "coffee_walk",
      proposedTimeWindow: "this Saturday afternoon",
      locationHint: "Capitol Hill",
      correlationId: "99999999-9999-9999-9999-999999999999",
    });
    expect(logEventMock).not.toHaveBeenCalled();
  });

  it("logs a data gap and does not throw when no activity is available", async () => {
    selectSoloInvitationMock.mockResolvedValue(null);

    await expect(
      dispatchSingleUserInvitation("11111111-1111-1111-1111-111111111111"),
    ).resolves.toBeUndefined();

    expect(dispatchInvitationMock).not.toHaveBeenCalled();
    expect(logEventMock).toHaveBeenCalledWith({
      event: "cold_start.no_activity_available",
      user_id: "11111111-1111-1111-1111-111111111111",
      payload: {
        userId: "11111111-1111-1111-1111-111111111111",
      },
    });
  });
});
