import type { ActivityCatalogEntry } from "../../../db/src/types/activity-catalog.ts";
import type { ConversationSession } from "../intents/intent-types.ts";
import { renderSoloSuggestion } from "./handle-open-intent.ts";
import {
  buildSocialChoiceStateToken,
  MAX_SOCIAL_CHOICE_ALTERNATIVE_REQUESTS,
  parseSocialChoiceStateToken,
  PENDING_PLAN_CONFIRMATION_STATE_TOKEN,
} from "./social-choice-state.ts";

const ACCEPT_REPLY =
  "Great choice. I confirmed that plan and will follow up with next steps shortly.";
const DECLINE_REPLY =
  "No worries - reach out whenever you feel like doing something.";
const ALTERNATIVE_LIMIT_REPLY = "We can revisit this whenever you're in the mood.";

const ACCEPT_EXACT_MATCHES = new Set([
  "yes",
  "y",
  "yeah",
  "yep",
  "sure",
  "ok",
  "okay",
  "do it",
  "lets do it",
  "let s do it",
  "sounds good",
  "works",
  "works for me",
  "i m in",
  "im in",
  "i am in",
]);

const DECLINE_EXACT_MATCHES = new Set([
  "no",
  "n",
  "nope",
  "nah",
  "pass",
  "skip",
  "not now",
  "maybe later",
  "no thanks",
  "not interested",
  "i ll pass",
  "ill pass",
  "not today",
]);

const ALTERNATIVE_PHRASES = [
  "something else",
  "anything else",
  "another one",
  "another idea",
  "another option",
  "different one",
  "different option",
  "other option",
  "give me another",
  "new suggestion",
];

const MODIFY_PHRASES = [
  "actually",
  "instead",
  "what about",
  "how about",
  "rather",
  "change it",
  "change to",
  "make it",
];

export type PlanSocialChoiceKind =
  | "accept"
  | "decline"
  | "modify"
  | "request_alternative";

export type PlanSocialChoiceAuditAction =
  | "social_choice_accepted_plan_confirmed"
  | "social_choice_declined_session_idle"
  | "social_choice_modified_suggestion_updated"
  | "social_choice_alternative_requested"
  | "social_choice_alternative_limit_reached";

