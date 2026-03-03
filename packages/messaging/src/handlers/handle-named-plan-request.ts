import type { ConversationSession } from "../intents/intent-types";
import {
  buildContactNotFoundMessage,
  buildPlanConfirmationPrompt,
  buildSubscriptionPrompt,
  CLARIFY_CONTACT_MESSAGE,
} from "../../../core/src/messages";

export type NamedPlanIntentFields = {
  contactNames: string[];
  activityHint?: string;
  timeWindowHint?: string;
};

export type NamedPlanEligibilityResult = {
  eligible: boolean;
  reason?: string | null;
};

export type ResolvedNamedPlanContact = {
  id: string;
  contact_name: string;
  contact_phone_e164: string | null;
};

export type HandleNamedPlanRequestDependencies = {
  evaluateEligibility: (input: {
    userId: string;
    action_type: "can_initiate_named_plan";
  }) => Promise<NamedPlanEligibilityResult>;
  findContactByName: (input: {
    userId: string;
    contactName: string;
  }) => Promise<ResolvedNamedPlanContact | null>;
  insertPlanBrief: (input: {
    id: string;
    creator_user_id: string;
    activity_key: string | null;
    proposed_time_window: string | null;
    notes: null;
    status: "draft";
    created_at: string;
    updated_at: string;
  }) => Promise<{ error: { message: string } | null }>;
  updateConversationSession: (input: {
    userId: string;
    mode: "pending_plan_confirmation";
    state_token: string;
    updated_at: string;
  }) => Promise<void>;
  sendSms: (input: {
    userId: string;
    body: string;
    correlationId: string;
  }) => Promise<void>;
  log: (input: {
    level: "info" | "warn";
    event: string;
    payload: Record<string, unknown>;
  }) => void;
  generateUuid: () => string;
  nowIso: () => string;
};

type HandleNamedPlanRequestDependencyOverrides = Partial<HandleNamedPlanRequestDependencies>;

export async function handleNamedPlanRequest(
  userId: string,
  message: string,
  session: ConversationSession,
  intentFields: NamedPlanIntentFields,
  correlationId: string,
  overrides?: HandleNamedPlanRequestDependencyOverrides,
): Promise<void> {
  const dependencies = resolveDependencies(overrides);
  const contactName = normalizeContactName(intentFields.contactNames?.[0]);

  dependencies.log({
    level: "info",
    event: "handle_named_plan_request.start",
    payload: {
      userId,
      correlationId,
      contactName,
      messageLength: message.trim().length,
      sessionMode: session.mode,
    },
  });

  const eligibility = await dependencies.evaluateEligibility({
    userId,
    action_type: "can_initiate_named_plan",
  });

  dependencies.log({
    level: "info",
    event: "handle_named_plan_request.eligibility",
    payload: {
      userId,
      correlationId,
      eligible: eligibility.eligible,
    },
  });

  if (!eligibility.eligible) {
    await dependencies.sendSms({
      userId,
      body: buildSubscriptionPrompt(eligibility.reason ?? null),
      correlationId,
    });
    return;
  }

  if (!contactName) {
    await dependencies.sendSms({
      userId,
      body: CLARIFY_CONTACT_MESSAGE,
      correlationId,
    });
    return;
  }

  const contact = await dependencies.findContactByName({
    userId,
    contactName,
  });

  if (!contact) {
    dependencies.log({
      level: "warn",
      event: "handle_named_plan_request.contact_not_found",
      payload: {
        userId,
        correlationId,
        contactName,
      },
    });
    await dependencies.sendSms({
      userId,
      body: buildContactNotFoundMessage(contactName),
      correlationId,
    });
    return;
  }

  dependencies.log({
    level: "info",
    event: "handle_named_plan_request.contact_resolved",
    payload: {
      userId,
      correlationId,
      contactId: contact.id,
    },
  });

  const planBriefId = dependencies.generateUuid();
  const briefTimestamp = dependencies.nowIso();
  const { error: briefError } = await dependencies.insertPlanBrief({
    id: planBriefId,
    creator_user_id: userId,
    activity_key: normalizeOptionalText(intentFields.activityHint),
    proposed_time_window: normalizeOptionalText(intentFields.timeWindowHint),
    notes: null,
    status: "draft",
    created_at: briefTimestamp,
    updated_at: briefTimestamp,
  });

  if (briefError) {
    throw new Error(`Failed to create plan_briefs row: ${briefError.message}`);
  }

  dependencies.log({
    level: "info",
    event: "handle_named_plan_request.plan_brief_created",
    payload: {
      userId,
      correlationId,
      planBriefId,
    },
  });

  await dependencies.updateConversationSession({
    userId,
    mode: "pending_plan_confirmation",
    state_token: `plan_brief:${planBriefId}:contact:${contact.id}`,
    updated_at: dependencies.nowIso(),
  });

  await dependencies.sendSms({
    userId,
    body: buildPlanConfirmationPrompt({
      contactName: contact.contact_name,
      activityHint: intentFields.activityHint,
      timeWindowHint: intentFields.timeWindowHint,
    }),
    correlationId,
  });
}

function resolveDependencies(
  overrides?: HandleNamedPlanRequestDependencyOverrides,
): HandleNamedPlanRequestDependencies {
  return {
    evaluateEligibility: overrides?.evaluateEligibility ??
      missingDependencyFn("evaluateEligibility"),
    findContactByName: overrides?.findContactByName ??
      missingDependencyFn("findContactByName"),
    insertPlanBrief: overrides?.insertPlanBrief ??
      missingDependencyFn("insertPlanBrief"),
    updateConversationSession: overrides?.updateConversationSession ??
      missingDependencyFn("updateConversationSession"),
    sendSms: overrides?.sendSms ?? missingDependencyFn("sendSms"),
    log: overrides?.log ?? (() => {}),
    generateUuid: overrides?.generateUuid ?? (() => crypto.randomUUID()),
    nowIso: overrides?.nowIso ?? (() => new Date().toISOString()),
  };
}

function missingDependencyFn<T extends (...args: any[]) => unknown>(name: string): T {
  return ((..._args: any[]) => {
    throw new Error(`handleNamedPlanRequest dependency '${name}' was not provided.`);
  }) as unknown as T;
}

function normalizeContactName(contactName: string | undefined): string | null {
  if (typeof contactName !== "string") {
    return null;
  }
  const trimmed = contactName.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

function normalizeOptionalText(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}
