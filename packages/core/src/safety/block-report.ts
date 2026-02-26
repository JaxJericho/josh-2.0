export type ModerationCounterpart = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
};

export type ModerationConversationContext = {
  linkup_id: string | null;
  counterparts: ModerationCounterpart[];
};

export type PendingReportPrompt = {
  prompt_token: string;
  reported_user_id: string;
  linkup_id: string | null;
  clarifier_sent: boolean;
};

export type ReportReasonCategory =
  | "inappropriate_behavior"
  | "made_me_uncomfortable"
  | "no_show_or_canceled_last_minute"
  | "other";

export type BlockReportInterceptAction =
  | "none"
  | "block_created"
  | "report_prompted"
  | "report_reason_clarifier"
  | "report_created"
  | "blocked_message_attempt"
  | "unsupported_target";

export type BlockReportInterceptDecision = {
  intercepted: boolean;
  action: BlockReportInterceptAction;
  response_message: string | null;
  target_user_id: string | null;
  linkup_id: string | null;
  reason_category: ReportReasonCategory | null;
  incident_id: string | null;
};

export type BlockReportInterceptRepository = {
  resolveConversationContext: (userId: string) => Promise<ModerationConversationContext>;
  hasBlockingRelationship: (params: {
    user_id: string;
    counterpart_user_ids: string[];
  }) => Promise<boolean>;
  upsertUserBlock: (params: {
    blocker_user_id: string;
    blocked_user_id: string;
    now_iso: string;
  }) => Promise<{ created: boolean }>;
  getPendingReportPrompt: (userId: string) => Promise<PendingReportPrompt | null>;
  createModerationIncident: (params: {
    reporter_user_id: string;
    reported_user_id: string;
    linkup_id: string | null;
    reason_category: ReportReasonCategory;
    free_text: string | null;
    prompt_token: string;
    idempotency_key: string;
    now_iso: string;
  }) => Promise<{ incident_id: string; created: boolean }>;
  appendSafetyEvent: (event: {
    user_id: string;
    inbound_message_id: string | null;
    inbound_message_sid: string;
    action_taken: string;
    metadata: Record<string, unknown>;
    now_iso: string;
  }) => Promise<void>;
};

const BLOCK_REPORT_UNAVAILABLE_MESSAGE =
  "I can only help you block or report someone from a past LinkUp. If you need other help, text HELP.";
const BLOCK_CONFIRMATION_TEMPLATE =
  "Done. {name} won't be included in any future plans with you.";
const BLOCKED_MESSAGE_RESPONSE =
  "I can't continue this conversation because one of you has blocked contact. If you need help, reply HELP.";
const REPORT_REASON_PROMPT =
  "What's this about? Reply A) Inappropriate behavior, B) Made me uncomfortable, C) No-show or canceled last minute, D) Other.";
const REPORT_REASON_CLARIFIER =
  "Please reply with A, B, C, or D so I can file your report.";
const REPORT_CONFIRMATION =
  "Got it. We'll look into it. Thanks for letting us know.";