export type HandlePlanSocialChoiceDependencies = {
  createPlanBrief: (input: {
    userId: string;
    activityKey: string | null;
    notes: string | null;
    status: "confirmed";
  }) => Promise<{ id: string }>;
  suggestSoloActivity: (input: {
    userId: string;
    excludeActivityKeys?: string[];
  }) => Promise<ActivityCatalogEntry>;
  sendMessage: (input: { userId: string; body: string }) => Promise<void>;
  updateSessionState: (input: {
    userId: string;
    mode: "idle" | "awaiting_social_choice" | "pending_plan_confirmation";
    stateToken: string;
  }) => Promise<void>;
  writeAuditEvent: (input: {
    userId: string;
    action: PlanSocialChoiceAuditAction;
    targetType: "plan_brief" | "conversation_session";
    targetId?: string | null;
    reason: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
};

type HandlePlanSocialChoiceDependencyOverrides = Partial<HandlePlanSocialChoiceDependencies>;

export async function handlePlanSocialChoice(
  userId: string,
  message: string,
  session: ConversationSession,
  overrides?: HandlePlanSocialChoiceDependencyOverrides,
): Promise<void> {
  const dependencies = resolveDependencies(overrides);
  const messageTrimmed = message.trim();
  const socialChoice = detectPlanSocialChoiceKind(messageTrimmed);
  const socialChoiceState = parseSocialChoiceStateToken(session.state_token);

  if (socialChoice === "accept") {
    const planBrief = await dependencies.createPlanBrief({
      userId,
      activityKey: socialChoiceState.activityKey,
      notes: messageTrimmed.length > 0 ? messageTrimmed : null,
      status: "confirmed",
    });

    await dependencies.updateSessionState({
      userId,
      mode: "pending_plan_confirmation",
      stateToken: PENDING_PLAN_CONFIRMATION_STATE_TOKEN,
    });
    await dependencies.sendMessage({
      userId,
      body: ACCEPT_REPLY,
    });
    await dependencies.writeAuditEvent({
      userId,
      action: "social_choice_accepted_plan_confirmed",
      targetType: "plan_brief",
      targetId: planBrief.id,
      reason: "social_choice_accept",
      payload: {
        selected_activity_key: socialChoiceState.activityKey,
        plan_brief_id: planBrief.id,
      },
    });
    return;
  }

  if (socialChoice === "decline") {
    await dependencies.updateSessionState({
      userId,
      mode: "idle",
      stateToken: "idle",
    });
    await dependencies.sendMessage({
      userId,
      body: DECLINE_REPLY,
    });
    await dependencies.writeAuditEvent({
      userId,
      action: "social_choice_declined_session_idle",
      targetType: "conversation_session",
      reason: "social_choice_decline",
      payload: {
        prior_activity_key: socialChoiceState.activityKey,
      },
    });
    return;
  }

  if (socialChoice === "request_alternative") {
    const alternativeCount = socialChoiceState.alternativeRequestCount + 1;
    await dependencies.writeAuditEvent({
      userId,
      action: "social_choice_alternative_requested",
      targetType: "conversation_session",
      reason: "social_choice_alternative_requested",
      payload: {
        prior_activity_key: socialChoiceState.activityKey,
        alternative_request_count: alternativeCount,
      },
    });

    if (alternativeCount >= MAX_SOCIAL_CHOICE_ALTERNATIVE_REQUESTS) {
      await dependencies.updateSessionState({
        userId,
        mode: "idle",
        stateToken: "idle",
      });
      await dependencies.sendMessage({
        userId,
        body: ALTERNATIVE_LIMIT_REPLY,
      });
      await dependencies.writeAuditEvent({
        userId,
        action: "social_choice_alternative_limit_reached",
        targetType: "conversation_session",
        reason: "social_choice_alternative_limit",
        payload: {
          alternative_request_count: alternativeCount,
        },
      });
      return;
    }

    const suggestion = await dependencies.suggestSoloActivity({
      userId,
      excludeActivityKeys: socialChoiceState.activityKey ? [socialChoiceState.activityKey] : [],
    });
    const suggestionBody = renderSoloSuggestion(suggestion);
    await dependencies.sendMessage({
      userId,
      body: suggestionBody,
    });
    await dependencies.updateSessionState({
      userId,
      mode: "awaiting_social_choice",
      stateToken: buildSocialChoiceStateToken(
        suggestion.activity_key,
        alternativeCount,
      ),
    });
    return;
  }

  const modifiedSuggestion = await dependencies.suggestSoloActivity({
    userId,
    excludeActivityKeys: socialChoiceState.activityKey ? [socialChoiceState.activityKey] : [],
  });
  await dependencies.sendMessage({
    userId,
    body: renderSoloSuggestion(modifiedSuggestion),
  });
  await dependencies.updateSessionState({
    userId,
    mode: "awaiting_social_choice",
    stateToken: buildSocialChoiceStateToken(
      modifiedSuggestion.activity_key,
      socialChoiceState.alternativeRequestCount,
    ),
  });
  await dependencies.writeAuditEvent({
    userId,
    action: "social_choice_modified_suggestion_updated",
    targetType: "conversation_session",
    reason: "social_choice_modify",
    payload: {
      prior_activity_key: socialChoiceState.activityKey,
      next_activity_key: modifiedSuggestion.activity_key,
    },
  });
}

export function detectPlanSocialChoiceKind(message: string): PlanSocialChoiceKind {
  const normalized = normalizeIntentText(message);
  if (!normalized) {
    return "request_alternative";
  }

  if (matchesAnyPhrase(normalized, ALTERNATIVE_PHRASES)) {
    return "request_alternative";
  }

  if (matchesAnyPhrase(normalized, MODIFY_PHRASES)) {
    return "modify";
  }

  if (ACCEPT_EXACT_MATCHES.has(normalized)) {
    return "accept";
  }

  if (DECLINE_EXACT_MATCHES.has(normalized)) {
    return "decline";
  }

  const decision = detectTokenConsensus(normalized);
  if (decision) {
    return decision;
  }

  return "modify";
}

function detectTokenConsensus(
  normalized: string,
): "accept" | "decline" | null {
  const tokens = normalized.split(" ").filter(Boolean);
  let sawAccept = false;
  let sawDecline = false;

  for (const token of tokens) {
    if (ACCEPT_EXACT_MATCHES.has(token)) {
      sawAccept = true;
      continue;
    }
    if (DECLINE_EXACT_MATCHES.has(token)) {
      sawDecline = true;
    }
  }

  if (sawAccept && !sawDecline) {
    return "accept";
  }
  if (sawDecline && !sawAccept) {
    return "decline";
  }

  return null;
}

function matchesAnyPhrase(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => hasPhrase(text, phrase));
}

function hasPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function normalizeIntentText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
}

function resolveDependencies(
  overrides?: HandlePlanSocialChoiceDependencyOverrides,
): HandlePlanSocialChoiceDependencies {
  return {
    createPlanBrief: overrides?.createPlanBrief ?? missingDependencyFn("createPlanBrief"),
    suggestSoloActivity: overrides?.suggestSoloActivity ?? missingDependencyFn("suggestSoloActivity"),
    sendMessage: overrides?.sendMessage ?? missingDependencyFn("sendMessage"),
    updateSessionState: overrides?.updateSessionState ?? missingDependencyFn("updateSessionState"),
    writeAuditEvent: overrides?.writeAuditEvent ?? missingDependencyFn("writeAuditEvent"),
  };
}

function missingDependencyFn<T extends (...args: any[]) => unknown>(name: string): T {
  return ((..._args: any[]) => {
    throw new Error(`handlePlanSocialChoice dependency '${name}' was not provided.`);
  }) as unknown as T;
}
