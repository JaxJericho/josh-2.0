import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const PRODUCTION_ROOTS = [
  "app",
  "supabase/functions",
  "packages",
] as const;

describe("console usage guardrail", () => {
  it("blocks console.log / console.warn / console.error in production code paths", () => {
    const offenders: string[] = [];

    for (const root of PRODUCTION_ROOTS) {
      const absoluteRoot = path.resolve(process.cwd(), root);
      if (!fs.existsSync(absoluteRoot)) {
        continue;
      }
      for (const file of walkFiles(absoluteRoot)) {
        if (isIgnoredPath(file)) {
          continue;
        }

        const source = fs.readFileSync(file, "utf8");
        if (FORBIDDEN_CONSOLE_PATTERN.test(source)) {
          offenders.push(path.relative(process.cwd(), file));
        }
      }
    }

    if (offenders.length > 0) {
      throw new Error(
        `Forbidden console usage detected in production files: ${offenders.join(", ")}`,
      );
    }
  });

  it("would fail when raw console.log usage appears", () => {
    const source = "export const demo = () => { console.log('debug line'); };";
    expect(FORBIDDEN_CONSOLE_PATTERN.test(source)).toBe(true);
  });
});

const FORBIDDEN_CONSOLE_PATTERN = /console\.(log|warn|error)\s*\(/;

function walkFiles(root: string): string[] {
  const discovered: string[] = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      discovered.push(...walkFiles(absolutePath));
      continue;
    }
    if (entry.isFile()) {
      discovered.push(absolutePath);
    }
  }

  return discovered;
}

function isIgnoredPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.includes("/tests/")) {
    return true;
  }
  if (normalized.includes("/__snapshots__/")) {
    return true;
  }
  if (
    !(
      normalized.endsWith(".ts") ||
      normalized.endsWith(".tsx") ||
      normalized.endsWith(".js") ||
      normalized.endsWith(".mjs")
    )
  ) {
    return true;
  }
  return false;
}
