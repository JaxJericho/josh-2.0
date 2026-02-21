import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../..");
const ALLOWED_PREFIX = "packages/messaging/";

function runGitGrep(pattern: string): string[] {
  const pathspecs = [
    "*.ts",
    ":(exclude).claude/**",
    ":(exclude)node_modules/**",
    ":(exclude).next/**",
    ":(exclude)dist/**",
    ":(exclude)build/**",
  ];

  try {
    const output = execFileSync(
      "git",
      ["grep", "-n", "-P", pattern, "--", ...pathspecs],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
      },
    );

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    const result = error as { status?: number; stdout?: string | Buffer };
    if (result.status !== 1) {
      throw error;
    }

    const maybeStdout = typeof result.stdout === "string"
      ? result.stdout
      : result.stdout?.toString("utf8") ?? "";

    return maybeStdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
}

function assertMatchesOnlyInMessaging(matches: string[], label: string): void {
  const offenders = matches.filter((line) => {
    const filePath = line.split(":")[0] ?? "";
    return !filePath.startsWith(ALLOWED_PREFIX);
  });

  expect(offenders, `${label} must only match under ${ALLOWED_PREFIX}`).toEqual([]);
}

describe("Twilio usage boundary guardrail", () => {
  it("restricts Twilio SDK, REST helpers, and client factory usage to packages/messaging", () => {
    const twilioImportPattern = "from ['\\\"]tw" + "ilio['\\\"]";
    const twilioRequirePattern = "require\\(['\\\"]tw" + "ilio['\\\"]\\)";
    const messagesCreatePattern = "\\.messages" + "\\.create\\(";
    const factoryPattern = ("createTwilio" + "Client\\b") + "|" + ("createTwilio" + "ClientFromEnv\\b");

    const sdkImportMatches = runGitGrep(twilioImportPattern);
    const sdkRequireMatches = runGitGrep(twilioRequirePattern);
    const restCallMatches = runGitGrep(messagesCreatePattern);
    const factoryMatches = runGitGrep(factoryPattern);

    assertMatchesOnlyInMessaging(sdkImportMatches, "Twilio SDK ESM import");
    assertMatchesOnlyInMessaging(sdkRequireMatches, "Twilio SDK require");
    assertMatchesOnlyInMessaging(restCallMatches, "Twilio .messages.create usage");
    assertMatchesOnlyInMessaging(factoryMatches, "Twilio client factory usage");
  });
});