export async function runBlockAndReportIntercept(params: {
  repository: BlockReportInterceptRepository;
  user_id: string | null;
  inbound_message_id: string | null;
  inbound_message_sid: string;
  body_raw: string;
  now_iso?: string;
}): Promise<BlockReportInterceptDecision> {
  if (!params.user_id) {
    return notIntercepted();
  }

  const nowIso = params.now_iso ?? new Date().toISOString();
  const intent = parseBlockReportIntent(params.body_raw);
  const context = await params.repository.resolveConversationContext(params.user_id);

  if (intent.kind === "block") {
    const target = resolveTargetCounterpart(context.counterparts, intent.target_hint);
    if (!target) {
      return {
        intercepted: true,
        action: "unsupported_target",
        response_message: BLOCK_REPORT_UNAVAILABLE_MESSAGE,
        target_user_id: null,
        linkup_id: context.linkup_id,
        reason_category: null,
        incident_id: null,
      };
    }

    await params.repository.upsertUserBlock({
      blocker_user_id: params.user_id,
      blocked_user_id: target.user_id,
      now_iso: nowIso,
    });

    await params.repository.appendSafetyEvent({
      user_id: params.user_id,
      inbound_message_id: params.inbound_message_id,
      inbound_message_sid: params.inbound_message_sid,
      action_taken: "safety.block_created",
      metadata: {
        blocker_user_id: params.user_id,
        blocked_user_id: target.user_id,
        linkup_id: context.linkup_id,
      },
      now_iso: nowIso,
    });

    return {
      intercepted: true,
      action: "block_created",
      response_message: BLOCK_CONFIRMATION_TEMPLATE.replace(
        "{name}",
        displayNameForCounterpart(target),
      ),
      target_user_id: target.user_id,
      linkup_id: context.linkup_id,
      reason_category: null,
      incident_id: null,
    };
  }

  if (intent.kind === "report") {
    const target = resolveTargetCounterpart(context.counterparts, intent.target_hint);
    if (!target) {
      return {
        intercepted: true,
        action: "unsupported_target",
        response_message: BLOCK_REPORT_UNAVAILABLE_MESSAGE,
        target_user_id: null,
        linkup_id: context.linkup_id,
        reason_category: null,
        incident_id: null,
      };
    }

    const promptToken = `report_prompt:${params.inbound_message_sid}`;
    await params.repository.appendSafetyEvent({
      user_id: params.user_id,
      inbound_message_id: params.inbound_message_id,
      inbound_message_sid: params.inbound_message_sid,
      action_taken: "report_reason_prompted",
      metadata: {
        prompt_token: promptToken,
        reported_user_id: target.user_id,
        linkup_id: context.linkup_id,
      },
      now_iso: nowIso,
    });

    return {
      intercepted: true,
      action: "report_prompted",
      response_message: REPORT_REASON_PROMPT,
      target_user_id: target.user_id,
      linkup_id: context.linkup_id,
      reason_category: null,
      incident_id: null,
    };
  }

  const pendingPrompt = await params.repository.getPendingReportPrompt(params.user_id);
  if (pendingPrompt) {
    const parsedReason = parseReportReason(params.body_raw);

    if (!parsedReason.category && !pendingPrompt.clarifier_sent) {
      await params.repository.appendSafetyEvent({
        user_id: params.user_id,
        inbound_message_id: params.inbound_message_id,
        inbound_message_sid: params.inbound_message_sid,
        action_taken: "report_reason_clarifier_prompted",
        metadata: {
          prompt_token: pendingPrompt.prompt_token,
          reported_user_id: pendingPrompt.reported_user_id,
          linkup_id: pendingPrompt.linkup_id,
        },
        now_iso: nowIso,
      });

      return {
        intercepted: true,
        action: "report_reason_clarifier",
        response_message: REPORT_REASON_CLARIFIER,
        target_user_id: pendingPrompt.reported_user_id,
        linkup_id: pendingPrompt.linkup_id,
        reason_category: null,
        incident_id: null,
      };
    }

    const reasonCategory = parsedReason.category ?? "other";
    const freeText = reasonCategory === "other"
      ? (parsedReason.free_text ?? normalizeText(params.body_raw))
      : parsedReason.free_text;
    const idempotencyKey = buildIncidentIdempotencyKey({
      reporter_user_id: params.user_id,
      reported_user_id: pendingPrompt.reported_user_id,
      linkup_id: pendingPrompt.linkup_id,
      reason_category: reasonCategory,
      now_iso: nowIso,
    });

    const incident = await params.repository.createModerationIncident({
      reporter_user_id: params.user_id,
      reported_user_id: pendingPrompt.reported_user_id,
      linkup_id: pendingPrompt.linkup_id,
      reason_category: reasonCategory,
      free_text: freeText,
      prompt_token: pendingPrompt.prompt_token,
      idempotency_key: idempotencyKey,
      now_iso: nowIso,
    });

    await params.repository.appendSafetyEvent({
      user_id: params.user_id,
      inbound_message_id: params.inbound_message_id,
      inbound_message_sid: params.inbound_message_sid,
      action_taken: "safety.report_created",
      metadata: {
        prompt_token: pendingPrompt.prompt_token,
        reporter_user_id: params.user_id,
        reported_user_id: pendingPrompt.reported_user_id,
        linkup_id: pendingPrompt.linkup_id,
        reason_category: reasonCategory,
        incident_id: incident.incident_id,
        created: incident.created,
      },
      now_iso: nowIso,
    });

    return {
      intercepted: true,
      action: "report_created",
      response_message: REPORT_CONFIRMATION,
      target_user_id: pendingPrompt.reported_user_id,
      linkup_id: pendingPrompt.linkup_id,
      reason_category: reasonCategory,
      incident_id: incident.incident_id,
    };
  }

  if (context.counterparts.length > 0) {
    const isBlocked = await params.repository.hasBlockingRelationship({
      user_id: params.user_id,
      counterpart_user_ids: context.counterparts.map((counterpart) => counterpart.user_id),
    });

    if (isBlocked) {
      await params.repository.appendSafetyEvent({
        user_id: params.user_id,
        inbound_message_id: params.inbound_message_id,
        inbound_message_sid: params.inbound_message_sid,
        action_taken: "safety.blocked_message_attempt",
        metadata: {
          user_id: params.user_id,
          linkup_id: context.linkup_id,
          counterpart_count: context.counterparts.length,
        },
        now_iso: nowIso,
      });

      return {
        intercepted: true,
        action: "blocked_message_attempt",
        response_message: BLOCKED_MESSAGE_RESPONSE,
        target_user_id: null,
        linkup_id: context.linkup_id,
        reason_category: null,
        incident_id: null,
      };
    }
  }

  return notIntercepted();
}

