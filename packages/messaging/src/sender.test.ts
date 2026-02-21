import { describe, expect, it, vi } from "vitest";
import { TwilioClientError, type TwilioClient } from "./client";
import { SendSmsError, sendSms } from "./sender";
import type { SmsMessagePersistence } from "./types";

type StoredMessage = {
  messageId: string;
  idempotencyKey: string;
  fromE164: string;
  twilioMessageSid: string | null;
  status: string;
};

function createInMemoryPersistence(): {
  persistence: SmsMessagePersistence;
  state: {
    rows: StoredMessage[];
    inserts: number;
    finalized: number;
  };
} {
  const rows: StoredMessage[] = [];
  let inserts = 0;
  let finalized = 0;

  return {
    persistence: {
      async findDeliveredByIdempotencyKey(idempotencyKey: string) {
        const row = rows.find((entry) =>
          entry.idempotencyKey === idempotencyKey && entry.twilioMessageSid,
        );

        if (!row || !row.twilioMessageSid) {
          return null;
        }

        return {
          messageId: row.messageId,
          twilioMessageSid: row.twilioMessageSid,
          status: row.status,
          fromE164: row.fromE164,
        };
      },

      async findPendingByIdempotencyKey(idempotencyKey: string) {
        const row = rows.find((entry) =>
          entry.idempotencyKey === idempotencyKey && !entry.twilioMessageSid,
        );
        return row ? { messageId: row.messageId } : null;
      },

      async insertPending(input) {
        inserts += 1;
        const messageId = `msg_${rows.length + 1}`;
        rows.push({
          messageId,
          idempotencyKey: input.idempotencyKey,
          fromE164: input.fromE164,
          twilioMessageSid: null,
          status: input.status,
        });
        return { messageId };
      },

      async finalizeSent(input) {
        finalized += 1;
        const row = rows.find((entry) => entry.messageId === input.messageId);
        if (!row) {
          throw new Error("Missing row.");
        }
        row.twilioMessageSid = input.twilioMessageSid;
        row.status = input.status;
        row.fromE164 = input.fromE164;
      },
    },
    state: {
      rows,
      get inserts() {
        return inserts;
      },
      get finalized() {
        return finalized;
      },
    },
  };
}

describe("sendSms", () => {
  it("enforces idempotency for repeated idempotency keys", async () => {
    const { persistence, state } = createInMemoryPersistence();
    const sendMessage = vi.fn().mockResolvedValue({
      sid: "SM_123",
      status: "queued",
      from: "+15555550123",
    });

    const client: TwilioClient = {
      sendMessage,
      fetchMessageBySid: vi.fn(),
    };

    const first = await sendSms({
      client,
      persistence,
      to: "+15555550001",
      from: "+15555550123",
      body: "Hello",
      correlationId: "corr_1",
      purpose: "onboarding_message_1",
      idempotencyKey: "idem_1",
    });

    const second = await sendSms({
      client,
      persistence,
      to: "+15555550001",
      from: "+15555550123",
      body: "Hello",
      correlationId: "corr_1",
      purpose: "onboarding_message_1",
      idempotencyKey: "idem_1",
    });

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(state.inserts).toBe(1);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]?.twilioMessageSid).toBe("SM_123");
  });

  it("retries once on transient Twilio errors", async () => {
    const { persistence } = createInMemoryPersistence();
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new TwilioClientError({
        code: "RESPONSE",
        message: "Twilio unavailable",
        statusCode: 503,
        retryable: true,
      }))
      .mockResolvedValueOnce({
        sid: "SM_456",
        status: "sent",
        from: "+15555550123",
      });

    const result = await sendSms({
      client: {
        sendMessage,
        fetchMessageBySid: vi.fn(),
      },
      persistence,
      to: "+15555550002",
      from: "+15555550123",
      body: "Retry message",
      correlationId: "corr_retry",
      purpose: "retry_test",
      idempotencyKey: "idem_retry",
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(result.twilioMessageSid).toBe("SM_456");
    expect(result.attempts).toBe(2);
  });

  it("does not retry on 4xx Twilio errors", async () => {
    const { persistence } = createInMemoryPersistence();
    const sendMessage = vi.fn().mockRejectedValue(
      new TwilioClientError({
        code: "RESPONSE",
        message: "Invalid destination",
        statusCode: 400,
        retryable: false,
      }),
    );

    await expect(
      sendSms({
        client: {
          sendMessage,
          fetchMessageBySid: vi.fn(),
        },
        persistence,
        to: "+15555550003",
        from: "+15555550123",
        body: "4xx message",
        correlationId: "corr_4xx",
        purpose: "invalid_number",
        idempotencyKey: "idem_4xx",
      }),
    ).rejects.toMatchObject({
      name: SendSmsError.name,
      statusCode: 400,
      retryable: false,
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("fails fast when legacy region_launch_notify contract is requested", async () => {
    const { persistence } = createInMemoryPersistence();
    const client: TwilioClient = {
      sendMessage: vi.fn(),
      fetchMessageBySid: vi.fn(),
    };

    await expect(
      sendSms({
        client,
        persistence,
        to: "+15555550004",
        from: "+15555550123",
        body: "legacy",
        correlationId: "corr_legacy_purpose",
        purpose: "region_launch_notify",
        idempotencyKey: "waitlist_activation_onboarding:reg:profile:onboarding_opening",
      }),
    ).rejects.toThrow("Legacy region_launch_notify purpose is forbidden.");

    await expect(
      sendSms({
        client,
        persistence,
        to: "+15555550004",
        from: "+15555550123",
        body: "legacy",
        correlationId: "corr_legacy_idem",
        purpose: "onboarding_opening",
        idempotencyKey: "region_launch_notify:reg:profile:v1",
      }),
    ).rejects.toThrow("Legacy region_launch_notify idempotency keys are forbidden.");

    expect(client.sendMessage).not.toHaveBeenCalled();
  });
});
