import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  dispatchSingleUserInvitationMock,
  verifyQStashSignatureMock,
} = vi.hoisted(() => ({
  dispatchSingleUserInvitationMock: vi.fn(),
  verifyQStashSignatureMock: vi.fn(),
}));

vi.mock("../packages/core/src/invitation/dispatch-single-user-invitation", () => ({
  dispatchSingleUserInvitation: dispatchSingleUserInvitationMock,
}));

vi.mock("../app/lib/qstash", () => ({
  verifyQStashSignature: verifyQStashSignatureMock,
}));

import { POST } from "../app/api/invitations/cold-start/route";

describe("cold start invitation route", () => {
  beforeEach(() => {
    verifyQStashSignatureMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("invokes dispatchSingleUserInvitation for a valid request", async () => {
    const response = await POST(new Request("https://example.test/api/invitations/cold-start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        userId: "11111111-1111-1111-1111-111111111111",
      }),
    }));

    expect(response.status).toBe(200);
    expect(dispatchSingleUserInvitationMock).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
    );
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("returns 401 when the qstash signature is invalid", async () => {
    verifyQStashSignatureMock.mockResolvedValue(false);

    const response = await POST(new Request("https://example.test/api/invitations/cold-start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        userId: "11111111-1111-1111-1111-111111111111",
      }),
    }));

    expect(response.status).toBe(401);
    expect(dispatchSingleUserInvitationMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the payload is invalid", async () => {
    const response = await POST(new Request("https://example.test/api/invitations/cold-start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(400);
    expect(dispatchSingleUserInvitationMock).not.toHaveBeenCalled();
  });
});
