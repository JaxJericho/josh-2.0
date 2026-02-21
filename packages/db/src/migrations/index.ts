import { spawnSync } from "node:child_process";
import { DB_ERROR_CODES, DbError } from "../errors.mjs";

export type MigrationStep = "up" | "gen-types" | "verify-types";

const MIGRATION_COMMANDS: Record<MigrationStep, string[]> = {
  up: ["pnpm", "db:migrate"],
  "gen-types": ["pnpm", "db:gen-types"],
  "verify-types": ["pnpm", "db:verify-types"],
};

/** Resolve the canonical command used by this repo for a migration workflow step. */
export function resolveMigrationCommand(step: MigrationStep): readonly string[] {
  return MIGRATION_COMMANDS[step];
}

/** Execute a migration workflow step and throw a typed DbError on failure. */
export function runMigrationStep(
  step: MigrationStep,
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  },
): void {
  const [command, ...args] = MIGRATION_COMMANDS[step];
  const result = spawnSync(command, args, {
    cwd: options?.cwd,
    env: options?.env,
    stdio: "pipe",
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new DbError(DB_ERROR_CODES.MIGRATION_FAILED, `Migration step failed: ${step}`, {
      status: 500,
      context: {
        step,
        command: [command, ...args].join(" "),
        stderr: result.stderr ? result.stderr.trim() : "",
      },
    });
  }
}
