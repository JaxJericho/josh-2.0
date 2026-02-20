import fs from "fs";
import crypto from "crypto";
import path from "path";
import { pathToFileURL } from "url";

const CWD = process.cwd();
const CONTRACT_PATH = path.join(CWD, "docs", "runbooks", "environment-contract.md");
const ENV_FILES = [".env.local", ".env"];
const VALID_ENVS = new Set(["local", "staging", "production"]);
const VALID_HARNESS_QSTASH_MODES = new Set(["stub", "real"]);
const REQUIRED_ONE_OF = [["TWILIO_MESSAGING_SERVICE_SID", "TWILIO_FROM_NUMBER"]];
const REQUIRED_QSTASH_VARS = ["QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"];
const STRIPE_WEBHOOK_SECRET_PATTERN = /^whsec_[A-Za-z0-9]+$/;

const results = [];
let passCount = 0;
let failCount = 0;
let warnCount = 0;

function addResult(status, category, message) {
  results.push({ status, category, message });
  if (status === "PASS") passCount += 1;
  if (status === "FAIL") failCount += 1;
  if (status === "WARN") warnCount += 1;
}

function isSet(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function fingerprint(value) {
  if (!isSet(value)) {
    return "unset";
  }
  const trimmed = value.trim();
  const hashPrefix = crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, 8);
  return `sha256:${hashPrefix} (len=${trimmed.length})`;
}

function parseDotEnvLine(line) {
  if (!line || line.trim().length === 0) return null;
  if (line.trim().startsWith("#")) return null;

  const eq = line.indexOf("=");
  if (eq <= 0) return null;

  const key = line.slice(0, eq).trim();
  if (!/^[A-Z0-9_]+$/.test(key)) return null;

  let value = line.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function loadLocalEnvFiles() {
  for (const rel of ENV_FILES) {
    const fullPath = path.join(CWD, rel);
    if (!fs.existsSync(fullPath)) {
      continue;
    }

    const raw = fs.readFileSync(fullPath, "utf8");
    const lines = raw.split("\n");
    let loaded = 0;

    for (const line of lines) {
      const parsed = parseDotEnvLine(line);
      if (!parsed) continue;
      if (!isSet(process.env[parsed.key])) {
        process.env[parsed.key] = parsed.value;
        loaded += 1;
      }
    }

    addResult("PASS", "Env Sources", `Loaded ${loaded} vars from ${rel} (without overriding existing process.env)`);
  }
}

function parseContractRows() {
  if (!fs.existsSync(CONTRACT_PATH)) {
    addResult("FAIL", "Contract", `Missing canonical contract: ${path.relative(CWD, CONTRACT_PATH)}`);
    return [];
  }

  const raw = fs.readFileSync(CONTRACT_PATH, "utf8");
  const lines = raw.split("\n");
  const rows = [];
  let section = "Unknown";

  for (const line of lines) {
    const header = line.match(/^###\s+(.+)$/);
    if (header) {
      section = header[1].trim();
      continue;
    }

    if (!line.trim().startsWith("|")) {
      continue;
    }

    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 6) {
      continue;
    }

    if (cells[0] === "Name") {
      continue;
    }

    const separatorCell = cells[0].replace(/[:\-\s]/g, "");
    if (separatorCell.length === 0) {
      continue;
    }

    const nameMatch = cells[0].match(/`([A-Z0-9_]+)`/);
    if (!nameMatch) {
      continue;
    }

    rows.push({
      name: nameMatch[1],
      required: cells[1],
      usedBy: cells[2],
      format: cells[3],
      whereSet: cells[4],
      notes: cells[5],
      section,
    });
  }

  addResult("PASS", "Contract", `Parsed ${rows.length} variable rows from ${path.relative(CWD, CONTRACT_PATH)}`);
  return rows;
}

function envAliases(appEnv) {
  if (appEnv === "production") return ["production", "prod"];
  return [appEnv];
}

function appliesToEnv(row, appEnv) {
  const where = row.whereSet.toLowerCase();
  const aliases = envAliases(appEnv);

  const hasEnvScope = aliases.some((alias) => where.includes(`${alias}:`));
  if (!hasEnvScope) return false;

  if (appEnv === "production" && /production:\s*not used|not used in prod runtime/.test(where)) {
    return false;
  }
  if (appEnv === "staging" && /staging:\s*not used/.test(where)) {
    return false;
  }
  if (appEnv === "local" && /local:\s*not used/.test(where)) {
    return false;
  }

  return true;
}

function isRequiredForEnv(row, appEnv) {
  const required = row.required.toLowerCase().trim();
  if (!required.startsWith("yes")) {
    return false;
  }

  if (appEnv === "local" && /\bno\s*\(local\)/.test(required)) {
    return false;
  }
  if (appEnv === "staging" && /\bno\s*\(staging\)/.test(required)) {
    return false;
  }
  if (appEnv === "production" && /\bno\s*\((production|prod)\)/.test(required)) {
    return false;
  }

  return true;
}

function isConditionalRequirement(row) {
  const text = `${row.required} ${row.usedBy} ${row.notes}`.toLowerCase();

  return /near-term|planned|placeholder|only if|build-time optional|\boptional\b|deprecated|legacy/.test(text);
}

export function isDbUrlVar(name) {
  return name.endsWith("_DB_URL");
}

function isLikelyUrlVar(name) {
  if (name === "STRIPE_WEBHOOK_SECRET" || isDbUrlVar(name)) {
    return false;
  }
  return name.endsWith("_URL") || name === "APP_BASE_URL" || name.includes("WEBHOOK") || name.includes("CALLBACK");
}

export function isValidStripeWebhookSecret(value) {
  return isSet(value) && STRIPE_WEBHOOK_SECRET_PATTERN.test(value.trim());
}

export function isValidDbUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "postgres:" || parsed.protocol === "postgresql:";
  } catch {
    return false;
  }
}

