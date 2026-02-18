import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SOURCE_LIMIT = 25;
const DEFAULT_CANDIDATE_LIMIT = 15;
const RUN_MODES = new Set(["one_to_one", "linkup"]);

loadDotEnv(".env.local");

const args = parseArgs(process.argv.slice(2));
const supabaseUrl = requiredEnv("SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

if (!RUN_MODES.has(args.mode)) {
  fail(`Invalid --mode '${args.mode}'. Expected one of: ${Array.from(RUN_MODES).join(", ")}.`);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

let runId = null;
let runKey = null;

try {
  const scoringRuntime = await loadScoringRuntime();
  const nowIso = new Date().toISOString();

  const [users, profiles, signals, profileEntitlements, entitlements, assignments, waitlistEntries, activeHolds, userBlocks] =
    await Promise.all([
      fetchRowsOrThrow(supabase, "users", "id,state,deleted_at"),
      fetchRowsOrThrow(supabase, "profiles", "id,user_id,state,is_complete_mvp"),
      fetchRowsOrThrow(
        supabase,
        "profile_compatibility_signals",
        "user_id,profile_id,interest_vector,trait_vector,intent_vector,availability_vector,metadata,content_hash",
      ),
      fetchRowsOrThrow(
        supabase,
        "profile_entitlements",
        "profile_id,can_initiate,can_participate,can_exchange_contact,region_override,waitlist_override,safety_override,reason",
      ),
      fetchRowsOrThrow(
        supabase,
        "entitlements",
        "user_id,can_receive_intro,intro_credits_remaining",
      ),
      fetchRowsOrThrow(
        supabase,
        "profile_region_assignments",
        "profile_id,region_id,regions!inner(id,slug,is_active,is_launch_region)",
      ),
      fetchRowsOrThrow(supabase, "waitlist_entries", "profile_id,region_id,status,last_notified_at"),
      fetchRowsOrThrow(supabase, "safety_holds", "user_id,status,expires_at", (query) =>
        query.eq("status", "active"),
      ),
      fetchRowsOrThrow(supabase, "user_blocks", "blocker_user_id,blocked_user_id"),
    ]);

  const userById = buildByIdMap(users);
  const profileByUserId = buildByIdMap(profiles, "user_id");
  const profileEntitlementsByProfileId = buildByIdMap(profileEntitlements, "profile_id");
  const introEntitlementsByUserId = buildByIdMap(entitlements, "user_id");
  const assignmentByProfileId = buildByIdMap(assignments, "profile_id");
  const waitlistEntryByProfileId = buildByIdMap(waitlistEntries, "profile_id");
  const activeHoldByUserId = buildActiveHoldMap(activeHolds);
  const blockedPairSet = buildBlockedPairSet(userBlocks);

  const config = {
    scoring_version: scoringRuntime.COMPONENTS.version,
    score_scale_max: scoringRuntime.COMPONENTS.scale_max,
    score_round_digits: scoringRuntime.COMPONENTS.round_digits,
    component_weights: scoringRuntime.COMPONENTS.weights,
    penalty_config: scoringRuntime.COMPONENTS.penalty,
    idempotency_strategy: "deterministic_run_key_plus_pair_upsert",
  };

  const candidatePool = [];
  for (const signal of signals) {
    const userId = signal.user_id;
    const user = userById.get(userId);
    const profile = profileByUserId.get(userId);

    if (!user || !profile) {
      continue;
    }

    if (user.state !== "active" || user.deleted_at !== null) {
      continue;
    }

    if (!profile.is_complete_mvp && profile.state !== "complete_full") {
      continue;
    }

    const storedEntitlements = profileEntitlementsByProfileId.get(profile.id) ?? null;
    const assignment = assignmentByProfileId.get(profile.id) ?? null;
    const regionRaw = assignment?.regions;
    const region = Array.isArray(regionRaw) ? regionRaw[0] ?? null : regionRaw ?? null;

    const entitlementEvaluation = scoringRuntime.resolveEntitlementsEvaluation({
      profile_id: profile.id,
      user_id: user.id,
      region,
      waitlist_entry: waitlistEntryByProfileId.get(profile.id) ?? null,
      has_active_safety_hold: activeHoldByUserId.has(user.id),
      stored_entitlements: storedEntitlements,
    });

    if (!entitlementEvaluation.can_participate) {
      continue;
    }

    if (args.regionId && assignment?.region_id !== args.regionId) {
      continue;
    }

    candidatePool.push({
      user,
      profile,
      signal,
      assignment,
      entitlementEvaluation,
      introEntitlement: introEntitlementsByUserId.get(user.id) ?? null,
    });
  }

  const sources = candidatePool
    .filter((entry) => {
      const intro = entry.introEntitlement;
      return Boolean(intro?.can_receive_intro) && Number(intro?.intro_credits_remaining ?? 0) > 0;
    })
    .sort((left, right) => left.user.id.localeCompare(right.user.id));

  const selectedSources = args.sourceUserId
    ? sources.filter((entry) => entry.user.id === args.sourceUserId)
    : sources.slice(0, args.sourceLimit);

  if (selectedSources.length === 0) {
    fail("No eligible source users found for matching run with the provided inputs.");
  }

  const inputUserIds = selectedSources.map((entry) => entry.user.id).sort();

  runKey =
    args.runKey ??
    `matching:${args.mode}:${hashStableObject({
      source_user_id: args.sourceUserId,
      region_id: args.regionId,
      source_limit: args.sourceLimit,
      candidate_limit: args.candidateLimit,
      input_user_ids: inputUserIds,
      scoring_version: config.scoring_version,
    })}`;

  const inputs = {
    source_user_id: args.sourceUserId,
    region_id: args.regionId,
    source_limit: args.sourceLimit,
    candidate_limit: args.candidateLimit,
    selected_source_user_ids: inputUserIds,
  };

  const { data: existingRun, error: existingRunError } = await supabase
    .from("match_runs")
    .select("id,run_key,status,created_at")
    .eq("run_key", runKey)
    .maybeSingle();

  if (existingRunError) {
    fail(`Failed to read existing match run by run_key: ${existingRunError.message}`);
  }

  const upsertRunPayload = {
    mode: args.mode,
    region_id: args.regionId,
    subject_user_id: args.sourceUserId,
    run_key: runKey,
    status: "started",
    params: config,
    config,
    inputs,
    started_at: nowIso,
    finished_at: null,
    completed_at: null,
    error_code: null,
    error_detail: null,
    error: null,
  };

  const { data: upsertedRun, error: upsertRunError } = await supabase
    .from("match_runs")
    .upsert(upsertRunPayload, {
      onConflict: "run_key",
      ignoreDuplicates: false,
    })
    .select("id,run_key,status,created_at,started_at")
    .single();

  if (upsertRunError || !upsertedRun?.id) {
    fail(`Failed to create or update match_run row: ${upsertRunError?.message ?? "unknown error"}`);
  }

  runId = upsertedRun.id;

  const preRunCount = await getRunCandidateCount(supabase, runId);

  const candidateRows = [];
  for (const sourceEntry of selectedSources) {
    const sourceUserId = sourceEntry.user.id;
    const sourceRegionId = sourceEntry.assignment?.region_id ?? null;

    const rankedCandidates = [];
    for (const candidateEntry of candidatePool) {
      const candidateUserId = candidateEntry.user.id;
      if (candidateUserId === sourceUserId) {
        continue;
      }

      const blockedForward = blockedPairSet.has(`${sourceUserId}|${candidateUserId}`);
      const blockedBackward = blockedPairSet.has(`${candidateUserId}|${sourceUserId}`);
      if (blockedForward || blockedBackward) {
        continue;
      }

      if (!sourceRegionId || candidateEntry.assignment?.region_id !== sourceRegionId) {
        continue;
      }

      const score = scoringRuntime.scorePair(
        {
          interest_vector: sourceEntry.signal.interest_vector,
          trait_vector: sourceEntry.signal.trait_vector,
          intent_vector: sourceEntry.signal.intent_vector,
          availability_vector: sourceEntry.signal.availability_vector,
          content_hash: sourceEntry.signal.content_hash,
          metadata: sourceEntry.signal.metadata ?? {},
        },
        {
          interest_vector: candidateEntry.signal.interest_vector,
          trait_vector: candidateEntry.signal.trait_vector,
          intent_vector: candidateEntry.signal.intent_vector,
          availability_vector: candidateEntry.signal.availability_vector,
          content_hash: candidateEntry.signal.content_hash,
          metadata: candidateEntry.signal.metadata ?? {},
        },
      );

      const topReasons = buildTopReasons(score.breakdown);
      const explainability = {
        top_reasons: topReasons,
        score_version: score.version,
        source_signal_hash: sourceEntry.signal.content_hash,
        candidate_signal_hash: candidateEntry.signal.content_hash,
      };

      rankedCandidates.push({
        source_user_id: sourceUserId,
        subject_user_id: sourceUserId,
        subject_profile_id: sourceEntry.profile.id,
        candidate_user_id: candidateUserId,
        candidate_profile_id: candidateEntry.profile.id,
        mode: args.mode,
        passed_hard_filters: true,
        total_score: score.score,
        final_score: score.score,
        breakdown: score.breakdown,
        component_scores: score.breakdown,
        reasons: topReasons,
        explainability,
        fingerprint: hashStableObject({
          run_key: runKey,
          source_user_id: sourceUserId,
          candidate_user_id: candidateUserId,
          source_hash: sourceEntry.signal.content_hash,
          candidate_hash: candidateEntry.signal.content_hash,
          score_version: score.version,
          mode: args.mode,
          config,
        }),
      });
    }

    rankedCandidates.sort((left, right) => {
      if (right.total_score !== left.total_score) {
        return right.total_score - left.total_score;
      }
      return left.candidate_user_id.localeCompare(right.candidate_user_id);
    });

    candidateRows.push(...rankedCandidates.slice(0, args.candidateLimit));
  }

  if (candidateRows.length > 0) {
    await upsertCandidatesInChunks({
      supabase,
      runId,
      candidateRows,
      chunkSize: 100,
    });
  }

  const postRunCount = await getRunCandidateCount(supabase, runId);
  const insertedRows = Math.max(0, postRunCount - preRunCount);
  const idempotentReplay = Boolean(existingRun?.id) && insertedRows === 0;

  const finishedAt = new Date().toISOString();

  const { error: completeRunError } = await supabase
    .from("match_runs")
    .update({
      status: "completed",
      finished_at: finishedAt,
      completed_at: finishedAt,
      error_code: null,
      error_detail: null,
      error: null,
      inputs: {
        ...inputs,
        selected_source_count: selectedSources.length,
        candidate_rows_attempted: candidateRows.length,
        candidate_rows_before: preRunCount,
        candidate_rows_after: postRunCount,
        idempotent_replay: idempotentReplay,
      },
      config,
      params: {
        ...config,
        idempotent_replay: idempotentReplay,
      },
    })
    .eq("id", runId);

  if (completeRunError) {
    fail(`Failed to finalize match run: ${completeRunError.message}`);
  }

  console.log(`[matching-job] mode=${args.mode}`);
  console.log(`[matching-job] run_key=${runKey}`);
  console.log(`[matching-job] run_id=${runId}`);
  console.log(`[matching-job] existing_run_reused=${Boolean(existingRun?.id)}`);
  console.log(`[matching-job] selected_source_count=${selectedSources.length}`);
  console.log(`[matching-job] candidate_rows_attempted=${candidateRows.length}`);
  console.log(`[matching-job] candidate_rows_before=${preRunCount}`);
  console.log(`[matching-job] candidate_rows_after=${postRunCount}`);
  console.log(`[matching-job] candidate_rows_inserted=${insertedRows}`);
  console.log(`[matching-job] idempotent_replay=${idempotentReplay}`);
  console.log("[matching-job] done=true");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  if (runId) {
    const finishedAt = new Date().toISOString();
    await supabase
      .from("match_runs")
      .update({
        status: "failed",
        finished_at: finishedAt,
        completed_at: finishedAt,
        error_code: "matching_job_failed",
        error_detail: message,
        error: message,
      })
      .eq("id", runId);
  }

  fail(message);
}

function parseArgs(rawArgs) {
  const parsed = {
    mode: "one_to_one",
    sourceUserId: null,
    regionId: null,
    sourceLimit: DEFAULT_SOURCE_LIMIT,
    candidateLimit: DEFAULT_CANDIDATE_LIMIT,
    runKey: null,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    const next = rawArgs[index + 1];

    if (token === "--mode") {
      if (!next) {
        fail("Missing value for --mode.");
      }
      parsed.mode = next;
      index += 1;
      continue;
    }

    if (token === "--source-user-id") {
      if (!next) {
        fail("Missing value for --source-user-id.");
      }
      parsed.sourceUserId = next;
      index += 1;
      continue;
    }

    if (token === "--region-id") {
      if (!next) {
        fail("Missing value for --region-id.");
      }
      parsed.regionId = next;
      index += 1;
      continue;
    }

    if (token === "--source-limit") {
      if (!next) {
        fail("Missing value for --source-limit.");
      }
      parsed.sourceLimit = parsePositiveInteger(next, "--source-limit");
      index += 1;
      continue;
    }

    if (token === "--candidate-limit") {
      if (!next) {
        fail("Missing value for --candidate-limit.");
      }
      parsed.candidateLimit = parsePositiveInteger(next, "--candidate-limit");
      index += 1;
      continue;
    }

    if (token === "--run-key") {
      if (!next) {
        fail("Missing value for --run-key.");
      }
      parsed.runKey = next;
      index += 1;
      continue;
    }

    fail(`Unknown argument '${token}'.`);
  }

  return parsed;
}

function parsePositiveInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail(`${flagName} must be a positive integer.`);
  }
  return parsed;
}

