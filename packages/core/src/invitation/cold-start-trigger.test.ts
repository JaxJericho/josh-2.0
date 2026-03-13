import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createServiceRoleDbClientMock,
  logEventMock,
} = vi.hoisted(() => ({
  createServiceRoleDbClientMock: vi.fn(),
  logEventMock: vi.fn(),
}));

vi.mock("../../../db/src/client-node.mjs", () => ({
  createServiceRoleDbClient: createServiceRoleDbClientMock,
}));

vi.mock("../observability/logger.ts", () => ({
  logEvent: logEventMock,
}));

import { enqueueColdStartInvitation } from "./cold-start-trigger";

function buildDbClient(input?: {
  invitationId?: string | null;
}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: input?.invitationId ? { id: input.invitationId } : null,
    error: null,
  });
  const limit = vi.fn(() => ({ maybeSingle }));
  const gte = vi.fn(() => ({ limit }));
  const eq = vi.fn(() => ({ gte }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return {
    db: { from },
    from,
    maybeSingle,
  };
}

describe("enqueueColdStartInvitation", () => {
  beforeEach(() => {
    vi.stubEnv("QSTASH_TOKEN", "qstash-token");
    vi.stubEnv("APP_BASE_URL", "https://example.test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn().mockResolvedValue(""),
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns without publishing when the user already has a recent invitation", async () => {
    const dbClient = buildDbClient({
      invitationId: "33333333-3333-3333-3333-333333333333",
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await enqueueColdStartInvitation("11111111-1111-1111-1111-111111111111");

    expect(fetch).not.toHaveBeenCalled();
    expect(logEventMock).toHaveBeenCalledWith({
      event: "cold_start.recent_invitation_skip",
      user_id: "11111111-1111-1111-1111-111111111111",
      payload: {
        userId: "11111111-1111-1111-1111-111111111111",
      },
    });
  });

  it("publishes one delayed qstash message when no recent invitation exists", async () => {
    const dbClient = buildDbClient();
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await enqueueColdStartInvitation("11111111-1111-1111-1111-111111111111");

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(
      "https://qstash.upstash.io/v2/publish/https://example.test/api/invitations/cold-start",
    );
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({
      userId: "11111111-1111-1111-1111-111111111111",
    }));

    const delayHeader = (init?.headers as Record<string, string>)["Upstash-Delay"];
    expect(delayHeader).toMatch(/^\d+s$/);
    const delaySeconds = Number.parseInt(delayHeader.replace("s", ""), 10);
    expect(delaySeconds).toBeGreaterThanOrEqual(3600);
    expect(delaySeconds).toBeLessThanOrEqual(82800);
  });
});