function validateUrlFormat(name, value) {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      addResult("FAIL", "Format", `${name} must use http or https scheme.`);
      return;
    }

    if (name.endsWith("RUNNER_URL") && parsed.search.length > 0) {
      addResult("FAIL", "Format", `${name} must not include query params.`);
      return;
    }

    addResult("PASS", "Format", `${name} is a valid URL (${parsed.origin}).`);
  } catch {
    addResult("FAIL", "Format", `${name} is not a valid URL.`);
  }
}

function validateDbUrlFormat(name, value) {
  if (isValidDbUrl(value)) {
    addResult("PASS", "Format", `${name} is a valid PostgreSQL URL.`);
    return;
  }
  addResult("FAIL", "Format", `${name} must be a valid PostgreSQL URL using postgres:// or postgresql:// scheme.`);
}

function validateStripeWebhookSecretFormat(value) {
  if (isValidStripeWebhookSecret(value)) {
    addResult("PASS", "Format", "STRIPE_WEBHOOK_SECRET matches expected whsec_ pattern.");
    return;
  }
  addResult("FAIL", "Format", "STRIPE_WEBHOOK_SECRET must start with whsec_ and contain only alphanumeric characters after the prefix.");
}

function detectEnvironment() {
  const raw = process.env.APP_ENV;
  if (!isSet(raw)) {
    addResult("FAIL", "Environment", "APP_ENV is required and must be one of: local, staging, production.");
    return null;
  }

  const env = raw.trim().toLowerCase();
  if (!VALID_ENVS.has(env)) {
    addResult("FAIL", "Environment", `APP_ENV='${raw}' is invalid. Expected one of: local, staging, production.`);
    return null;
  }

  addResult("PASS", "Environment", `Detected environment: ${env}`);
  return env;
}

function checkRequiredVars(rows, appEnv) {
  const inScope = rows.filter((row) => appliesToEnv(row, appEnv));
  const required = inScope.filter((row) => isRequiredForEnv(row, appEnv));
  const hardRequired = required.filter((row) => !isConditionalRequirement(row));
  const conditional = required.filter((row) => isConditionalRequirement(row));

  addResult("PASS", "Contract", `Derived ${hardRequired.length} hard-required and ${conditional.length} conditional-required vars for ${appEnv}.`);

  const hardByName = new Map();
  for (const row of hardRequired) {
    if (!hardByName.has(row.name)) {
      hardByName.set(row.name, row);
    }
  }

  for (const [left, right] of REQUIRED_ONE_OF) {
    const leftRow = hardByName.get(left);
    const rightRow = hardByName.get(right);
    if (!leftRow && !rightRow) {
      continue;
    }

    hardByName.delete(left);
    hardByName.delete(right);

    const leftValue = process.env[left];
    const rightValue = process.env[right];
    if (!isSet(leftValue) && !isSet(rightValue)) {
      addResult(
        "FAIL",
        "Required Vars",
        `${left} or ${right} must be set for ${appEnv}. (${left}=${fingerprint(leftValue)}, ${right}=${fingerprint(rightValue)})`
      );
    } else {
      const winner = isSet(leftValue) ? left : right;
      addResult("PASS", "Required Vars", `One-of requirement satisfied by ${winner} (${fingerprint(process.env[winner])}).`);
    }
  }

  for (const [name, row] of hardByName.entries()) {
    const value = process.env[name];
    if (!isSet(value)) {
      addResult(
        "FAIL",
        "Required Vars",
        `${name} is required for ${appEnv}. Where set: ${row.whereSet}`
      );
      continue;
    }

    addResult("PASS", "Required Vars", `${name} is set (${fingerprint(value)}).`);
  }

  for (const row of conditional) {
    const value = process.env[row.name];
    if (isSet(value)) {
      addResult("PASS", "Conditional Vars", `${row.name} is set (${fingerprint(value)}).`);
    } else {
      addResult("WARN", "Conditional Vars", `${row.name} is conditionally required (${row.required}). Set it when enabling: ${row.usedBy}`);
    }
  }
}