async function loadScoringRuntime() {
  const runtimeDir = path.join(process.cwd(), ".tmp", "matching-runtime");
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
      "packages/core/src/compatibility/scorer.ts",
      "packages/core/src/compatibility/scoring-version.ts",
      "packages/core/src/entitlements/evaluate-entitlements.ts",
      "packages/core/src/regions/waitlist-routing.ts",
    ],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  if (compile.status !== 0) {
    fail(
      `Failed to compile matching runtime modules: ${truncate(
        compile.stderr || compile.stdout || "unknown error",
        600,
      )}`,
    );
  }

  const require = createRequire(import.meta.url);
  const scorerModule = require(path.join(runtimeDir, "compatibility", "scorer.js"));
  const versionModule = require(path.join(runtimeDir, "compatibility", "scoring-version.js"));
  const entitlementsModule = require(path.join(runtimeDir, "entitlements", "evaluate-entitlements.js"));

  if (typeof scorerModule.scorePair !== "function") {
    fail("Compiled scorer module did not export scorePair.");
  }

  if (typeof entitlementsModule.resolveEntitlementsEvaluation !== "function") {
    fail("Compiled evaluate-entitlements module did not export resolveEntitlementsEvaluation.");
  }

  return {
    scorePair: scorerModule.scorePair,
    resolveEntitlementsEvaluation: entitlementsModule.resolveEntitlementsEvaluation,
    COMPONENTS: {
      version: versionModule.COMPATIBILITY_SCORE_VERSION,
      scale_max: versionModule.COMPATIBILITY_SCORE_SCALE_MAX,
      round_digits: versionModule.COMPATIBILITY_SCORE_ROUND_DIGITS,
      weights: versionModule.COMPATIBILITY_COMPONENT_WEIGHTS,
      penalty: versionModule.COMPATIBILITY_PENALTY_CONFIG,
    },
  };
}

