import { describe, expect, it, vi } from "vitest";

import {
  executeWithBlockAndReportIntercept,
  parseBlockReportIntent,
  parseReportReason,
  runBlockAndReportIntercept,
  type BlockReportInterceptRepository,
  type ModerationConversationContext,
  type PendingReportPrompt,
  type ReportReasonCategory,
} from "../../packages/core/src/safety/block-report.ts";

type SafetyEvent = {
  user_id: string;
  inbound_message_id: string | null;
  inbound_message_sid: string;
  action_taken: string;
  metadata: Record<string, unknown>;
  now_iso: string;
};

type Incident = {
  incident_id: string;
  reporter_user_id: string;
  reported_user_id: string;
  linkup_id: string | null;
  reason_category: ReportReasonCategory;
  free_text: string | null;
  prompt_token: string;
  idempotency_key: string;
  created_at: string;
};

class InMemoryBlockReportRepository implements BlockReportInterceptRepository {
  readonly contexts = new Map<string, ModerationConversationContext>();
  readonly events: SafetyEvent[] = [];
  readonly incidents: Incident[] = [];
  private readonly blockPairs = new Set<string>();
  private incidentSequence = 1;

  async resolveConversationContext(userId: string): Promise<ModerationConversationContext> {
    return this.contexts.get(userId) ?? {
      linkup_id: null,
      counterparts: [],
    };
  }

  async hasBlockingRelationship(params: {
    user_id: string;
    counterpart_user_ids: string[];
  }): Promise<boolean> {
    return params.counterpart_user_ids.some((counterpartUserId) => {
      const outbound = this.buildBlockKey(params.user_id, counterpartUserId);
      const inbound = this.buildBlockKey(counterpartUserId, params.user_id);
      return this.blockPairs.has(outbound) || this.blockPairs.has(inbound);
    });
  }

  async upsertUserBlock(params: {
    blocker_user_id: string;
    blocked_user_id: string;
  }): Promise<{ created: boolean }> {
    const key = this.buildBlockKey(params.blocker_user_id, params.blocked_user_id);
    const existed = this.blockPairs.has(key);
    this.blockPairs.add(key);
    return {
      created: !existed,
    };
  }

  async getPendingReportPrompt(userId: string): Promise<PendingReportPrompt | null> {
    const prompts = this.events
      .filter((event) => event.user_id === userId && event.action_taken === "report_reason_prompted")
      .reverse();

    for (const promptEvent of prompts) {
      const promptToken = String(promptEvent.metadata.prompt_token ?? "");
      const reportedUserId = String(promptEvent.metadata.reported_user_id ?? "");
      const linkupIdRaw = promptEvent.metadata.linkup_id;
      const linkupId = typeof linkupIdRaw === "string" ? linkupIdRaw : null;

      if (!promptToken || !reportedUserId) {
        continue;
      }

      const incidentExists = this.incidents.some((incident) => incident.prompt_token === promptToken);
      const completedByEvent = this.events.some(
        (event) =>
          event.user_id === userId &&
          event.action_taken === "safety.report_created" &&
          event.metadata.prompt_token === promptToken,
      );
      if (incidentExists || completedByEvent) {
        continue;
      }

      const clarifierSent = this.events.some(
        (event) =>
          event.user_id === userId &&
          event.action_taken === "report_reason_clarifier_prompted" &&
          event.metadata.prompt_token === promptToken,
      );

      return {
        prompt_token: promptToken,
        reported_user_id: reportedUserId,
        linkup_id: linkupId,
        clarifier_sent: clarifierSent,
      };
    }

    return null;
  }

  async createModerationIncident(params: {
    reporter_user_id: string;
    reported_user_id: string;
    linkup_id: string | null;
    reason_category: ReportReasonCategory;
    free_text: string | null;
    prompt_token: string;
    idempotency_key: string;
    now_iso: string;
  }): Promise<{ incident_id: string; created: boolean }> {
    const existing = this.incidents.find(
      (incident) => incident.idempotency_key === params.idempotency_key,
    );

    if (existing) {
      return {
        incident_id: existing.incident_id,
        created: false,
      };
    }

    const incidentId = `inc_${this.incidentSequence}`;
    this.incidentSequence += 1;

    this.incidents.push({
      incident_id: incidentId,
      reporter_user_id: params.reporter_user_id,
      reported_user_id: params.reported_user_id,
      linkup_id: params.linkup_id,
      reason_category: params.reason_category,
      free_text: params.free_text,
      prompt_token: params.prompt_token,
      idempotency_key: params.idempotency_key,
      created_at: params.now_iso,
    });

    return {
      incident_id: incidentId,
      created: true,
    };
  }

