import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

loadDotEnv(".env.local");

const args = parseArgs(process.argv.slice(2));
const stagingDbDsn = requiredEnvAny(["STAGING_DB_DSN", "STAGING_DB_URL"]);
const smsEncryptionKey = requiredEnv("SMS_BODY_ENCRYPTION_KEY");

const linkupId = args.linkupId ?? resolveLatestLockedLinkupId(stagingDbDsn);
if (!linkupId) {
  fail("No locked LinkUp found. Run: pnpm run verify:coordination:seed");
}

const lockState = querySingleValue({
  dsn: stagingDbDsn,
  sql: `
    select state::text
    from public.linkups
    where id = '${linkupId}'::uuid;
  `,
});

if (lockState !== "locked") {
  fail(`LinkUp ${linkupId} is not locked (state=${lockState}).`);
}

const before = snapshot(stagingDbDsn, linkupId);

const firstRun = runEnqueue({
  dsn: stagingDbDsn,
  linkupId,
  smsEncryptionKey,
  label: "first",
});

const afterFirst = snapshot(stagingDbDsn, linkupId);

const secondRun = runEnqueue({
  dsn: stagingDbDsn,
  linkupId,
  smsEncryptionKey,
  label: "replay",
});

const afterSecond = snapshot(stagingDbDsn, linkupId);

const coordinationCreatedCount = readInt(firstRun.prepared_created_count);
const coordinationExistingReplay = readInt(secondRun.prepared_existing_count);
const jobsInsertedReplay = readInt(secondRun.jobs_inserted_count);

const idempotentReplay =
  afterFirst.coordination_total === afterSecond.coordination_total &&
  afterFirst.jobs_total === afterSecond.jobs_total &&
  jobsInsertedReplay === 0;

console.log(`[coordination-e2e] linkup_id=${linkupId}`);
console.log(`[coordination-e2e] member_count=${afterSecond.member_count}`);
console.log(`[coordination-e2e] coordination_created_count=${coordinationCreatedCount}`);
console.log(`[coordination-e2e] coordination_existing_count=${coordinationExistingReplay}`);
console.log(`[coordination-e2e] jobs_inserted_first=${readInt(firstRun.jobs_inserted_count)}`);
console.log(`[coordination-e2e] jobs_inserted_replay=${jobsInsertedReplay}`);
console.log(`[coordination-e2e] coordination_total_before=${before.coordination_total}`);
console.log(`[coordination-e2e] coordination_total_after=${afterSecond.coordination_total}`);
console.log(`[coordination-e2e] jobs_total_before=${before.jobs_total}`);
console.log(`[coordination-e2e] jobs_total_after=${afterSecond.jobs_total}`);
console.log(`[coordination-e2e] status_pending=${afterSecond.pending_count}`);
console.log(`[coordination-e2e] status_enqueued=${afterSecond.enqueued_count}`);
console.log(`[coordination-e2e] status_sent=${afterSecond.sent_count}`);
console.log(`[coordination-e2e] status_failed=${afterSecond.failed_count}`);
console.log(`[coordination-e2e] status_suppressed=${afterSecond.suppressed_count}`);
console.log(`[coordination-e2e] idempotent_replay=${idempotentReplay}`);
console.log("[coordination-e2e] done=true");

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

function runEnqueue(params) {
  const raw = querySingleValue({
    dsn: params.dsn,
    sql: `
      select public.linkup_enqueue_coordination_messages(
        '${params.linkupId}'::uuid,
        '${escapeSqlLiteral(params.smsEncryptionKey)}',
        now()
      )::text;
    `,
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(`Unable to parse enqueue payload (${params.label}): ${raw}`);
  }

  return parsed;
}

function snapshot(dsn, linkupId) {
  const row = querySingleValue({
    dsn,
    sql: `
      select concat_ws(
        '|',
        (
          select count(*)::text
          from public.linkup_members m
          where m.linkup_id = '${linkupId}'::uuid
            and m.status = 'confirmed'
        ),
        (
          select count(*)::text
          from public.linkup_coordination_messages cm
          where cm.linkup_id = '${linkupId}'::uuid
        ),
        (
          select count(*)::text
          from public.linkup_coordination_messages cm
          where cm.linkup_id = '${linkupId}'::uuid
            and cm.status = 'pending'
        ),
        (
          select count(*)::text
          from public.linkup_coordination_messages cm
          where cm.linkup_id = '${linkupId}'::uuid
            and cm.status = 'enqueued'
        ),
        (
          select count(*)::text
          from public.linkup_coordination_messages cm
          where cm.linkup_id = '${linkupId}'::uuid
            and cm.status = 'sent'
        ),
        (
          select count(*)::text
          from public.linkup_coordination_messages cm
          where cm.linkup_id = '${linkupId}'::uuid
            and cm.status = 'failed'
        ),
        (
          select count(*)::text
          from public.linkup_coordination_messages cm
          where cm.linkup_id = '${linkupId}'::uuid
            and cm.status = 'suppressed'
        ),
        (
          select count(*)::text
          from public.sms_outbound_jobs jobs
          where jobs.purpose = 'linkup_coordination'
            and exists (
              select 1
              from public.linkup_coordination_messages cm
              where cm.linkup_id = '${linkupId}'::uuid
                and cm.sms_outbound_job_id = jobs.id
            )
        )
      );
    `,
  });

  const [
    memberCount,
    coordinationTotal,
    pendingCount,
    enqueuedCount,
    sentCount,
    failedCount,
    suppressedCount,
    jobsTotal,
  ] = row.split("|");

  return {
    member_count: memberCount,
    coordination_total: coordinationTotal,
    pending_count: pendingCount,
    enqueued_count: enqueuedCount,
    sent_count: sentCount,
    failed_count: failedCount,
    suppressed_count: suppressedCount,
    jobs_total: jobsTotal,
  };
}

function readInt(value) {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
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

function escapeSqlLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    fail(`Missing required env var: ${name}`);
  }
  return value.trim();
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
  console.error(`[coordination-e2e] ERROR: ${message}`);
  process.exit(1);
}
