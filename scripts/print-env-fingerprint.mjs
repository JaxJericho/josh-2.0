import crypto from "crypto";

const VARS = [
  "CRON_SECRET",
  "LOCAL_RUNNER_URL",
  "LOCAL_RUNNER_SECRET",
  "STAGING_RUNNER_URL",
  "STAGING_RUNNER_SECRET",
  "PRODUCTION_RUNNER_URL",
  "PRODUCTION_RUNNER_SECRET",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PROJECT_REF",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_FROM_NUMBER",
  "TWILIO_STATUS_CALLBACK_URL",
  "SMS_BODY_ENCRYPTION_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];

function sha256Prefix(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function isSet(value) {
  return typeof value === "string" && value.length > 0;
}

function fingerprint(name) {
  const value = process.env[name];
  const set = isSet(value);
  const length = set ? value.length : 0;
  const prefix = set ? sha256Prefix(value) : "n/a";
  return { name, set, length, prefix };
}

function main() {
  console.log("Env Fingerprints (safe)");
  for (const name of VARS) {
    const fp = fingerprint(name);
    console.log(
      `${fp.name} is_set=${fp.set} length=${fp.length} sha256_8=${fp.prefix}`
    );
  }
}

main();
