import * as Sentry from "npm:@sentry/deno";
import { resolveSentryRuntimeConfig } from "../../../packages/core/src/observability/sentry-config.ts";
import { createSentryBeforeSend } from "../../../packages/core/src/observability/sentry-sanitizer.ts";
import {
  registerSentryBridge,
  type SentryBridge,
  type SentryCaptureInput,
  type SentryContext,
  type SentrySpanOptions,
} from "../../../packages/core/src/observability/sentry.ts";

let initialized = false;
type SentrySeverity = "debug" | "info" | "warning" | "error" | "fatal";
type ScopeLike = {
  setTag: (key: string, value: string) => void;
  setUser: (user: { id?: string }) => void;
  setLevel: (level: SentrySeverity) => void;
  setContext: (name: string, context: Record<string, string | number | boolean | null>) => void;
};

export function initializeEdgeSentry(service: string): void {
  if (initialized) {
    return;
  }

  const config = resolveSentryRuntimeConfig({
    dsn: Deno.env.get("SENTRY_DSN"),
    environment: Deno.env.get("SENTRY_ENVIRONMENT"),
    release: Deno.env.get("SENTRY_RELEASE"),
  });

  Sentry.init({
    dsn: config.dsn ?? undefined,
    environment: config.environment,
    release: config.release ?? undefined,
    enabled: config.enabled,
    tracesSampleRate: config.tracesSampleRate,
    beforeSend: createSentryBeforeSend(),
    sendDefaultPii: false,
    initialScope: {
      tags: {
        runtime: "supabase_edge",
        service,
      },
    },
  });

  registerSentryBridge(createDenoSentryBridge());
  initialized = true;
}

function createDenoSentryBridge(): SentryBridge {
  return {
    captureException(error: unknown, input?: SentryCaptureInput): void {
      Sentry.withScope((scope) => {
        applySentryScope(scope, input);
        Sentry.captureException(normalizeError(error));
      });
    },
    captureMessage(message: string, input?: SentryCaptureInput): void {
      Sentry.withScope((scope) => {
        applySentryScope(scope, input);
        Sentry.captureMessage(message, toSeverity(input?.level));
      });
    },
    startSpan<T>(options: SentrySpanOptions, callback: () => T): T {
      return Sentry.startSpan(
        {
          name: options.name,
          op: options.op ?? options.name,
          attributes: normalizeSpanAttributes(options.attributes),
        },
        callback,
      );
    },
    withScope<T>(context: SentryContext, callback: () => T): T {
      return Sentry.withScope((scope) => {
        applyScopeContext(scope, context);
        return callback();
      });
    },
    setContext(context: SentryContext): void {
      applyScopeContext(Sentry.getCurrentScope(), context);
    },
  };
}

function applySentryScope(scope: ScopeLike, input?: SentryCaptureInput): void {
  if (!input) {
    return;
  }

  applyScopeContext(scope, input.context);
  const severity = toSeverity(input.level);
  if (severity) {
    scope.setLevel(severity);
  }
  if (input.event) {
    scope.setTag("event", input.event);
  }
  if (input.payload) {
    scope.setContext("payload", normalizeContextPayload(input.payload));
  }
}

function applyScopeContext(scope: ScopeLike, context?: SentryContext): void {
  if (!context) {
    return;
  }
  if (context.category) {
    scope.setTag("category", context.category);
  }
  if (context.correlation_id) {
    scope.setTag("correlation_id", context.correlation_id);
  }
  if (context.linkup_id) {
    scope.setTag("linkup_id", context.linkup_id);
  }
  if (context.user_id) {
    scope.setUser({ id: context.user_id });
  }
  for (const [key, value] of Object.entries(context.tags ?? {})) {
    if (value === null || value === undefined) {
      continue;
    }
    scope.setTag(key, String(value));
  }
}

function normalizeContextPayload(
  payload: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const normalized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      normalized[key] = value;
      continue;
    }
    normalized[key] = value === null ? null : JSON.stringify(value);
  }
  return normalized;
}

function normalizeSpanAttributes(
  attributes: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!attributes) {
    return undefined;
  }
  const normalized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      normalized[key] = value;
      continue;
    }
    if (value === null || value === undefined) {
      continue;
    }
    normalized[key] = JSON.stringify(value);
  }
  return normalized;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === "string" ? error : "Unknown error");
}

function toSeverity(level: string | undefined): SentrySeverity | undefined {
  if (level === "debug" || level === "info" || level === "warning" || level === "error" || level === "fatal") {
    return level;
  }
  if (level === "warn") {
    return "warning";
  }
  return undefined;
}