export async function executeWithBlockAndReportIntercept<T>(params: {
  intercept_input: Parameters<typeof runBlockAndReportIntercept>[0];
  run_router: () => Promise<T>;
}): Promise<{
  decision: BlockReportInterceptDecision;
  router_result: T | null;
}> {
  const decision = await runBlockAndReportIntercept(params.intercept_input);
  if (decision.intercepted) {
    return {
      decision,
      router_result: null,
    };
  }

  return {
    decision,
    router_result: await params.run_router(),
  };
}

export function parseBlockReportIntent(message: string): {
  kind: "none" | "block" | "report";
  target_hint: string | null;
} {
  const normalized = normalizeText(message);
  if (!normalized) {
    return {
      kind: "none",
      target_hint: null,
    };
  }

  const blockMatch = /^(?:block|i want to block)(?:\s+(.+))?$/.exec(normalized);
  if (blockMatch) {
    return {
      kind: "block",
      target_hint: blockMatch[1] ?? null,
    };
  }

  const reportMatch = /^(?:report|i want to report)(?:\s+(.+))?$/.exec(normalized);
  if (reportMatch) {
    return {
      kind: "report",
      target_hint: reportMatch[1] ?? null,
    };
  }

  return {
    kind: "none",
    target_hint: null,
  };
}

export function parseReportReason(message: string): {
  category: ReportReasonCategory | null;
  free_text: string | null;
} {
  const normalized = normalizeText(message);
  if (!normalized) {
    return {
      category: null,
      free_text: null,
    };
  }

  if (isChoice(normalized, "a") || normalized.includes("inappropriate")) {
    return {
      category: "inappropriate_behavior",
      free_text: null,
    };
  }

  if (isChoice(normalized, "b") || normalized.includes("uncomfortable")) {
    return {
      category: "made_me_uncomfortable",
      free_text: null,
    };
  }

  if (isChoice(normalized, "c") || normalized.includes("no show") ||
    normalized.includes("cancel") || normalized.includes("canceled")) {
    return {
      category: "no_show_or_canceled_last_minute",
      free_text: null,
    };
  }

  if (isChoice(normalized, "d") || normalized === "other" || normalized.startsWith("other ")) {
    const freeTextFromChoice = extractOtherFreeText(normalized);
    const freeText = normalized.startsWith("other ")
      ? normalized.slice("other ".length).trim()
      : freeTextFromChoice;

    return {
      category: "other",
      free_text: freeText || null,
    };
  }

  return {
    category: null,
    free_text: null,
  };
}

function isChoice(input: string, letter: "a" | "b" | "c" | "d"): boolean {
  return input === letter || input === `${letter})` || input.startsWith(`${letter} `) ||
    input.startsWith(`${letter}) `) || input.startsWith(`${letter}.`);
}

function extractOtherFreeText(input: string): string | null {
  const match = /^(?:d[\)\.]?\s+)(.+)$/.exec(input);
  if (!match) {
    return null;
  }

  const freeText = match[1]?.trim() ?? "";
  return freeText || null;
}

function resolveTargetCounterpart(
  counterparts: ModerationCounterpart[],
  targetHint: string | null,
): ModerationCounterpart | null {
  if (counterparts.length === 0) {
    return null;
  }

  if (!targetHint) {
    return counterparts.length === 1 ? counterparts[0] : null;
  }

  const normalizedHint = normalizeText(targetHint);
  if (!normalizedHint) {
    return counterparts.length === 1 ? counterparts[0] : null;
  }

  const matches = counterparts.filter((counterpart) => {
    const firstName = normalizeText(counterpart.first_name ?? "");
    const lastName = normalizeText(counterpart.last_name ?? "");
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

    return firstName === normalizedHint ||
      lastName === normalizedHint ||
      fullName === normalizedHint ||
      firstName.includes(normalizedHint) ||
      fullName.includes(normalizedHint);
  });

  if (matches.length !== 1) {
    return null;
  }

  return matches[0];
}

function buildIncidentIdempotencyKey(params: {
  reporter_user_id: string;
  reported_user_id: string;
  linkup_id: string | null;
  reason_category: ReportReasonCategory;
  now_iso: string;
}): string {
  const dateBucket = params.now_iso.slice(0, 10);
  return [
    "report",
    params.reporter_user_id,
    params.reported_user_id,
    params.linkup_id ?? "no_linkup",
    params.reason_category,
    dateBucket,
  ].join(":");
}

function displayNameForCounterpart(counterpart: ModerationCounterpart): string {
  const firstName = counterpart.first_name?.trim() ?? "";
  if (firstName) {
    return firstName;
  }

  return "This person";
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function notIntercepted(): BlockReportInterceptDecision {
  return {
    intercepted: false,
    action: "none",
    response_message: null,
    target_user_id: null,
    linkup_id: null,
    reason_category: null,
    incident_id: null,
  };
}
