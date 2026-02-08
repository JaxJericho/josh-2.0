import crypto from "crypto";

const REDACT_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "runner_secret",
  "cron_secret",
  "sentry_dsn",
  "next_public_sentry_dsn",
]);

type LogLevel = "debug" | "info" | "warn" | "error";

type LogPayload = {
  level: LogLevel;
  event: string;
  env?: string;
  correlation_id?: string;
  request_id?: string;
  handler?: string;
  status_code?: number;
  duration_ms?: number;
  error_code?: string;
  error_message?: string;
  [key: string]: unknown;
};

function redactValue(key: string, value: unknown): unknown {
  if (REDACT_KEYS.has(key.toLowerCase())) {
    return "[REDACTED]";
  }
  return value;
}

function sanitize(payload: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    output[key] = redactValue(key, value);
  }
  return output;
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}

export function logEvent(payload: LogPayload): void {
  const base = {
    ts: new Date().toISOString(),
    env: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown",
  };

  const entry = sanitize({ ...base, ...payload });
  const line = JSON.stringify(entry);

  if (payload.level === "error") {
    console.error(line);
    return;
  }
  if (payload.level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function isStaging(): boolean {
  return process.env.SENTRY_ENVIRONMENT === "staging";
}
