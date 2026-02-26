import {
  EVENT_CATALOG_BY_NAME,
  type CanonicalEventName,
  type EventCatalogEntry,
} from "./event-catalog.ts";
import { redactPII } from "./redaction.ts";
import { captureSentryFromStructuredLog } from "./sentry.ts";

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type StructuredLogEventInput = {
  event: CanonicalEventName | string;
  user_id?: string | null;
  linkup_id?: string | null;
  correlation_id?: string | null;
  payload: Record<string, unknown>;
  level?: LogLevel;
};

export type StructuredLogEvent = {
  ts: string;
  level: LogLevel;
  event: string;
  category: string;
  env: string;
  correlation_id: string | null;
  user_id: string | null;
  linkup_id: string | null;
  payload: Record<string, unknown>;
};

export type LoggerContext = {
  env?: string;
  correlation_id?: string | null;
  user_id?: string | null;
  linkup_id?: string | null;
};

export function isKnownEventName(event: string): event is CanonicalEventName {
  return Boolean(EVENT_CATALOG_BY_NAME[event]);
}

export function createLogger(context: LoggerContext = {}): (
  input: StructuredLogEventInput,
) => StructuredLogEvent {
  return (input) => logEvent({
    ...input,
    correlation_id: normalizeString(input.correlation_id) ??
      normalizeString(context.correlation_id) ??
      null,
    user_id: normalizeString(input.user_id) ?? normalizeString(context.user_id) ?? null,
    linkup_id: normalizeString(input.linkup_id) ?? normalizeString(context.linkup_id) ?? null,
    payload: input.payload,
    level: input.level,
  }, context.env);
}

export function logEvent(input: StructuredLogEventInput, explicitEnv?: string): StructuredLogEvent {
  const eventDef = resolveEventDefinition(input.event);
  const payload = ensurePayloadObject(input.payload);
  assertRequiredFields(eventDef, payload);

  const redactedPayload = redactPII(payload);
  const correlationId = normalizeString(input.correlation_id) ??
    normalizeString(readString(redactedPayload, "correlation_id")) ??
    null;
  const env = normalizeEnv(explicitEnv ?? detectRuntimeEnv());

  const event: StructuredLogEvent = {
    ts: new Date().toISOString(),
    level: input.level ?? "info",
    event: eventDef.event_name,
    category: eventDef.category,
    env,
    correlation_id: correlationId,
    user_id: normalizeString(input.user_id),
    linkup_id: normalizeString(input.linkup_id),
    payload: redactedPayload,
  };

  console.info(JSON.stringify(event));
  captureSentryFromStructuredLog(event);
  return event;
}
export { redactPII } from "./redaction.ts";

function resolveEventDefinition(event: string): EventCatalogEntry {
  const normalized = event.trim();
  const eventDef = EVENT_CATALOG_BY_NAME[normalized];
  if (!eventDef) {
    throw new Error(`Unknown structured log event: '${event}'.`);
  }
  return eventDef;
}

function ensurePayloadObject(payload: Record<string, unknown>): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Structured log payload must be an object.");
  }
  return payload;
}

function assertRequiredFields(
  eventDef: EventCatalogEntry,
  payload: Record<string, unknown>,
): void {
  for (const requiredField of eventDef.required_fields) {
    const value = payload[requiredField];
    if (isPresent(value)) {
      continue;
    }
    throw new Error(
      `Missing required field '${requiredField}' for log event '${eventDef.event_name}'.`,
    );
  }
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
}

function detectRuntimeEnv(): string {
  const appEnv = readEnv("APP_ENV");
  if (appEnv) {
    return appEnv;
  }
  const sentryEnv = readEnv("SENTRY_ENVIRONMENT");
  if (sentryEnv) {
    return sentryEnv;
  }
  const nodeEnv = readEnv("NODE_ENV");
  if (nodeEnv) {
    return nodeEnv;
  }
  return "local";
}

function readEnv(name: string): string | undefined {
  const denoRuntime = (globalThis as unknown as {
    Deno?: { env?: { get?: (key: string) => string | undefined } };
  }).Deno;
  const denoValue = denoRuntime?.env?.get?.(name);
  if (typeof denoValue === "string" && denoValue.trim()) {
    return denoValue.trim();
  }

  const nodeRuntime = (globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  const nodeValue = nodeRuntime?.env?.[name];
  if (typeof nodeValue === "string" && nodeValue.trim()) {
    return nodeValue.trim();
  }

  return undefined;
}

function normalizeEnv(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value === "staging") {
    return "staging";
  }
  if (value === "production" || value === "prod") {
    return "production";
  }
  return "local";
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
