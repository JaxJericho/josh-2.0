import { afterEach, describe, expect, it, vi } from "vitest";
import { traceApiRoute } from "../../app/lib/sentry";
import { logEvent } from "../../packages/core/src/observability/logger";
import { resolveSentryRuntimeConfig } from "../../packages/core/src/observability/sentry-config";
import { createSentryBeforeSend } from "../../packages/core/src/observability/sentry-sanitizer";
import {
  registerSentryBridge,
  type SentryBridge,
  type SentryCaptureInput,
  type SentryContext,
  type SentrySpanOptions,
} from "../../packages/core/src/observability/sentry";

describe("sentry integration", () => {
  afterEach(() => {
    registerSentryBridge(null);
    vi.restoreAllMocks();
  });

  it("redacts PII and sensitive SMS payload fields in beforeSend", () => {
    const beforeSend = createSentryBeforeSend();
    const event = {
      extra: {
        sms_body: "Meet me at 7 and call +1 (415) 555-1212",
        report_reason_free_text: "user email is alex@example.com",
        contact_exchange_payload: {
          phone: "+1 650 555 0000",
          email: "sam@example.com",
        },
        notes: "backup at backup@example.com",
      },
    };

    const sanitized = beforeSend(event);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain("alex@example.com");
    expect(serialized).not.toContain("415");
    expect(serialized).toContain("[REDACTED_SMS_BODY]");
    expect(serialized).toContain("[REDACTED_REPORT_REASON]");
    expect(serialized).toContain("[REDACTED_CONTACT_EXCHANGE]");
    expect(serialized).toContain("[REDACTED_EMAIL]");
  });

  it("forwards error-level structured logs to Sentry capture", () => {
    const captureException = vi.fn();
    const captureMessage = vi.fn();
    const bridge: SentryBridge = {
      captureException(error: unknown, _input?: SentryCaptureInput) {
        captureException(error);
      },
      captureMessage(message: string, _input?: SentryCaptureInput) {
        captureMessage(message);
      },
      startSpan<T>(_options: SentrySpanOptions, callback: () => T): T {
        return callback();
      },
      withScope<T>(_context: SentryContext, callback: () => T): T {
        return callback();
      },
      setContext(_context: SentryContext): void {},
    };
    registerSentryBridge(bridge);

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logEvent({
      level: "error",
      event: "system.unhandled_error",
      correlation_id: "corr_123",
      payload: {
        phase: "test",
        error_name: "RuntimeError",
        error_message: "failed to process",
      },
    });
    infoSpy.mockRestore();

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledTimes(0);
  });

  it("creates a tracing span for API route execution", async () => {
    const spans: Array<{ name: string; attributes?: Record<string, unknown> }> = [];
    const bridge: SentryBridge = {
      captureException() {},
      captureMessage() {},
      startSpan<T>(options: SentrySpanOptions, callback: () => T): T {
        spans.push({ name: options.name, attributes: options.attributes });
        return callback();
      },
      withScope<T>(_context: SentryContext, callback: () => T): T {
        return callback();
      },
      setContext(_context: SentryContext): void {},
    };
    registerSentryBridge(bridge);

    const result = await traceApiRoute("api/admin/users/role", async () => "ok");
    expect(result).toBe("ok");
    expect(spans).toEqual([
      {
        name: "api.route",
        attributes: { route: "api/admin/users/role" },
      },
    ]);
  });

  it("disables Sentry when DSN is missing", () => {
    const noDsn = resolveSentryRuntimeConfig({
      dsn: "",
      environment: "staging",
      release: "v1.2.3",
    });
    const local = resolveSentryRuntimeConfig({
      dsn: "https://public@sentry.io/1",
      environment: "local",
      release: "v1.2.3",
    });

    expect(noDsn.enabled).toBe(false);
    expect(local.enabled).toBe(false);
  });
});