  async appendSafetyEvent(event: SafetyEvent): Promise<void> {
    this.events.push(event);
  }

  getBlockPairCount(): number {
    return this.blockPairs.size;
  }

  private buildBlockKey(blockerUserId: string, blockedUserId: string): string {
    return `${blockerUserId}:${blockedUserId}`;
  }
}

describe("block/report intent parser", () => {
  it("detects block and report commands with optional target", () => {
    expect(parseBlockReportIntent("BLOCK")).toEqual({
      kind: "block",
      target_hint: null,
    });

    expect(parseBlockReportIntent("I want to report Sarah")).toEqual({
      kind: "report",
      target_hint: "sarah",
    });

    expect(parseBlockReportIntent("what's up?")).toEqual({
      kind: "none",
      target_hint: null,
    });
  });

  it("parses report reason categories deterministically", () => {
    expect(parseReportReason("A").category).toBe("inappropriate_behavior");
    expect(parseReportReason("B").category).toBe("made_me_uncomfortable");
    expect(parseReportReason("C").category).toBe("no_show_or_canceled_last_minute");
    expect(parseReportReason("D this was scary")).toEqual({
      category: "other",
      free_text: "this was scary",
    });
  });
});

describe("block/report intercept", () => {
  it("creates a block and enforces it before router dispatch", async () => {
    const repository = new InMemoryBlockReportRepository();
    repository.contexts.set("usr_a", {
      linkup_id: "lnk_1",
      counterparts: [{
        user_id: "usr_b",
        first_name: "Sam",
        last_name: "Parker",
      }],
    });

    const blocked = await runBlockAndReportIntercept({
      repository,
      user_id: "usr_a",
      inbound_message_id: "msg_1",
      inbound_message_sid: "SM_BLOCK_1",
      body_raw: "BLOCK",
      now_iso: "2026-02-26T21:00:00.000Z",
    });

    expect(blocked.intercepted).toBe(true);
    expect(blocked.action).toBe("block_created");
    expect(blocked.target_user_id).toBe("usr_b");
    expect(repository.getBlockPairCount()).toBe(1);

    const router = vi.fn(async () => "router-called");
    const executed = await executeWithBlockAndReportIntercept({
      intercept_input: {
        repository,
        user_id: "usr_a",
        inbound_message_id: "msg_2",
        inbound_message_sid: "SM_BLOCK_ENFORCED_1",
        body_raw: "hello",
        now_iso: "2026-02-26T21:01:00.000Z",
      },
      run_router: router,
    });

    expect(executed.decision.intercepted).toBe(true);
    expect(executed.decision.action).toBe("blocked_message_attempt");
    expect(router).not.toHaveBeenCalled();
  });

  it("runs guided report flow and creates moderation incident", async () => {
    const repository = new InMemoryBlockReportRepository();
    repository.contexts.set("usr_reporter", {
      linkup_id: "lnk_2",
      counterparts: [{
        user_id: "usr_reported",
        first_name: "Taylor",
        last_name: "Lee",
      }],
    });

    const prompt = await runBlockAndReportIntercept({
      repository,
      user_id: "usr_reporter",
      inbound_message_id: "msg_10",
      inbound_message_sid: "SM_REPORT_1",
      body_raw: "REPORT",
      now_iso: "2026-02-26T22:00:00.000Z",
    });

    expect(prompt.intercepted).toBe(true);
    expect(prompt.action).toBe("report_prompted");

    const submitted = await runBlockAndReportIntercept({
      repository,
      user_id: "usr_reporter",
      inbound_message_id: "msg_11",
      inbound_message_sid: "SM_REPORT_REASON_1",
      body_raw: "A",
      now_iso: "2026-02-26T22:01:00.000Z",
    });

    expect(submitted.intercepted).toBe(true);
    expect(submitted.action).toBe("report_created");
    expect(submitted.reason_category).toBe("inappropriate_behavior");
    expect(repository.incidents).toHaveLength(1);
    expect(repository.incidents[0]).toMatchObject({
      reporter_user_id: "usr_reporter",
      reported_user_id: "usr_reported",
      linkup_id: "lnk_2",
      reason_category: "inappropriate_behavior",
    });
  });

  it("uses one clarifier then captures other reason text", async () => {
    const repository = new InMemoryBlockReportRepository();
    repository.contexts.set("usr_reporter", {
      linkup_id: "lnk_3",
      counterparts: [{
        user_id: "usr_reported",
        first_name: "Jordan",
        last_name: "Kim",
      }],
    });

    await runBlockAndReportIntercept({
      repository,
      user_id: "usr_reporter",
      inbound_message_id: "msg_20",
      inbound_message_sid: "SM_REPORT_20",
      body_raw: "REPORT",
      now_iso: "2026-02-26T23:00:00.000Z",
    });

    const clarifier = await runBlockAndReportIntercept({
      repository,
      user_id: "usr_reporter",
      inbound_message_id: "msg_21",
      inbound_message_sid: "SM_REPORT_21",
      body_raw: "this was bad",
      now_iso: "2026-02-26T23:01:00.000Z",
    });

    expect(clarifier.action).toBe("report_reason_clarifier");

    const captured = await runBlockAndReportIntercept({
      repository,
      user_id: "usr_reporter",
      inbound_message_id: "msg_22",
      inbound_message_sid: "SM_REPORT_22",
      body_raw: "they kept messaging me after i said no",
      now_iso: "2026-02-26T23:02:00.000Z",
    });

    expect(captured.action).toBe("report_created");
    expect(captured.reason_category).toBe("other");
    expect(repository.incidents[0]?.free_text).toContain("they kept messaging me");
  });

  it("prevents duplicate report incidents via idempotent keying", async () => {
    const repository = new InMemoryBlockReportRepository();
    repository.contexts.set("usr_reporter", {
      linkup_id: "lnk_4",
      counterparts: [{
        user_id: "usr_reported",
        first_name: "Casey",
        last_name: "Ng",
      }],
    });

    await runBlockAndReportIntercept({
      repository,
      user_id: "usr_reporter",
      inbound_message_id: "msg_30",
      inbound_message_sid: "SM_REPORT_30",
      body_raw: "REPORT",
      now_iso: "2026-02-26T10:00:00.000Z",
    });

    await runBlockAndReportIntercept({
      repository,
      user_id: "usr_reporter",
      inbound_message_id: "msg_31",
      inbound_message_sid: "SM_REPORT_31",
      body_raw: "B",
      now_iso: "2026-02-26T10:01:00.000Z",
    });

    await runBlockAndReportIntercept({
      repository,
      user_id: "usr_reporter",
      inbound_message_id: "msg_32",
      inbound_message_sid: "SM_REPORT_32",
      body_raw: "REPORT",
      now_iso: "2026-02-26T10:02:00.000Z",
    });

    const duplicate = await runBlockAndReportIntercept({
      repository,
      user_id: "usr_reporter",
      inbound_message_id: "msg_33",
      inbound_message_sid: "SM_REPORT_33",
      body_raw: "B",
      now_iso: "2026-02-26T10:03:00.000Z",
    });

    expect(duplicate.action).toBe("report_created");
    expect(repository.incidents).toHaveLength(1);
  });

  it("prevents blocked users from continuing contact-exchange messaging", async () => {
    const repository = new InMemoryBlockReportRepository();
    repository.contexts.set("usr_a", {
      linkup_id: "lnk_contact_1",
      counterparts: [{ user_id: "usr_b", first_name: "Riley", last_name: "Cole" }],
    });

    await repository.upsertUserBlock({
      blocker_user_id: "usr_a",
      blocked_user_id: "usr_b",
    });

    const decision = await runBlockAndReportIntercept({
      repository,
      user_id: "usr_a",
      inbound_message_id: "msg_contact_1",
      inbound_message_sid: "SM_CONTACT_1",
      body_raw: "yes",
      now_iso: "2026-02-26T12:00:00.000Z",
    });

    expect(decision.intercepted).toBe(true);
    expect(decision.action).toBe("blocked_message_attempt");
  });
});
