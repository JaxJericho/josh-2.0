import { describe, expect, it, vi } from "vitest";

import {
  executeWithSafetyIntercept,
  runSafetyIntercept,
  type AppliedRateLimit,
  type AppliedStrikes,
  type SafetyEventInput,
  type SafetyInterceptRepository,
  type SetSafetyHoldResult,
  type UserSafetyState,
} from "../../packages/core/src/safety/intercept.ts";

type RateWindow = {
  start: string | null;
  count: number;
};

class InMemorySafetyRepository implements SafetyInterceptRepository {
  private readonly replayLocks = new Set<string>();
  private readonly userState = new Map<string, UserSafetyState>();
  private readonly rateWindows = new Map<string, RateWindow>();
  readonly events: SafetyEventInput[] = [];

  async acquireMessageLock(params: {
    user_id: string | null;
    inbound_message_id: string | null;
    inbound_message_sid: string;
  }): Promise<boolean> {
    if (this.replayLocks.has(params.inbound_message_sid)) {
      return false;
    }

    this.replayLocks.add(params.inbound_message_sid);
    return true;
  }

  async getUserSafetyState(userId: string): Promise<UserSafetyState | null> {
    return this.userState.get(userId) ?? null;
  }

  async applyRateLimit(params: {
    user_id: string;
    max_messages: number;
    window_seconds: number;
    now_iso: string;
  }): Promise<AppliedRateLimit> {
    const now = new Date(params.now_iso);
    const existing = this.rateWindows.get(params.user_id) ?? {
      start: null,
      count: 0,
    };

    const windowStart = existing.start ? new Date(existing.start) : null;
    const withinWindow = windowStart !== null &&
      (now.getTime() - windowStart.getTime()) < params.window_seconds * 1000;

    const nextCount = withinWindow ? existing.count + 1 : 1;
    const nextStart = withinWindow
      ? windowStart!.toISOString()
      : now.toISOString();

    this.rateWindows.set(params.user_id, {
      start: nextStart,
      count: nextCount,
    });

    return {
      exceeded: nextCount > params.max_messages,
      rate_limit_window_start: nextStart,
      rate_limit_count: nextCount,
    };
  }

  async applyStrikes(params: {
    user_id: string;
    increment: number;
    escalation_threshold: number;
    now_iso: string;
  }): Promise<AppliedStrikes> {
    const existing = this.userState.get(params.user_id) ?? {
      strike_count: 0,
      safety_hold: false,
    };

    const nextStrikeCount = existing.strike_count + params.increment;
    const nextSafetyHold = existing.safety_hold || nextStrikeCount >= params.escalation_threshold;
    const escalated = !existing.safety_hold && nextSafetyHold;

    this.userState.set(params.user_id, {
      strike_count: nextStrikeCount,
      safety_hold: nextSafetyHold,
    });

    return {
      strike_count: nextStrikeCount,
      safety_hold: nextSafetyHold,
      escalated,
    };
  }

  async setSafetyHold(params: {
    user_id: string;
    now_iso: string;
  }): Promise<SetSafetyHoldResult> {
    const existing = this.userState.get(params.user_id) ?? {
      strike_count: 0,
      safety_hold: false,
    };

    const next = {
      strike_count: existing.strike_count,
      safety_hold: true,
    };

    this.userState.set(params.user_id, next);
    return next;
  }

  async appendSafetyEvent(event: SafetyEventInput): Promise<void> {
    this.events.push(event);
  }
}

describe("safety intercept", () => {
  it("enforces rate limiting with configured rolling threshold", async () => {
    const repository = new InMemorySafetyRepository();

    for (let i = 0; i < 10; i += 1) {
      const decision = await runSafetyIntercept({
        repository,
        inbound_message_id: `msg-${i}`,
        inbound_message_sid: `SM_RATE_${i}`,
        user_id: "usr_rate",
        from_e164: "+14155550100",
        body_raw: "hello",
        now_iso: "2026-02-26T16:00:00.000Z",
      });

      expect(decision.intercepted).toBe(false);
    }

    const blocked = await runSafetyIntercept({
      repository,
      inbound_message_id: "msg-11",
      inbound_message_sid: "SM_RATE_11",
      user_id: "usr_rate",
      from_e164: "+14155550100",
      body_raw: "hello again",
      now_iso: "2026-02-26T16:00:10.000Z",
    });

    expect(blocked.intercepted).toBe(true);
    expect(blocked.action).toBe("rate_limit");
    expect(repository.events.some((event) => event.action_taken === "rate_limit_exceeded")).toBe(true);
  });

  it("accumulates strikes and escalates to safety hold at threshold", async () => {
    const repository = new InMemorySafetyRepository();

    const first = await runSafetyIntercept({
      repository,
      inbound_message_id: "msg-strike-1",
      inbound_message_sid: "SM_STRIKE_1",
      user_id: "usr_strike",
      from_e164: "+14155550100",
      body_raw: "I hate you",
      now_iso: "2026-02-26T17:00:00.000Z",
    });

    const second = await runSafetyIntercept({
      repository,
      inbound_message_id: "msg-strike-2",
      inbound_message_sid: "SM_STRIKE_2",
      user_id: "usr_strike",
      from_e164: "+14155550100",
      body_raw: "I will hurt you",
      now_iso: "2026-02-26T17:00:05.000Z",
    });

    expect(first.intercepted).toBe(true);
    expect(first.severity).toBe("medium");
    expect(first.strike_count).toBe(1);

    expect(second.intercepted).toBe(true);
    expect(second.severity).toBe("high");
    expect(second.strike_count).toBe(3);
    expect(second.safety_hold).toBe(true);
    expect(repository.events.some((event) => event.action_taken === "strike_escalation")).toBe(true);
  });

  it("routes crisis content without invoking router", async () => {
    const repository = new InMemorySafetyRepository();
    const router = vi.fn(async () => "router-called");

    const result = await executeWithSafetyIntercept({
      intercept_input: {
        repository,
        inbound_message_id: "msg-crisis",
        inbound_message_sid: "SM_CRISIS_1",
        user_id: "usr_crisis",
        from_e164: "+14155550100",
        body_raw: "I want to die",
        now_iso: "2026-02-26T18:00:00.000Z",
      },
      run_router: router,
    });

    expect(result.decision.intercepted).toBe(true);
    expect(result.decision.action).toBe("crisis");
    expect(result.decision.response_message).toContain("988");
    expect(router).not.toHaveBeenCalled();
  });

  it("guards against duplicate inbound replay by sid", async () => {
    const repository = new InMemorySafetyRepository();

    const first = await runSafetyIntercept({
      repository,
      inbound_message_id: "msg-replay",
      inbound_message_sid: "SM_REPLAY_1",
      user_id: "usr_replay",
      from_e164: "+14155550100",
      body_raw: "normal message",
      now_iso: "2026-02-26T19:00:00.000Z",
    });

    const second = await runSafetyIntercept({
      repository,
      inbound_message_id: "msg-replay",
      inbound_message_sid: "SM_REPLAY_1",
      user_id: "usr_replay",
      from_e164: "+14155550100",
      body_raw: "normal message",
      now_iso: "2026-02-26T19:00:01.000Z",
    });

    expect(first.intercepted).toBe(false);
    expect(second.intercepted).toBe(true);
    expect(second.action).toBe("replay");
    expect(second.replay).toBe(true);
  });
});
