import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const E2E_USER_A_ID = "44444444-4444-4444-8444-444444444444";
const E2E_USER_B_ID = "55555555-5555-4555-8555-555555555555";

loadDotEnv(".env.local");

const stagingDbDsn = requiredEnv("STAGING_DB_DSN");
const supabaseUrl = requiredEnv("SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createSupabaseRestClient({
  supabaseUrl,
  serviceRoleKey,
});

const computeAndUpsertScore = await loadComputeAndUpsertScore();

const signalA = await fetchSignalOrFail(supabase, E2E_USER_A_ID);
const signalB = await fetchSignalOrFail(supabase, E2E_USER_B_ID);

console.log("[run-compatibility-e2e] signals_exist=true");
console.log(`[run-compatibility-e2e] user_a_hash=${signalA.content_hash}`);
console.log(`[run-compatibility-e2e] user_b_hash=${signalB.content_hash}`);

const totalBefore = queryCount({
  dsn: stagingDbDsn,
  sql: "select count(*) from public.profile_compatibility_scores;",
});

const first = await computeAndUpsertScore({
  supabase,
  user_a_id: E2E_USER_A_ID,
  user_b_id: E2E_USER_B_ID,
});

const keyCountAfterFirst = queryCount({
  dsn: stagingDbDsn,
  sql: scoreKeyCountSql(first),
});
if (keyCountAfterFirst !== 1) {
  fail(
    `Expected exactly 1 score row for unique key after first run, got ${keyCountAfterFirst}.`,
  );
}

const totalAfterFirst = queryCount({
  dsn: stagingDbDsn,
  sql: "select count(*) from public.profile_compatibility_scores;",
});

const second = await computeAndUpsertScore({
  supabase,
  user_a_id: E2E_USER_A_ID,
  user_b_id: E2E_USER_B_ID,
});

const keyCountAfterSecond = queryCount({
  dsn: stagingDbDsn,
  sql: scoreKeyCountSql(second),
});
if (keyCountAfterSecond > keyCountAfterFirst) {
  fail(
    `Score row count increased on replay (before=${keyCountAfterFirst}, after=${keyCountAfterSecond}).`,
  );
}
if (keyCountAfterSecond !== keyCountAfterFirst) {
  fail(
    `Score row count changed unexpectedly on replay (before=${keyCountAfterFirst}, after=${keyCountAfterSecond}).`,
  );
}

if (second.score !== first.score) {
  fail(`Score changed across replay (${first.score} -> ${second.score}).`);
}
if (second.version !== first.version) {
  fail(`Score version changed across replay (${first.version} -> ${second.version}).`);
}

const totalAfterSecond = queryCount({
  dsn: stagingDbDsn,
  sql: "select count(*) from public.profile_compatibility_scores;",
});
if (totalAfterSecond > totalAfterFirst) {
  fail(
    `Total score rows increased on replay (after_first=${totalAfterFirst}, after_second=${totalAfterSecond}).`,
  );
}

const persistedScoreRow = querySingleLine({
  dsn: stagingDbDsn,
  sql: `
    select score_total::text || '|' || score_version
    from public.profile_compatibility_scores
    where user_a_id = '${first.user_a_id}'
      and user_b_id = '${first.user_b_id}'
      and a_hash = '${first.a_hash}'
      and b_hash = '${first.b_hash}'
      and score_version = '${first.version}'
    order by computed_at desc
    limit 1;
  `,
});

console.log(`[run-compatibility-e2e] total_rows_before=${totalBefore}`);
console.log(`[run-compatibility-e2e] total_rows_after_first=${totalAfterFirst}`);
console.log(`[run-compatibility-e2e] total_rows_after_second=${totalAfterSecond}`);
console.log(`[run-compatibility-e2e] unique_key_rows_after_first=${keyCountAfterFirst}`);
console.log(`[run-compatibility-e2e] unique_key_rows_after_second=${keyCountAfterSecond}`);
console.log(`[run-compatibility-e2e] score_first=${first.score}`);
console.log(`[run-compatibility-e2e] score_second=${second.score}`);
console.log(`[run-compatibility-e2e] score_version=${first.version}`);
console.log(`[run-compatibility-e2e] score_breakdown=${JSON.stringify(first.breakdown)}`);
console.log(`[run-compatibility-e2e] persisted_row=${persistedScoreRow}`);
console.log("[run-compatibility-e2e] idempotent_replay=true");

function scoreKeyCountSql(score) {
  return `
    select count(*)
    from public.profile_compatibility_scores
    where user_a_id = '${score.user_a_id}'
      and user_b_id = '${score.user_b_id}'
      and a_hash = '${score.a_hash}'
      and b_hash = '${score.b_hash}'
      and score_version = '${score.version}';
  `;
}

async function fetchSignalOrFail(supabaseClient, userId) {
  const { data, error } = await supabaseClient
    .from("profile_compatibility_signals")
    .select("user_id,content_hash")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    fail(`Failed to load compatibility signals for user '${userId}': ${error.message}`);
  }

  if (!data?.user_id || !data?.content_hash) {
    fail(`Missing compatibility signals for user '${userId}'. Run seed script first.`);
  }

  return {
    user_id: data.user_id,
    content_hash: data.content_hash,
  };
}

function queryCount(params) {
  const raw = querySingleLine(params);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    fail(`Expected integer query result, got '${raw}'.`);
  }
  return parsed;
}

function querySingleLine(params) {
  const result = spawnSync(
    "psql",
    [params.dsn, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", params.sql],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  if (result.status !== 0) {
    fail(`psql query failed: ${truncate(result.stderr || result.stdout || "unknown error", 500)}`);
  }

  const value = (result.stdout || "").trim();
  if (value.length === 0) {
    fail("psql query returned empty output.");
  }
  return value;
}

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

async function loadComputeAndUpsertScore() {
  const require = createRequire(import.meta.url);
  const runtimeDir = path.join(process.cwd(), ".tmp", "compatibility-e2e-runtime");
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

  const writerModule = require(path.join(runtimeDir, "compatibility-score-writer.js"));
  if (typeof writerModule.computeAndUpsertScore !== "function") {
    fail("Compiled compatibility-score-writer module did not export computeAndUpsertScore.");
  }
  return writerModule.computeAndUpsertScore;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    fail(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function loadDotEnv(relativePath) {
  const fullPath = path.join(process.cwd(), relativePath);
  if (!fs.existsSync(fullPath)) {
    return;
  }

  const raw = fs.readFileSync(fullPath, "utf8");
  for (const line of raw.split("\n")) {
    const parsed = parseDotEnvLine(line);
    if (!parsed) {
      continue;
    }
    if (!process.env[parsed.key]) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

function parseDotEnvLine(line) {
  if (!line || line.trim().length === 0 || line.trim().startsWith("#")) {
    return null;
  }

  const splitIndex = line.indexOf("=");
  if (splitIndex <= 0) {
    return null;
  }

  const key = line.slice(0, splitIndex).trim();
  if (!/^[A-Z0-9_]+$/.test(key)) {
    return null;
  }

  let value = line.slice(splitIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
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
  console.error(`[run-compatibility-e2e] ERROR: ${message}`);
  process.exit(1);
}