function checkQStashVars() {
  for (const name of REQUIRED_QSTASH_VARS) {
    const value = process.env[name];
    if (!isSet(value)) {
      addResult(
        "FAIL",
        "QStash",
        `${name} is required for the QStash integration layer and must be set.`
      );
      continue;
    }

    addResult("PASS", "QStash", `${name} is set (${fingerprint(value)}).`);
  }
}

function checkHarnessQStashMode() {
  const raw = process.env.HARNESS_QSTASH_MODE;
  if (!isSet(raw)) {
    return;
  }

  const normalized = raw.trim().toLowerCase();
  if (!VALID_HARNESS_QSTASH_MODES.has(normalized)) {
    addResult(
      "FAIL",
      "Harness",
      `HARNESS_QSTASH_MODE='${raw}' is invalid. Expected one of: stub, real.`
    );
    return;
  }

  addResult("PASS", "Harness", `HARNESS_QSTASH_MODE is set to '${normalized}'.`);
}

async function checkSupabaseConnectivity() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!isSet(supabaseUrl) || !isSet(anonKey)) {
    addResult(
      "FAIL",
      "Supabase Connectivity",
      "SUPABASE_URL and SUPABASE_ANON_KEY are required for connectivity check."
    );
    return;
  }

  let endpoint;
  try {
    const parsed = new URL(supabaseUrl);
    endpoint = `${parsed.origin}/rest/v1/`;
  } catch {
    addResult("FAIL", "Supabase Connectivity", "Cannot run connectivity check because SUPABASE_URL is not a valid URL.");
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Prefer: "count=none",
      },
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      addResult(
        "FAIL",
        "Supabase Connectivity",
        `Supabase responded ${response.status}. Hint: SUPABASE_ANON_KEY may not match SUPABASE_URL project.`
      );
      return;
    }

    if (response.status >= 500) {
      addResult(
        "FAIL",
        "Supabase Connectivity",
        `Supabase responded ${response.status}. Hint: service may be unavailable.`
      );
      return;
    }

    addResult(
      "PASS",
      "Supabase Connectivity",
      `Connectivity probe succeeded against /rest/v1/ (status=${response.status}).`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addResult(
      "FAIL",
      "Supabase Connectivity",
      `Connectivity probe failed: ${message}. Hint: check network reachability and SUPABASE_URL.`
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function checkUrlVars() {
  const urlNames = new Set();
  const dbUrlNames = new Set();

  for (const name of Object.keys(process.env)) {
    if (isDbUrlVar(name)) {
      dbUrlNames.add(name);
      continue;
    }
    if (isLikelyUrlVar(name)) {
      urlNames.add(name);
    }
  }

  if (urlNames.has("APP_BASE_URL") && !isSet(process.env.APP_BASE_URL)) {
    addResult("FAIL", "Format", "APP_BASE_URL is present but empty.");
  }

  const sortedUrls = Array.from(urlNames).sort();
  for (const name of sortedUrls) {
    const value = process.env[name];
    if (!isSet(value)) {
      continue;
    }
    validateUrlFormat(name, value);
  }

  const sortedDbUrls = Array.from(dbUrlNames).sort();
  for (const name of sortedDbUrls) {
    const value = process.env[name];
    if (!isSet(value)) {
      continue;
    }
    validateDbUrlFormat(name, value);
  }

  if (isSet(process.env.STRIPE_WEBHOOK_SECRET)) {
    validateStripeWebhookSecretFormat(process.env.STRIPE_WEBHOOK_SECRET);
  }

  if (sortedUrls.length === 0 && sortedDbUrls.length === 0 && !isSet(process.env.STRIPE_WEBHOOK_SECRET)) {
    addResult("WARN", "Format", "No URL/db URL/webhook secret variables were detected for format validation.");
  }
}

function printReport() {
  console.log("JOSH Doctor Preflight");

  const envValue = isSet(process.env.APP_ENV) ? process.env.APP_ENV.trim().toLowerCase() : "(unset)";
  console.log(`Environment (APP_ENV): ${envValue}`);

  for (const entry of results) {
    console.log(`${entry.status.padEnd(4)} [${entry.category}] ${entry.message}`);
  }

  console.log(`Summary: PASS=${passCount} WARN=${warnCount} FAIL=${failCount}`);
}

async function main() {
  loadLocalEnvFiles();

  const appEnv = detectEnvironment();
  const rows = parseContractRows();

  if (rows.length > 0 && appEnv) {
    checkRequiredVars(rows, appEnv);
  }

  checkQStashVars();
  checkHarnessQStashMode();
  checkUrlVars();
  await checkSupabaseConnectivity();

  printReport();

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
