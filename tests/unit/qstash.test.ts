import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@upstash/qstash";

import {
  createQStashClient,
  scheduleOnboardingStep,
  verifyQStashSignature,
} from "../../app/lib/qstash";

const ORIGINAL_ENV = { ...process.env };

describe("qstash integration layer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("verifyQStashSignature returns false for invalid signatures", async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = "current-signing-key";
    process.env.QSTASH_NEXT_SIGNING_KEY = "next-signing-key";

    const request = new Request("https://example.test/api/onboarding/step", {
      method: "POST",
      headers: {
        "upstash-signature": "invalid-signature",
        "content-type": "application/json",
      },
      body: JSON.stringify({ hello: "world" }),
    });

    await expect(verifyQStashSignature(request)).resolves.toBe(false);
  });

  it("scheduleOnboardingStep publishes the onboarding payload to the expected URL and delay", async () => {
    process.env.QSTASH_TOKEN = "qstash-token";
    process.env.APP_BASE_URL = "https://example.test";

    const publishSpy = vi.spyOn(Client.prototype, "publishJSON").mockResolvedValue({
      messageId: "msg_123",
    } as never);

    const payload = {
      profile_id: "profile_123",
      session_id: "session_123",
      step_id: "onboarding_message_1",
      expected_state_token: "onboarding:awaiting_burst",
      idempotency_key: "onboarding:profile_123:session_123:onboarding_message_1",
    };

    await scheduleOnboardingStep(payload, 8000);

    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy).toHaveBeenCalledWith({
      url: "https://example.test/api/onboarding/step",
      body: payload,
      delay: 8,
    });
  });

  it("throws when required QStash env vars are missing", async () => {
    delete process.env.QSTASH_TOKEN;
    expect(() => createQStashClient()).toThrow("Missing required env var: QSTASH_TOKEN");

    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;

    const request = new Request("https://example.test/api/onboarding/step", {
      method: "POST",
      headers: {
        "upstash-signature": "invalid-signature",
      },
      body: "{}",
    });

    await expect(verifyQStashSignature(request)).rejects.toThrow(
      "Missing required env var: QSTASH_CURRENT_SIGNING_KEY"
    );
  });
});
