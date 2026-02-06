const DEFAULT_BASE_URL = "https://qstash-us-east-1.upstash.io";
const DEFAULT_RUNNER_URL =
  "https://wbeneoawrqvmoufubwzn.supabase.co/functions/v1/twilio-outbound-runner";
const BROKEN_DESTINATION_SUFFIX = "twilio-outbound-runner?limit=5";

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
  exitWithError("RUNNER_URL must not include query parameters.");
}

const apiBase = baseUrl.replace(/\/+$/, "");

const schedules = await listSchedules(apiBase, token);
printSchedules(schedules);

const brokenSchedules = schedules.filter((schedule) =>
  typeof schedule.destination === "string" &&
  schedule.destination.includes(BROKEN_DESTINATION_SUFFIX)
);

if (brokenSchedules.length > 0) {
  if (deleteBroken) {
    for (const schedule of brokenSchedules) {
      if (!schedule.scheduleId) {
        continue;
      }
      await deleteSchedule(apiBase, token, schedule.scheduleId);
      console.log(
        `Deleted broken schedule ${schedule.scheduleId} (${schedule.destination}).`
      );
    }
  } else {
    console.log("Found broken schedules targeting ?limit=5:");
    for (const schedule of brokenSchedules) {
      console.log(`- ${schedule.scheduleId} ${schedule.destination}`);
    }
    console.log(
      "Set QSTASH_DELETE_BROKEN=1 to delete these schedules automatically."
    );
  }
}

const createPayload = {
  destination: runnerUrl,
  cron: "*/1 * * * *",
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ runner_secret: runnerSecret }),
};

const created = await createSchedule(apiBase, token, createPayload);
const createdId = created.scheduleId ?? created.id ?? null;
const createdDestination = created.destination ?? runnerUrl;

console.log("Created schedule:");
console.log(`- scheduleId: ${createdId ?? "unknown"}`);
console.log(`- destination: ${createdDestination}`);

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

async function listSchedules(apiBase, token) {
  const response = await fetch(`${apiBase}/v2/schedules`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const json = await readJson(response);
  if (!response.ok) {
    exitWithError(`Failed to list schedules: ${formatError(json)}`);
  }
  if (Array.isArray(json)) {
    return json;
  }
  if (Array.isArray(json?.schedules)) {
    return json.schedules;
  }
  return [];
}

async function deleteSchedule(apiBase, token, scheduleId) {
  const response = await fetch(`${apiBase}/v2/schedules/${scheduleId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    const json = await readJson(response);
    exitWithError(`Failed to delete schedule: ${formatError(json)}`);
  }
}

async function createSchedule(apiBase, token, payload) {
  const response = await fetch(`${apiBase}/v2/schedules`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await readJson(response);
  if (!response.ok) {
    exitWithError(`Failed to create schedule: ${formatError(json)}`);
  }
  return json ?? {};
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function formatError(json) {
  if (!json) {
    return "unknown error";
  }
  if (typeof json === "string") {
    return json;
  }
  if (json.error) {
    return json.error;
  }
  return JSON.stringify(json);
}

function printSchedules(schedules) {
  console.log("Existing schedules:");
  if (schedules.length === 0) {
    console.log("- none");
    return;
  }
  for (const schedule of schedules) {
    const id = schedule.scheduleId ?? schedule.id ?? "unknown";
    const destination = schedule.destination ?? "unknown";
    const cron = schedule.cron ?? "unknown";
    console.log(`- ${id} ${destination} (${cron})`);
  }
}
