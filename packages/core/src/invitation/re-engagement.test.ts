import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createServiceRoleDbClientMock } = vi.hoisted(() => ({
  createServiceRoleDbClientMock: vi.fn(),
}));

vi.mock("../../../db/src/client-node.mjs", () => ({
  createServiceRoleDbClient: createServiceRoleDbClientMock,
}));

import {
  createSupabaseReEngagementRepository,
  sendReEngagementMessage,
  sendReEngagementMessageWithRepository,
} from "./re-engagement";
import { INVITATION_BACKOFF_THRESHOLD } from "./constants";

function buildDbClient(row: Record<string, unknown>) {
  const rpc = vi.fn().mockResolvedValue({
    data: [row],
    error: null,
  });

  return {
    db: { rpc },
    rpc,
  };
}

describe("sendReEngagementMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T12:00:00.000Z"));
    vi.stubEnv("SMS_BODY_ENCRYPTION_KEY", "sms-key");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns sent=true when the threshold is met and the rpc succeeds", async () => {
    const dbClient = buildDbClient({
      sent: true,
      user_id: "usr_threshold_met",
      reason: null,
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(sendReEngagementMessage("usr_threshold_met")).resolves.toEqual({
      sent: true,
      userId: "usr_threshold_met",
    });

    expect(dbClient.rpc).toHaveBeenCalledWith(
      "send_reengagement_message",
      expect.objectContaining({
        p_user_id: "usr_threshold_met",
        p_threshold: INVITATION_BACKOFF_THRESHOLD,
        p_state_token: "interview:awaiting_next_input",
        p_sms_encryption_key: "sms-key",
      }),
    );
  });

  it("returns threshold_not_met when the user is below the backoff boundary", async () => {
    const dbClient = buildDbClient({
      sent: false,
      user_id: null,
      reason: "threshold_not_met",
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(sendReEngagementMessage("usr_boundary")).resolves.toEqual({
      sent: false,
      reason: "threshold_not_met",
    });
  });

  it("returns safety_hold when the user has an active hold", async () => {
    const dbClient = buildDbClient({
      sent: false,
      user_id: null,
      reason: "safety_hold",
    });
    createServiceRoleDbClientMock.mockReturnValue(dbClient.db);

    await expect(sendReEngagementMessage("usr_safety_hold")).resolves.toEqual({
      sent: false,
      reason: "safety_hold",
    });
  });

  it("allows the runner to supply a repository and encryption key explicitly", async () => {
    const repository = {
      sendReEngagementMessage: vi.fn().mockResolvedValue({
        sent: true,
        userId: "usr_runner",
      }),
    };

    await expect(
      sendReEngagementMessageWithRepository({
        userId: "usr_runner",
        repository,
        smsEncryptionKey: "runner-key",
      }),
    ).resolves.toEqual({
      sent: true,
      userId: "usr_runner",
    });

    expect(repository.sendReEngagementMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "usr_runner",
        threshold: INVITATION_BACKOFF_THRESHOLD,
        smsEncryptionKey: "runner-key",
      }),
    );
  });
});

describe("createSupabaseReEngagementRepository", () => {
  it("throws when the rpc returns no row", async () => {
    const repository = createSupabaseReEngagementRepository({
      rpc: vi.fn().mockResolvedValue({
        data: [],
        error: null,
      }),
    } as never);

    await expect(
      repository.sendReEngagementMessage({
        userId: "usr_empty",
        threshold: INVITATION_BACKOFF_THRESHOLD,
        messageTemplate: "message",
        smsEncryptionKey: "sms-key",
        stateToken: "interview:awaiting_next_input",
        nowIso: "2026-03-13T12:00:00.000Z",
      }),
    ).rejects.toThrow("send_reengagement_message RPC returned no result row.");
  });
});
