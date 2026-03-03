import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const MATCHING_JOB_PATH = path.join(process.cwd(), "scripts/run-matching-job.mjs");

describe("run-matching-job mode behavior", () => {
  it("defaults mode to linkup when --mode is omitted", () => {
    const source = fs.readFileSync(MATCHING_JOB_PATH, "utf8");
    expect(source).toContain('const RUN_MODES = new Set(["linkup"]);');
    expect(source).toMatch(/function parseArgs\([\s\S]*?mode:\s*"linkup"/);
  });

  it("rejects --mode one_to_one before any runtime DB path", () => {
    const result = spawnSync(
      process.execPath,
      [MATCHING_JOB_PATH, "--mode", "one_to_one"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SUPABASE_URL: "http://127.0.0.1:54321",
          SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
        },
      },
    );

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    expect(result.status).toBe(1);
    expect(output).toContain("Invalid --mode 'one_to_one'. Expected one of: linkup.");
    expect(output).not.toContain("Failed to load 'users' rows:");
  });
});
