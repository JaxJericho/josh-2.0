import { Client } from "@upstash/qstash";

const DEFAULT_BASE_URL = "https://qstash-us-east-1.upstash.io";
const DEFAULT_RUNNER_URL =
  "https://wbeneoawrqvmoufubwzn.supabase.co/functions/v1/twilio-outbound-runner";
const BROKEN_DESTINATION_SUFFIX = "twilio-outbound-runner?limit=5";
const EXPECTED_CRON = "*/1 * * * *";
const EXPECTED_METHOD = "POST";

const token = process.env.QSTASH_TOKEN;
const runnerSecret = process.env.QSTASH_RUNNER_SECRET;
const baseUrl = process.env.QSTASH_BASE_URL ?? DEFAULT_BASE_URL;
const runnerUrl = process.env.RUNNER_URL ?? DEFAULT_RUNNER_URL;
const deleteBroken = process.env.QSTASH_DELETE_BROKEN === "1";

if (!token) {
  exitWithError("Missing QSTASH_TOKEN.");
}
if (!runnerSecret) {
  exitWithError("Missing QSTASH_RUNNER_SECRET.");
}

const parsedRunnerUrl = parseUrl(runnerUrl, "RUNNER_URL");
if (parsedRunnerUrl.search.length > 0) {
  exitWithError(
    "RUNNER_URL must not include query parameters. " +
      "QStash signature verification fails when the destination URL contains query params."
  );
}

const client = new Client({ token, baseUrl: baseUrl.replace(/\/+$/, "") });

// --- List schedules ---

const schedules = await client.schedules.list();
printSchedules(schedules);

// --- Handle broken schedules ---

const brokenSchedules = schedules.filter(
  (s) =>
    typeof s.destination === "string" &&
    s.destination.includes(BROKEN_DESTINATION_SUFFIX)
);

if (brokenSchedules.length > 0) {
  if (deleteBroken) {
    for (const schedule of brokenSchedules) {
      await client.schedules.delete(schedule.scheduleId);
      console.log(
        `Deleted broken schedule ${schedule.scheduleId} (${schedule.destination}).`
      );
    }
  } else {
    console.log(
      "Found schedule(s) targeting ?limit=5 (paused or active). " +
        "Set QSTASH_DELETE_BROKEN=1 to delete."
    );
    for (const schedule of brokenSchedules) {
      console.log(`  - ${schedule.scheduleId} ${schedule.destination}`);
    }
  }
}

// --- Idempotency: check for existing matching schedule ---

const existing = schedules.find(
  (s) =>
    s.destination === runnerUrl &&
    s.cron === EXPECTED_CRON &&
    (s.method ?? "POST") === EXPECTED_METHOD
);

if (existing) {
  console.log("Schedule already exists (skipping creation):");
  console.log(`  - scheduleId: ${existing.scheduleId}`);
  console.log(`  - destination: ${existing.destination}`);
  console.log(`  - cron: ${existing.cron}`);
  process.exit(0);
}

// --- Create schedule ---

const created = await client.schedules.create({
  destination: runnerUrl,
  cron: EXPECTED_CRON,
  method: EXPECTED_METHOD,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ runner_secret: runnerSecret }),
});

const createdId = created.scheduleId;
console.log("Created schedule:");
console.log(`  - scheduleId: ${createdId}`);
console.log(`  - destination: ${runnerUrl}`);

// --- Post-create verification ---

const verified = await client.schedules.list();
const found = verified.find((s) => s.scheduleId === createdId);
if (found) {
  console.log(`Verified: schedule ${createdId} confirmed in list.`);
} else {
  console.warn(
    `Warning: schedule ${createdId} created but not found in verification list.`
  );
}

// --- Helpers ---

function exitWithError(message) {
  console.error(message);
  process.exit(1);
}

function parseUrl(value, label) {
  try {
    return new URL(value);
  } catch {
    exitWithError(`Invalid ${label}: ${value}`);
  }
}

function printSchedules(schedules) {
  console.log("Existing schedules:");
  if (schedules.length === 0) {
    console.log("  - none");
    return;
  }
  for (const schedule of schedules) {
    console.log(
      `  - ${schedule.scheduleId} ${schedule.destination} (${schedule.cron})`
    );
  }
}
