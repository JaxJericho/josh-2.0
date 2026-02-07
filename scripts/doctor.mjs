import fs from "fs";
import path from "path";
import crypto from "crypto";

const CWD = process.cwd();
const SECTIONS = [
  "Summary",
  "Env Sources",
  "Env Var Fingerprints",
  "URL Shape Checks",
  "Supabase Config Checks",
  "Function Presence Checks",
  "Scheduler Readiness Checks",
  "Repo Scripts Checks",
  "Next Actions",
];

const results = new Map();
let passCount = 0;
let failCount = 0;
let warnCount = 0;

function addResult(section, status, message) {
  if (!results.has(section)) {
    results.set(section, []);
  }
  results.get(section).push({ status, message });
  if (status === "PASS") passCount += 1;
  if (status === "FAIL") failCount += 1;
  if (status === "WARN") warnCount += 1;
}

function sha256Prefix(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function isSet(value) {
  return typeof value === "string" && value.length > 0;
}

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function checkEnvSources() {
  const envPath = path.join(CWD, ".env");
  const envLocalPath = path.join(CWD, ".env.local");

  if (fs.existsSync(envPath)) {
    addResult("Env Sources", "PASS", "Found .env");
  } else {
    addResult("Env Sources", "WARN", "Missing .env");
  }

  if (fs.existsSync(envLocalPath)) {
    addResult("Env Sources", "PASS", "Found .env.local");
  } else {
    addResult("Env Sources", "WARN", "Missing .env.local");
  }

  const envKeys = Object.keys(process.env).length;
  addResult("Env Sources", "PASS", `process.env keys detected: ${envKeys}`);
}

const FINGERPRINT_VARS = [
  "CRON_SECRET",
  "LOCAL_RUNNER_URL",
  "LOCAL_RUNNER_SECRET",
  "STAGING_RUNNER_URL",
  "STAGING_RUNNER_SECRET",
  "PRODUCTION_RUNNER_URL",
  "PRODUCTION_RUNNER_SECRET",
  "SUPABASE_FUNCTIONS_URL",
];

function checkEnvFingerprints() {
  for (const name of FINGERPRINT_VARS) {
    const value = process.env[name];
    const set = isSet(value);
    const length = set ? value.length : 0;
    const prefix = set ? sha256Prefix(value) : "n/a";
    const status = set ? "PASS" : "WARN";
    addResult(
      "Env Var Fingerprints",
      status,
      `${name} is_set=${set} length=${length} sha256_8=${prefix}`
    );
  }
}

const RUNNER_URL_VARS = [
  "LOCAL_RUNNER_URL",
  "STAGING_RUNNER_URL",
  "PRODUCTION_RUNNER_URL",
];

function checkUrlShapes() {
  for (const name of RUNNER_URL_VARS) {
    const value = process.env[name];
    if (!isSet(value)) {
      addResult("URL Shape Checks", "WARN", `${name} is not set`);
      continue;
    }
    if (value.includes("?")) {
      addResult(
        "URL Shape Checks",
        "FAIL",
        `${name} contains query params. Remove everything after ?`
      );
    } else {
      addResult("URL Shape Checks", "PASS", `${name} has no query params`);
    }
  }

  const functionsBase = process.env.SUPABASE_FUNCTIONS_URL;
  if (!isSet(functionsBase)) {
    addResult("URL Shape Checks", "WARN", "SUPABASE_FUNCTIONS_URL is not set");
    return;
  }

  const pattern = /^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/?$/;
  if (pattern.test(functionsBase)) {
    addResult(
      "URL Shape Checks",
      "PASS",
      "SUPABASE_FUNCTIONS_URL matches expected base format"
    );
  } else {
    addResult(
      "URL Shape Checks",
      "FAIL",
      "SUPABASE_FUNCTIONS_URL format is invalid. Expected https://<ref>.supabase.co/functions/v1"
    );
  }
}

function parseVerifyJwtValues(toml) {
  const targetFunctions = new Set([
    "twilio-inbound",
    "twilio-status-callback",
  ]);
  const values = new Map();
  let currentFunction = null;

  for (const rawLine of toml.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const sectionMatch = line.match(/^\[functions\.([\w-]+)\]$/);
    if (sectionMatch) {
      const name = sectionMatch[1];
      currentFunction = targetFunctions.has(name) ? name : null;
      continue;
    }

    if (!currentFunction) continue;
    const verifyMatch = line.match(/^verify_jwt\s*=\s*(true|false)\s*$/);
    if (verifyMatch) {
      values.set(currentFunction, verifyMatch[1] === "true");
    }
  }

  return values;
}

function checkSupabaseConfig() {
  const configPath = path.join(CWD, "supabase", "config.toml");
  const toml = readFileIfExists(configPath);
  if (!toml) {
    addResult("Supabase Config Checks", "FAIL", "Missing supabase/config.toml");
    return;
  }

  const values = parseVerifyJwtValues(toml);
  for (const fnName of ["twilio-inbound", "twilio-status-callback"]) {
    if (!values.has(fnName)) {
      addResult(
        "Supabase Config Checks",
        "WARN",
        `Missing verify_jwt for ${fnName}. Add [functions.${fnName}] with verify_jwt = false`
      );
      continue;
    }
    const enabled = values.get(fnName);
    if (enabled === false) {
      addResult(
        "Supabase Config Checks",
        "PASS",
        `${fnName} verify_jwt is false`
      );
    } else {
      addResult(
        "Supabase Config Checks",
        "WARN",
        `${fnName} verify_jwt is true; expected false`
      );
    }
  }
}

function checkFunctionPresence() {
  const functions = [
    "twilio-inbound",
    "twilio-outbound-runner",
    "twilio-status-callback",
  ];
  for (const fnName of functions) {
    const fnPath = path.join(CWD, "supabase", "functions", fnName);
    if (fs.existsSync(fnPath) && fs.statSync(fnPath).isDirectory()) {
      addResult(
        "Function Presence Checks",
        "PASS",
        `Found supabase/functions/${fnName}/`
      );
    } else {
      addResult(
        "Function Presence Checks",
        "FAIL",
        `Missing supabase/functions/${fnName}/`
      );
    }
  }
}

function checkSchedulerReadiness() {
  const docPath = path.join(CWD, "docs", "runbooks", "environment-contract.md");
  const doc = readFileIfExists(docPath);
  if (!doc) {
    addResult(
      "Scheduler Readiness Checks",
      "FAIL",
      "Missing docs/runbooks/environment-contract.md"
    );
    return;
  }

  const required = [
    "CRON_SECRET",
    "STAGING_RUNNER_URL",
    "STAGING_RUNNER_SECRET",
  ];

  for (const name of required) {
    if (doc.includes(name)) {
      addResult(
        "Scheduler Readiness Checks",
        "PASS",
        `Documented in environment-contract.md: ${name}`
      );
    } else {
      addResult(
        "Scheduler Readiness Checks",
        "FAIL",
        `Missing in environment-contract.md: ${name}`
      );
    }
  }
}

function checkRepoScripts() {
  const pkgPath = path.join(CWD, "package.json");
  const pkgRaw = readFileIfExists(pkgPath);
  if (!pkgRaw) {
    addResult("Repo Scripts Checks", "FAIL", "Missing package.json");
    return;
  }

  let scripts = {};
  try {
    const pkg = JSON.parse(pkgRaw);
    scripts = pkg.scripts ?? {};
  } catch {
    addResult("Repo Scripts Checks", "FAIL", "package.json is not valid JSON");
    return;
  }

  const expected = ["lint", "typecheck", "test", "build"];
  for (const name of expected) {
    if (scripts[name]) {
      addResult("Repo Scripts Checks", "PASS", `Found script: ${name}`);
    } else {
      addResult("Repo Scripts Checks", "WARN", `Missing script: ${name}`);
    }
  }
}

function checkNextActions() {
  const next = ["0.4", "0.5", "0.6", "2.3", "2.4"];
  for (const ticket of next) {
    addResult("Next Actions", "WARN", `Ticket ${ticket}`);
  }
}

function checkRemoteOptIn() {
  if (process.env.DOCTOR_REMOTE === "1") {
    addResult(
      "Env Sources",
      "WARN",
      "DOCTOR_REMOTE=1 set, but no remote checks are implemented"
    );
  }
}

function printReport() {
  const summary = `Summary: PASS=${passCount} FAIL=${failCount} WARN=${warnCount}`;
  console.log(summary);

  for (const section of SECTIONS) {
    if (section === "Summary") continue;
    console.log(`\n${section}`);
    const entries = results.get(section) ?? [];
    if (entries.length === 0) {
      console.log("  WARN: No checks recorded");
      continue;
    }
    for (const entry of entries) {
      console.log(`  ${entry.status}: ${entry.message}`);
    }
  }
}

function main() {
  checkEnvSources();
  checkRemoteOptIn();
  checkEnvFingerprints();
  checkUrlShapes();
  checkSupabaseConfig();
  checkFunctionPresence();
  checkSchedulerReadiness();
  checkRepoScripts();
  checkNextActions();
  printReport();

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main();
