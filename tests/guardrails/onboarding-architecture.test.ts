import fs from "fs";
import path from "path";
import { describe, it } from "vitest";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { runOnboardingEngine } from "../../supabase/functions/_shared/engines/onboarding-engine";

const ONBOARDING_IMPLEMENTATION_ROOTS = [
  "packages/core/src/onboarding",
  "app/lib/onboarding-step-handler.ts",
  "app/lib/qstash.ts",
  "app/api/onboarding/step/route.ts",
  "supabase/functions/_shared/engines/onboarding-engine.ts",
] as const;

const SLEEP_PATTERNS = [
  /\bsetTimeout\s*\(/,
  /\bsetInterval\s*\(/,
  /\btimers\/promises\b/,
  /\bsleep\s*\(/,
] as const;

describe("onboarding architecture guardrails", () => {
  it("disallows multi-step onboarding burst enqueue", async () => {
    const { scheduleCalls, burstJobInserts } = await runExplanationAffirmativeBurstTrigger();

    const scheduledBurstStart =
      scheduleCalls.length === 1 &&
      scheduleCalls[0]?.payload.step_id === "onboarding_message_1" &&
      scheduleCalls[0]?.delayMs === 0;
    const insertedBurstJobs = burstJobInserts.length > 0;

    if (!scheduledBurstStart || insertedBurstJobs) {
      throw new Error("burst enqueue detected — use QStash scheduling");
    }
  });

  it("disallows in-process sleep primitives in onboarding implementation", () => {
    const onboardingFiles = collectOnboardingImplementationFiles();
    const offenders: string[] = [];

    for (const file of onboardingFiles) {
      const source = fs.readFileSync(file, "utf8");
      for (const pattern of SLEEP_PATTERNS) {
        if (pattern.test(source)) {
          offenders.push(path.relative(process.cwd(), file));
          break;
        }
      }
    }

    if (offenders.length > 0) {
      throw new Error("in-process sleep detected — use QStash delay parameter");
    }
  });
});

function collectOnboardingImplementationFiles(): string[] {
  const files: string[] = [];

  for (const relativeRoot of ONBOARDING_IMPLEMENTATION_ROOTS) {
    const absoluteRoot = path.resolve(process.cwd(), relativeRoot);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }

    const stats = fs.statSync(absoluteRoot);
    if (stats.isFile()) {
      if (absoluteRoot.endsWith(".ts")) {
        files.push(absoluteRoot);
      }
      continue;
    }

    for (const discovered of walkTypeScriptFiles(absoluteRoot)) {
      files.push(discovered);
    }
  }

  return files;
}

function walkTypeScriptFiles(root: string): string[] {
  const discovered: string[] = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      discovered.push(...walkTypeScriptFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && absolutePath.endsWith(".ts")) {
      discovered.push(absolutePath);
    }
  }

  return discovered;
}

async function runExplanationAffirmativeBurstTrigger(): Promise<{
  scheduleCalls: Array<{
    payload: {
      profile_id: string;
      session_id: string;
      step_id: "onboarding_message_1";
      expected_state_token: string;
      idempotency_key: string;
    };
    delayMs: number;
  }>;
  burstJobInserts: Array<Record<string, unknown>>;
}> {
  const previousDeno = (globalThis as { Deno?: unknown }).Deno;
  const envMap = new Map<string, string>([
    ["TWILIO_ACCOUNT_SID", "TWILIO_ACCOUNT_SID_PLACEHOLDER"],
    ["TWILIO_AUTH_TOKEN", "auth-token-123"],
    ["SMS_BODY_ENCRYPTION_KEY", "sms-encryption-key-123"],
    ["TWILIO_FROM_NUMBER", "+15555550123"],
    ["PROJECT_REF", "rcqlnfywwfsixznrmzmv"],
  ]);

  (globalThis as { Deno?: unknown }).Deno = {
    env: {
      get: (key: string) => envMap.get(key),
    },
  };

  let sidClaimed = false;
  const burstJobInserts: Array<Record<string, unknown>> = [];
  const scheduleCalls: Array<{
    payload: {
      profile_id: string;
      session_id: string;
      step_id: "onboarding_message_1";
      expected_state_token: string;
      idempotency_key: string;
    };
    delayMs: number;
  }> = [];

  const supabase = {
    from(table: string) {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        is() {
          return query;
        },
        maybeSingle: async () => {
          if (table === "conversation_sessions") {
            if (sidClaimed) {
              return { data: { id: "ses_123" }, error: null };
            }
            return {
              data: {
                id: "ses_123",
                mode: "interviewing",
                state_token: "onboarding:awaiting_explanation_response",
                current_step_id: null,
                last_inbound_message_sid: null,
              },
              error: null,
            };
          }
          if (table === "profiles") {
            return { data: { id: "profile_123", user_id: "usr_123" }, error: null };
          }
          if (table === "users") {
            return { data: { first_name: "Alex", phone_e164: "+15555550999" }, error: null };
          }
          if (table === "conversation_events") {
            return { data: null, error: null };
          }
          if (table === "sms_outbound_jobs") {
            return { data: null, error: null };
          }
          return { data: null, error: null };
        },
        update(payload: Record<string, unknown>) {
          if (table === "conversation_sessions" && payload.last_inbound_message_sid && !payload.state_token) {
            sidClaimed = true;
          }
          const updateQuery = {
            eq() {
              return updateQuery;
            },
            is() {
              return updateQuery;
            },
            select() {
              return updateQuery;
            },
            maybeSingle: async () => {
              if (table === "conversation_sessions") {
                return { data: { id: "ses_123" }, error: null };
              }
              return { error: null };
            },
          };
          return updateQuery;
        },
        insert(payload: Record<string, unknown>) {
          if (table === "sms_outbound_jobs") {
            burstJobInserts.push(payload);
          }
          return Promise.resolve({ error: null });
        },
      };

      return query;
    },
    rpc: async (fn: string) => {
      if (fn === "encrypt_sms_body") {
        return { data: "ciphertext", error: null };
      }
      throw new Error(`Unexpected rpc call: ${fn}`);
    },
  };

  try {
    await runOnboardingEngine(
      {
        supabase,
        decision: {
          user_id: "usr_123",
          state: {
            mode: "interviewing",
            state_token: "onboarding:awaiting_explanation_response",
          },
          profile_is_complete_mvp: false,
          route: "onboarding_engine",
          safety_override_applied: false,
          next_transition: "onboarding:awaiting_explanation_response",
        },
        payload: {
          inbound_message_id: "msg_123",
          inbound_message_sid: "SM_EXPLAIN_GUARDRAIL",
          from_e164: "+15555550111",
          to_e164: "+15555550222",
          body_raw: "yes",
          body_normalized: "YES",
        },
      },
      {
        scheduleOnboardingStep: async (payload, delayMs) => {
          scheduleCalls.push({
            payload: payload as {
              profile_id: string;
              session_id: string;
              step_id: "onboarding_message_1";
              expected_state_token: string;
              idempotency_key: string;
            },
            delayMs,
          });
        },
      },
    );

    return {
      scheduleCalls,
      burstJobInserts,
    };
  } finally {
    if (previousDeno === undefined) {
      delete (globalThis as { Deno?: unknown }).Deno;
    } else {
      (globalThis as { Deno?: unknown }).Deno = previousDeno;
    }
  }
}
