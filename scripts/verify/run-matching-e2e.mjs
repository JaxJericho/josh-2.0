import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const E2E_SOURCE_USER_ID = "77777777-7777-4777-8777-777777777801";

loadDotEnv(".env.local");

const stagingDbDsn = requiredEnv("STAGING_DB_DSN");
requiredEnv("SUPABASE_URL");
requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const runKey = `ticket_7_1_matching_e2e_${Date.now()}`;

runCommandOrFail({
  cmd: "node",
  args: ["scripts/verify/seed-matching-e2e.mjs"],
  label: "seed",
});

const firstRun = runCommandOrFail({
  cmd: "node",
  args: [
    "scripts/run-matching-job.mjs",
    "--source-user-id",
    E2E_SOURCE_USER_ID,
    "--candidate-limit",
    "3",
    "--source-limit",
    "1",
    "--run-key",
    runKey,
  ],
  label: "first_run",
});

const runId = querySingleLine({
  dsn: stagingDbDsn,
  sql: `
    select id::text
    from public.match_runs
    where run_key = '${runKey}'
    order by created_at desc
    limit 1;
  `,
});

const candidateCountAfterFirst = queryCount({
  dsn: stagingDbDsn,
  sql: `
    select count(*)
    from public.match_candidates
    where match_run_id = '${runId}';
  `,
});

if (candidateCountAfterFirst <= 0) {
  fail(`Expected match candidates after first run, got count=${candidateCountAfterFirst}.`);
}

const secondRun = runCommandOrFail({
  cmd: "node",
  args: [
    "scripts/run-matching-job.mjs",
    "--source-user-id",
    E2E_SOURCE_USER_ID,
    "--candidate-limit",
    "3",
    "--source-limit",
    "1",
    "--run-key",
    runKey,
  ],
  label: "second_run",
});

const candidateCountAfterSecond = queryCount({
  dsn: stagingDbDsn,
  sql: `
    select count(*)
    from public.match_candidates
    where match_run_id = '${runId}';
  `,
});

if (candidateCountAfterSecond !== candidateCountAfterFirst) {
  fail(
    `Candidate count changed on idempotent replay (first=${candidateCountAfterFirst}, second=${candidateCountAfterSecond}).`,
  );
}

const duplicatePairCount = queryCount({
  dsn: stagingDbDsn,
  sql: `
    select count(*)
    from (
      select source_user_id, candidate_user_id, count(*) as row_count
      from public.match_candidates
      where match_run_id = '${runId}'
      group by source_user_id, candidate_user_id
      having count(*) > 1
    ) duplicated;
  `,
});

if (duplicatePairCount !== 0) {
  fail(`Found duplicate source/candidate rows in same run: ${duplicatePairCount}.`);
}

const runRow = querySingleLine({
  dsn: stagingDbDsn,
  sql: `
    select
      id::text || '|' || run_key || '|' || status || '|' || started_at::text || '|' || coalesce(finished_at::text, '')
    from public.match_runs
    where id = '${runId}'
    limit 1;
  `,
});

const candidateRows = queryMultiLine({
  dsn: stagingDbDsn,
  sql: `
    select
      source_user_id::text || '|' || candidate_user_id::text || '|' || total_score::text || '|' || fingerprint
    from public.match_candidates
    where match_run_id = '${runId}'
    order by total_score desc, candidate_user_id asc;
  `,
});

const constraints = queryMultiLine({
  dsn: stagingDbDsn,
  sql: `
    select conname
    from pg_constraint
    where conrelid = 'public.match_candidates'::regclass
      and conname in (
        'match_candidates_run_source_candidate_uniq',
        'match_candidates_run_fingerprint_uniq'
      )
    order by conname;
  `,
});

const indexes = queryMultiLine({
  dsn: stagingDbDsn,
  sql: `
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'match_candidates'
      and indexname in (
        'match_candidates_source_user_idx',
        'match_candidates_candidate_user_idx',
        'match_candidates_match_run_id_idx',
        'match_candidates_source_score_idx'
      )
    order by indexname;
  `,
});

console.log(`[matching-e2e] run_key=${runKey}`);
console.log(`[matching-e2e] run_id=${runId}`);
console.log(`[matching-e2e] command_first=node scripts/run-matching-job.mjs --source-user-id ${E2E_SOURCE_USER_ID} --candidate-limit 3 --source-limit 1 --run-key ${runKey}`);
console.log(`[matching-e2e] first_run_log=${encodeForSingleLine(firstRun.stdout.trim())}`);
console.log(`[matching-e2e] command_second=node scripts/run-matching-job.mjs --source-user-id ${E2E_SOURCE_USER_ID} --candidate-limit 3 --source-limit 1 --run-key ${runKey}`);
console.log(`[matching-e2e] second_run_log=${encodeForSingleLine(secondRun.stdout.trim())}`);
console.log(`[matching-e2e] match_run_row=${runRow}`);
console.log(`[matching-e2e] candidate_count_after_first=${candidateCountAfterFirst}`);
console.log(`[matching-e2e] candidate_count_after_second=${candidateCountAfterSecond}`);
console.log(`[matching-e2e] duplicate_pair_count=${duplicatePairCount}`);
console.log(`[matching-e2e] match_candidate_rows=${encodeForSingleLine(candidateRows.join(";"))}`);
console.log(`[matching-e2e] constraints=${encodeForSingleLine(constraints.join(","))}`);
console.log(`[matching-e2e] indexes=${encodeForSingleLine(indexes.join(","))}`);
console.log("[matching-e2e] idempotent_replay=true");
console.log("[matching-e2e] done=true");

function runCommandOrFail(params) {
  const result = spawnSync(params.cmd, params.args, {
    encoding: "utf8",
    stdio: "pipe",
    env: process.env,
  });

  if (result.status !== 0) {
    fail(
      `${params.label} command failed: ${truncate(result.stderr || result.stdout || "unknown error", 800)}`,
    );
  }

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function queryCount(params) {
  const value = querySingleLine(params);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    fail(`Expected integer SQL result, got '${value}'.`);
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
    fail(`psql query failed: ${truncate(result.stderr || result.stdout || "unknown error", 800)}`);
  }

  const value = (result.stdout || "").trim();
  if (value.length === 0) {
    fail("psql query returned empty output.");
  }

  return value;
}

function queryMultiLine(params) {
  const result = spawnSync(
    "psql",
    [params.dsn, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", params.sql],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  if (result.status !== 0) {
    fail(`psql query failed: ${truncate(result.stderr || result.stdout || "unknown error", 800)}`);
  }

  return (result.stdout || "")
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function encodeForSingleLine(value) {
  return value.replace(/\s+/g, " ").trim();
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

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function fail(message) {
  console.error(`[matching-e2e] ERROR: ${message}`);
  process.exit(1);
}
