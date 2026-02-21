import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../..");
const SKIP_DIRS = new Set([".git", ".claude", "node_modules", ".next", ".pnpm-store"]);
const ALLOWED_SEGMENT = `${path.sep}packages${path.sep}db${path.sep}`;
const CREATE_CLIENT_CALL_PATTERN = "create" + "Client(";

function collectCreateClientHits(dirPath: string): string[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const hits: string[] = [];

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      hits.push(...collectCreateClientHits(absolutePath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const content = fs.readFileSync(absolutePath, "utf8");
    if (content.includes(CREATE_CLIENT_CALL_PATTERN)) {
      hits.push(path.relative(REPO_ROOT, absolutePath));
    }
  }

  return hits;
}

describe("supabase client instantiation guardrail", () => {
  it("keeps Supabase client constructor usage scoped to packages/db", () => {
    const hits = collectCreateClientHits(REPO_ROOT);

    expect(hits.every((relativePath) => {
      const absolutePath = path.join(REPO_ROOT, relativePath);
      return absolutePath.includes(ALLOWED_SEGMENT);
    })).toBe(true);
  });
});
