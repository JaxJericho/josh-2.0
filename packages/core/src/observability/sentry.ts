import type { LogLevel } from "./logger.ts";

export type SentryContext = {
  correlation_id?: string | null;
  user_id?: string | null;
  linkup_id?: string | null;
  category?: string | null;
  tags?: Record<string, string | number | boolean | null | undefined>;
};

export type SentryCaptureInput = {
  level?: LogLevel;
  event?: string;
  context?: SentryContext;
  payload?: Record<string, unknown>;
};

export type SentrySpanOptions = {
  name: string;
  op?: string;
  attributes?: Record<string, unknown>;
};

export type SentryBridge = {
  captureException: (error: unknown, input?: SentryCaptureInput) => void;
  captureMessage: (message: string, input?: SentryCaptureInput) => void;
  startSpan: <T>(options: SentrySpanOptions, callback: () => T) => T;
  withScope: <T>(context: SentryContext, callback: () => T) => T;
  setContext: (context: SentryContext) => void;
};

const SENTRY_BRIDGE_KEY = Symbol.for("josh.observability.sentry_bridge");

type RuntimeGlobal = {
  [SENTRY_BRIDGE_KEY]?: SentryBridge | null;
};

export function registerSentryBridge(bridge: SentryBridge | null): void {
  const runtime = globalThis as RuntimeGlobal;
  runtime[SENTRY_BRIDGE_KEY] = bridge;
}

export function getSentryBridge(): SentryBridge | null {
  const runtime = globalThis as RuntimeGlobal;
  return runtime[SENTRY_BRIDGE_KEY] ?? null;
}

export function setSentryContext(context: SentryContext): void {
  const bridge = getSentryBridge();
  if (!bridge) {
    return;
  }

  try {
    bridge.setContext(context);
  } catch {
    // Sentry is best-effort; observability must never break request handling.
  }
}

export function withSentryContext<T>(
  context: SentryContext,
  callback: () => T,
): T {
  const bridge = getSentryBridge();
  if (!bridge) {
    return callback();
  }

  try {
    return bridge.withScope(context, callback);
  } catch {
    return callback();
  }
}

export function startSentrySpan<T>(
  options: SentrySpanOptions,
  callback: () => T,
): T {
  const bridge = getSentryBridge();
  if (!bridge) {
    return callback();
  }

  try {
    return bridge.startSpan(options, callback);
  } catch {
    return callback();
  }
}

export function captureSentryException(
  error: unknown,
  input?: SentryCaptureInput,
): void {
  const bridge = getSentryBridge();
  if (!bridge) {
    return;
  }

  try {
    bridge.captureException(error, input);
  } catch {
    // no-op
  }
}

export function captureSentryMessage(
  message: string,
  input?: SentryCaptureInput,
): void {
  const bridge = getSentryBridge();
  if (!bridge) {
    return;
  }

  try {
    bridge.captureMessage(message, input);
  } catch {
    // no-op
  }
}

export function captureSentryFromStructuredLog(logEvent: {
  level: LogLevel;
  event: string;
  category: string;
  correlation_id: string | null;
  user_id: string | null;
  linkup_id: string | null;
  payload: Record<string, unknown>;
}): void {
  if (logEvent.level !== "error" && logEvent.level !== "fatal") {
    return;
  }

  const context: SentryContext = {
    category: logEvent.category,
    correlation_id: logEvent.correlation_id,
    user_id: logEvent.user_id,
    linkup_id: logEvent.linkup_id,
  };

  const payload = logEvent.payload;
  const payloadError = payload.error;
  if (payloadError instanceof Error) {
    captureSentryException(payloadError, {
      level: logEvent.level,
      event: logEvent.event,
      context,
      payload,
    });
    return;
  }

  const errorMessage = readString(payload.error_message);
  const errorName = readString(payload.error_name) ?? "StructuredLogError";
  if (errorMessage) {
    const syntheticError = new Error(errorMessage);
    syntheticError.name = errorName;
    captureSentryException(syntheticError, {
      level: logEvent.level,
      event: logEvent.event,
      context,
      payload,
    });
    return;
  }

  captureSentryMessage(`structured_log.${logEvent.event}`, {
    level: logEvent.level,
    event: logEvent.event,
    context,
    payload,
  });
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
