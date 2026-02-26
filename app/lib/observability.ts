import crypto from "crypto";
import {
  logEvent as logStructuredEvent,
  type LogLevel,
  type StructuredLogEventInput,
} from "../../packages/core/src/observability/logger";

type LegacyLogPayload = {
  level: LogLevel;
  event: string;
  env?: string;
  user_id?: string | null;
  linkup_id?: string | null;
  correlation_id?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

type LogPayload = StructuredLogEventInput | LegacyLogPayload;

export function generateRequestId(): string {
  return crypto.randomUUID();
}

export function logEvent(payload: LogPayload): void {
  const normalizedPayload = payload as LegacyLogPayload;
  const nestedPayload = (
    typeof normalizedPayload.payload === "object" &&
    normalizedPayload.payload &&
    !Array.isArray(normalizedPayload.payload)
  )
    ? normalizedPayload.payload
    : {};

  const {
    level,
    event,
    env,
    correlation_id,
    user_id,
    linkup_id,
    payload: _ignoredPayload,
    ...legacyTopLevelFields
  } = normalizedPayload;

  logStructuredEvent(
    {
      level: level ?? "info",
      event,
      user_id: typeof user_id === "string" ? user_id : null,
      linkup_id: typeof linkup_id === "string" ? linkup_id : null,
      correlation_id: typeof correlation_id === "string" ? correlation_id : null,
      payload: {
        ...legacyTopLevelFields,
        ...nestedPayload,
      },
    },
    typeof env === "string" ? env : undefined,
  );
}

export function isStaging(): boolean {
  return process.env.SENTRY_ENVIRONMENT === "staging";
}
