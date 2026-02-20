import { Client, Receiver } from "@upstash/qstash";
import type { OnboardingStepId } from "../../packages/core/src/onboarding/step-ids";

const ONBOARDING_STEP_PATH = "/api/onboarding/step";

export type OnboardingStepPayload = {
  profile_id: string;
  session_id: string;
  step_id: OnboardingStepId;
  expected_state_token: string;
  idempotency_key: string;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function resolveOnboardingBaseUrl(): string {
  const appBaseUrl = process.env.APP_BASE_URL?.trim();
  if (appBaseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(appBaseUrl);
    } catch {
      throw new Error("APP_BASE_URL must be a valid absolute URL.");
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("APP_BASE_URL must use http or https.");
    }

    if (parsed.search.length > 0) {
      throw new Error("APP_BASE_URL must not include query params.");
    }

    return parsed.origin;
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return `https://${vercelUrl}`;
  }

  throw new Error("Missing required env var: APP_BASE_URL or VERCEL_URL");
}

function resolveOnboardingStepUrl(): string {
  return new URL(ONBOARDING_STEP_PATH, resolveOnboardingBaseUrl()).toString();
}

function createQStashReceiver(): Receiver {
  return new Receiver({
    currentSigningKey: requireEnv("QSTASH_CURRENT_SIGNING_KEY"),
    nextSigningKey: requireEnv("QSTASH_NEXT_SIGNING_KEY"),
  });
}

export function createQStashClient(): Client {
  return new Client({ token: requireEnv("QSTASH_TOKEN") });
}

export async function verifyQStashSignature(request: Request): Promise<boolean> {
  const signature = request.headers.get("upstash-signature");
  if (!signature) {
    return false;
  }

  const receiver = createQStashReceiver();
  const body = await request.clone().text();

  try {
    return await receiver.verify({
      signature,
      body,
      url: request.url,
    });
  } catch {
    return false;
  }
}

export async function scheduleOnboardingStep(payload: OnboardingStepPayload, delayMs: number) {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error("delayMs must be a non-negative finite number.");
  }

  return createQStashClient().publishJSON({
    url: resolveOnboardingStepUrl(),
    body: payload,
    delay: Math.ceil(delayMs / 1000),
  });
}