async function fetchRowsOrThrow(supabase, table, selectClause, queryMutator) {
  const rows = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    let query = supabase
      .from(table)
      .select(selectClause)
      .range(from, from + pageSize - 1);

    if (typeof queryMutator === "function") {
      query = queryMutator(query);
    }

    const { data, error } = await query;
    if (error) {
      fail(`Failed to load '${table}' rows: ${error.message}`);
    }

    const page = data ?? [];
    rows.push(...page);

    if (page.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return rows;
}

function buildByIdMap(rows, key = "id") {
  const map = new Map();
  for (const row of rows) {
    if (row && row[key]) {
      map.set(row[key], row);
    }
  }
  return map;
}

function buildActiveHoldMap(activeHolds) {
  const map = new Map();
  const now = Date.now();

  for (const hold of activeHolds) {
    if (!hold?.user_id) {
      continue;
    }

    if (!hold.expires_at) {
      map.set(hold.user_id, hold);
      continue;
    }

    const expiresAt = Date.parse(hold.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt > now) {
      map.set(hold.user_id, hold);
    }
  }

  return map;
}

function buildBlockedPairSet(rows) {
  const blocked = new Set();
  for (const row of rows) {
    if (!row?.blocker_user_id || !row?.blocked_user_id) {
      continue;
    }
    blocked.add(`${row.blocker_user_id}|${row.blocked_user_id}`);
  }
  return blocked;
}

function buildTopReasons(breakdown) {
  const labels = {
    interests: "Shared interests",
    traits: "Personality alignment",
    intent: "Intent overlap",
    availability: "Availability overlap",
  };

  return Object.entries(labels)
    .map(([key, label]) => ({
      key,
      label,
      contribution: Number(breakdown[key] ?? 0),
    }))
    .filter((item) => item.contribution > 0)
    .sort((left, right) => right.contribution - left.contribution)
    .slice(0, 3);
}

async function upsertCandidatesInChunks(params) {
  const rowsWithRun = params.candidateRows.map((row) => ({
    match_run_id: params.runId,
    ...row,
  }));

  for (let start = 0; start < rowsWithRun.length; start += params.chunkSize) {
    const chunk = rowsWithRun.slice(start, start + params.chunkSize);

    const { error } = await params.supabase
      .from("match_candidates")
      .upsert(chunk, {
        onConflict: "match_run_id,source_user_id,candidate_user_id",
        ignoreDuplicates: false,
      });

    if (error) {
      fail(`Failed to upsert match candidate rows: ${error.message}`);
    }
  }
}

async function getRunCandidateCount(supabase, runId) {
  const { count, error } = await supabase
    .from("match_candidates")
    .select("id", {
      head: true,
      count: "exact",
    })
    .eq("match_run_id", runId);

  if (error) {
    fail(`Failed to count match candidates for run '${runId}': ${error.message}`);
  }

  return Number(count ?? 0);
}

function hashStableObject(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (value === null) {
    return "null";
  }

  const valueType = typeof value;
  if (valueType === "number" || valueType === "boolean") {
    return JSON.stringify(value);
  }

  if (valueType === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (valueType === "object") {
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",");
    return `{${entries}}`;
  }

  throw new Error(`Unsupported value type '${valueType}' for stable stringify.`);
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
  console.error(`[matching-job] ERROR: ${message}`);
  process.exit(1);
}
