import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.length < 2) {
  fail("Usage: node scripts/verify/score-pair.mjs <user_a_id> <user_b_id>");
}

const userAId = args[0];
const userBId = args[1];

const supabaseUrl = requiredEnv("SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createSupabaseRestClient({
  supabaseUrl,
  serviceRoleKey,
});

const computeAndUpsertScore = await loadComputeAndUpsertScore();

const result = await computeAndUpsertScore({
  supabase,
  user_a_id: userAId,
  user_b_id: userBId,
});

console.log(`[score-pair] user_a_id=${result.user_a_id}`);
console.log(`[score-pair] user_b_id=${result.user_b_id}`);
console.log(`[score-pair] total_score=${result.score}`);
console.log(`[score-pair] score_version=${result.version}`);
console.log(`[score-pair] breakdown=${JSON.stringify(result.breakdown)}`);
console.log(`[score-pair] upserted=${result.upserted}`);

function createSupabaseRestClient(params) {
  const baseUrl = `${stripTrailingSlash(params.supabaseUrl)}/rest/v1`;
  const baseHeaders = {
    apikey: params.serviceRoleKey,
    authorization: `Bearer ${params.serviceRoleKey}`,
  };

  return {
    from(table) {
      return createRestTableClient({
        baseUrl,
        table,
        baseHeaders,
      });
    },
  };
}

function createRestTableClient(params) {
  return {
    select(columns) {
      const filters = [];
      return {
        eq(column, value) {
          filters.push([column, value]);
          return this;
        },
        async maybeSingle() {
          const query = new URLSearchParams();
          query.set("select", columns);
          query.set("limit", "2");
          for (const [column, value] of filters) {
            query.append(column, `eq.${String(value)}`);
          }

          const response = await fetch(`${params.baseUrl}/${params.table}?${query.toString()}`, {
            method: "GET",
            headers: {
              ...params.baseHeaders,
              accept: "application/json",
            },
          });

          if (!response.ok) {
            return {
              data: null,
              error: await asError(response),
            };
          }

          const payload = await response.json();
          if (!Array.isArray(payload)) {
            return {
              data: null,
              error: {
                message: `Unexpected response payload for table '${params.table}'.`,
              },
            };
          }

          if (payload.length > 1) {
            return {
              data: null,
              error: {
                message: `Expected 0 or 1 row from table '${params.table}', got ${payload.length}.`,
              },
            };
          }

          return {
            data: payload[0] ?? null,
            error: null,
          };
        },
      };
    },
    async upsert(row, options = {}) {
      const query = new URLSearchParams();
      if (options.onConflict) {
        query.set("on_conflict", options.onConflict);
      }

      const preferDirectives = [
        options.ignoreDuplicates ? "resolution=ignore-duplicates" : "resolution=merge-duplicates",
        "return=representation",
      ];

      const response = await fetch(`${params.baseUrl}/${params.table}?${query.toString()}`, {
        method: "POST",
        headers: {
          ...params.baseHeaders,
          "content-type": "application/json",
          prefer: preferDirectives.join(","),
        },
        body: JSON.stringify(row),
      });

      if (!response.ok) {
        return {
          data: null,
          error: await asError(response),
        };
      }

      const payload = await response.json();
      return {
        data: payload,
        error: null,
      };
    },
  };
}

async function asError(response) {
  const bodyText = await response.text();
  return {
    message: `HTTP ${response.status}: ${truncate(bodyText, 500)}`,
  };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    fail(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function stripTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function truncate(value, max) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
}

function fail(message) {
  console.error(`[score-pair] ERROR: ${message}`);
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/verify/score-pair.mjs <user_a_id> <user_b_id>

Outputs:
  - total score
  - breakdown
  - score version
  - upsert confirmation`);
}

async function loadComputeAndUpsertScore() {
  const require = createRequire(import.meta.url);
  const runtimeDir = path.join(process.cwd(), ".tmp", "score-pair-runtime");
  const compile = spawnSync(
    "pnpm",
    [
      "exec",
      "tsc",
      "--outDir",
      runtimeDir,
      "--module",
      "commonjs",
      "--target",
      "es2022",
      "--moduleResolution",
      "node",
      "--esModuleInterop",
      "true",
      "--skipLibCheck",
      "true",
      "--allowJs",
      "true",
      "--resolveJsonModule",
      "true",
      "packages/core/src/compatibility/compatibility-score-writer.ts",
      "packages/core/src/compatibility/compatibility-signal-writer.ts",
      "packages/core/src/compatibility/scorer.ts",
      "packages/core/src/compatibility/scoring-version.ts",
      "packages/core/src/compatibility/normalizer.ts",
    ],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  if (compile.status !== 0) {
    fail(
      `Failed to compile compatibility runtime module: ${truncate(
        compile.stderr || compile.stdout || "unknown error",
        600,
      )}`,
    );
  }

  const writerJsPath = path.join(
    runtimeDir,
    "compatibility-score-writer.js",
  );
  const writerModule = require(writerJsPath);
  if (typeof writerModule.computeAndUpsertScore !== "function") {
    fail("Compiled compatibility-score-writer module did not export computeAndUpsertScore.");
  }
  return writerModule.computeAndUpsertScore;
}
