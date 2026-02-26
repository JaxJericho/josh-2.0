import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { EVENT_CATALOG_BY_NAME } from "../../packages/core/src/observability/event-catalog";
import { logEvent } from "../../packages/core/src/observability/logger";

const REQUIRED_CANONICAL_EVENTS = [
  "conversation.router_decision",
  "conversation.mode_transition",
  "conversation.state_transition",
  "safety.keyword_detected",
  "safety.rate_limit_exceeded",
  "safety.strike_applied",
  "safety.crisis_intercepted",
  "safety.block_created",
  "safety.blocked_message_attempt",
  "safety.report_created",
  "post_event.attendance_recorded",
  "post_event.learning_signal_written",
  "post_event.contact_exchange_opt_in",
  "post_event.contact_exchange_revealed",
  "admin.action_performed",
  "admin.role_updated",
  "admin.safety_hold_toggled",
  "admin.incident_status_updated",
  "system.unhandled_error",
  "system.rpc_failure",
  "system.migration_mismatch_warning",
] as const;

describe("structured logger contract", () => {
  it("includes all required canonical events in the catalog", () => {
    const missing = REQUIRED_CANONICAL_EVENTS.filter((eventName) => !EVENT_CATALOG_BY_NAME[eventName]);
    expect(missing).toEqual([]);
  });

  it("throws when an unknown event is logged", () => {
    expect(() =>
      logEvent({
        event: "unknown.event",
        payload: {},
      })).toThrow("Unknown structured log event");
  });

  it("enforces required event payload fields", () => {
    expect(() =>
      logEvent({
        event: "conversation.router_decision",
        payload: {
          session_mode: "idle",
          session_state_token: "idle",
        },
      })).toThrow("Missing required field 'route'");
  });

  it("redacts PII in emitted structured logs", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      logEvent({
        event: "safety.report_created",
        user_id: "user_123",
        correlation_id: "corr_123",
        payload: {
          reporter_user_id: "user_123",
          reported_user_id: "user_999",
          reason_category: "other",
          report_reason_free_text: "He texted me at alex@example.com and +1 (415) 555-1212",
          contact_exchange_payload: {
            email: "alex@example.com",
            phone: "+14155551212",
          },
          notes: "Reach out at +1 650 555 9000 or email sam@example.com",
        },
      });
      expect(infoSpy).toHaveBeenCalledTimes(1);
      const [line] = infoSpy.mock.calls[0] ?? [];
      expect(typeof line).toBe("string");

      const parsed = JSON.parse(String(line)) as {
        payload: Record<string, unknown>;
      };
      const serialized = JSON.stringify(parsed);

      expect(parsed.payload.report_reason_free_text).toBe("[REDACTED_REPORT_REASON]");
      expect(parsed.payload.contact_exchange_payload).toBe("[REDACTED_CONTACT_EXCHANGE]");
      expect(serialized).not.toContain("alex@example.com");
      expect(serialized).not.toContain("4155551212");
      expect(serialized).toContain("[REDACTED_EMAIL]");
      expect(serialized).toContain("[REDACTED_PHONE]");
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("ensures literal logEvent event names exist in the catalog", () => {
    const roots = ["app", "supabase/functions", "packages"];
    const literalEvents = new Set<string>();

    for (const root of roots) {
      const absoluteRoot = path.resolve(process.cwd(), root);
      if (!fs.existsSync(absoluteRoot)) {
        continue;
      }
      for (const file of walkFiles(absoluteRoot)) {
        if (isIgnoredPath(file)) {
          continue;
        }
        const source = fs.readFileSync(file, "utf8");
        const pattern = /logEvent\(\s*\{[\s\S]{0,500}?event:\s*"([^"]+)"/g;
        let match = pattern.exec(source);
        while (match) {
          const eventName = match[1];
          if (eventName) {
            literalEvents.add(eventName);
          }
          match = pattern.exec(source);
        }
      }
    }

    const missing = Array.from(literalEvents)
      .filter((eventName) => !EVENT_CATALOG_BY_NAME[eventName])
      .sort();
    expect(missing).toEqual([]);
  });
});

function walkFiles(root: string): string[] {
  const discovered: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (entry.isFile()) {
        discovered.push(absolutePath);
      }
    }
  }
  return discovered;
}

function isIgnoredPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.includes("/tests/")) {
    return true;
  }
  if (normalized.includes("/__snapshots__/")) {
    return true;
  }
  if (
    !(
      normalized.endsWith(".ts") ||
      normalized.endsWith(".tsx") ||
      normalized.endsWith(".js") ||
      normalized.endsWith(".mjs")
    )
  ) {
    return true;
  }
  return false;
}
