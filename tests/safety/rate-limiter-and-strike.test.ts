import { describe, expect, it } from "vitest";

import { evaluateRollingWindowRateLimit } from "../../packages/core/src/safety/rate-limiter.ts";
import {
  evaluateStrikeEscalation,
  resolveStrikeIncrement,
} from "../../packages/core/src/safety/strike-escalator.ts";

describe("safety rate limiter", () => {
  it("allows messages within the rolling window threshold", () => {
    const result = evaluateRollingWindowRateLimit({
      now_iso: "2026-02-26T12:00:30.000Z",
      state: {
        window_start: "2026-02-26T12:00:00.000Z",
        count: 9,
      },
      config: {
        max_messages: 10,
        window_seconds: 60,
      },
    });

    expect(result.exceeded).toBe(false);
    expect(result.next_count).toBe(10);
    expect(result.next_window_start).toBe("2026-02-26T12:00:00.000Z");
  });

  it("exceeds when count crosses the configured threshold", () => {
    const result = evaluateRollingWindowRateLimit({
      now_iso: "2026-02-26T12:00:31.000Z",
      state: {
        window_start: "2026-02-26T12:00:00.000Z",
        count: 10,
      },
      config: {
        max_messages: 10,
        window_seconds: 60,
      },
    });

    expect(result.exceeded).toBe(true);
    expect(result.next_count).toBe(11);
  });

  it("resets window when outside the rolling interval", () => {
    const result = evaluateRollingWindowRateLimit({
      now_iso: "2026-02-26T12:02:01.000Z",
      state: {
        window_start: "2026-02-26T12:00:00.000Z",
        count: 10,
      },
      config: {
        max_messages: 10,
        window_seconds: 60,
      },
    });

    expect(result.exceeded).toBe(false);
    expect(result.next_count).toBe(1);
    expect(result.next_window_start).toBe("2026-02-26T12:02:01.000Z");
  });
});

describe("safety strike escalation", () => {
  it("maps severity to strike increments", () => {
    expect(resolveStrikeIncrement("low")).toBe(0);
    expect(resolveStrikeIncrement("medium")).toBe(1);
    expect(resolveStrikeIncrement("high")).toBe(2);
    expect(resolveStrikeIncrement("crisis")).toBe(0);
  });

  it("escalates to safety hold at configured threshold", () => {
    const result = evaluateStrikeEscalation({
      state: {
        strike_count: 2,
        safety_hold: false,
      },
      severity: "medium",
      escalation_threshold: 3,
    });

    expect(result.next_strike_count).toBe(3);
    expect(result.next_safety_hold).toBe(true);
    expect(result.escalated).toBe(true);
  });

  it("forces hold immediately for crisis severity", () => {
    const result = evaluateStrikeEscalation({
      state: {
        strike_count: 0,
        safety_hold: false,
      },
      severity: "crisis",
      escalation_threshold: 3,
    });

    expect(result.next_safety_hold).toBe(true);
    expect(result.escalated).toBe(true);
  });
});
