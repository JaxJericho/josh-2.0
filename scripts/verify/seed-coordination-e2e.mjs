import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

loadDotEnv(".env.local");

const args = parseArgs(process.argv.slice(2));
const stagingDbDsn = requiredEnvAny(["STAGING_DB_DSN", "STAGING_DB_URL"]);

let linkupId = args.linkupId;
let source = "explicit";

if (!linkupId) {
  linkupId = resolveLatestLockedLinkupId(stagingDbDsn);
  if (linkupId) {
    source = "reused_latest_locked";
  }
}

if (!linkupId) {
  linkupId = createAndLockLinkup();
  source = "created_new_locked";
}

const snapshot = readLockSnapshot(stagingDbDsn, linkupId);
if (snapshot.state !== "locked" || !snapshot.locked_at) {
  fail(`LinkUp ${linkupId} is not locked (state=${snapshot.state}).`);
}

console.log(`[seed-coordination-e2e] source=${source}`);
console.log(`[seed-coordination-e2e] linkup_id=${linkupId}`);
console.log(`[seed-coordination-e2e] member_count=${snapshot.member_count}`);
console.log(`[seed-coordination-e2e] lock_version=${snapshot.lock_version}`);
console.log(`[seed-coordination-e2e] locked_at=${snapshot.locked_at}`);
console.log("[seed-coordination-e2e] done=true");

function parseArgs(rawArgs) {
  const parsed = {
    linkupId: null,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    const next = rawArgs[index + 1];

    if (token === "--") {
      continue;
    }

    if (token === "--linkup-id") {
      if (!next) {
        fail("Missing value for --linkup-id.");
      }
      parsed.linkupId = next;
      index += 1;
      continue;
    }

    fail(`Unknown argument '${token}'.`);
  }

  return parsed;
}

function createAndLockLinkup() {
  const seedOutput = runNodeScript("scripts/verify/seed-linkup-e2e.mjs", []);
  const linkupId = readOutputValue(seedOutput, /\[seed-linkup-e2e\] linkup_id=(.+)/);
  if (!linkupId) {
    fail("Unable to parse linkup_id from seed-linkup-e2e output.");
  }

  runNodeScript("scripts/verify/run-linkup-e2e.mjs", ["--linkup-id", linkupId]);
  return linkupId;
}

function resolveLatestLockedLinkupId(dsn) {
  return queryMaybeSingleValue({
    dsn,
    sql: `
      select id::text
      from public.linkups
      where state = 'locked'
        and linkup_create_key like 'ticket_7_2_linkup_e2e_%'
      order by locked_at desc nulls last, created_at desc
      limit 1;
    `,
  });
}

function readLockSnapshot(dsn, linkupId) {
  const row = querySingleValue({
    dsn,
    sql: `
      select concat_ws(
        '|',
        state::text,
        coalesce(locked_at::text, ''),
        lock_version::text,
        (
          select count(*)::text
          from public.linkup_members m
          where m.linkup_id = '${linkupId}'::uuid
            and m.status = 'confirmed'
        )
      )
      from public.linkups
      where id = '${linkupId}'::uuid;
    `,
  });

  const [state, lockedAt, lockVersion, memberCount] = row.split("|");
  return {
    state,
    locked_at: lockedAt,
    lock_version: lockVersion,
    member_count: memberCount,
  };
}

function runNodeScript(scriptPath, args) {
  const result = spawnSync("node", [scriptPath, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    fail(
      `Command failed: node ${scriptPath} ${args.join(" ")} :: ${truncate(
        result.stderr || result.stdout || "unknown error",
        1200,
      )}`,
    );
  }

  return (result.stdout || "").trim();
}

function readOutputValue(output, regex) {
  const match = regex.exec(output);
  if (!match) {
    return null;
  }
  return match[1]?.trim() ?? null;
}

function querySingleValue(params) {
  const result = spawnSync(
    "psql",
    [params.dsn, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", params.sql],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  if (result.status !== 0) {
    fail(`psql query failed: ${truncate(result.stderr || result.stdout || "unknown error", 1000)}`);
  }

  const value = (result.stdout || "").trim();
  if (value.length === 0) {
    fail("psql query returned empty output.");
  }

  return value;
}

function queryMaybeSingleValue(params) {
  const result = spawnSync(
    "psql",
    [params.dsn, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", params.sql],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  if (result.status !== 0) {
    fail(`psql query failed: ${truncate(result.stderr || result.stdout || "unknown error", 1000)}`);
  }

  const value = (result.stdout || "").trim();
  return value.length > 0 ? value : null;
}

function requiredEnvAny(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  fail(`Missing required env var. Expected one of: ${names.join(", ")}`);
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
  console.error(`[seed-coordination-e2e] ERROR: ${message}`);
  process.exit(1);
}
