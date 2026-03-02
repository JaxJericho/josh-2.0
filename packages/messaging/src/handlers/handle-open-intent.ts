import type { ActivityCatalogEntry } from "../../../db/src/types/activity-catalog.ts";
import type { ConversationSession } from "../intents/intent-types.ts";

export type OpenIntentActionType =
  | "can_initiate_linkup"
  | "can_initiate_named_plan";

export type OpenIntentEligibilityResult = {
  allowed: boolean;
  reason_code?: string | null;
  user_message?: string | null;
};

export type OpenIntentHandoffResult = {
  took_over: boolean;
};

export type HandleOpenIntentDependencies = {
  evaluateEligibility: (input: {
    userId: string;
    action_type: OpenIntentActionType;
  }) => Promise<OpenIntentEligibilityResult>;
  hasContactCircleEntries: (userId: string) => Promise<boolean>;
  handoffToLinkupFlow: (input: {
    userId: string;
    message: string;
    session: ConversationSession;
  }) => Promise<OpenIntentHandoffResult>;
  handoffToNamedPlanFlow: (input: {
    userId: string;
    message: string;
    session: ConversationSession;
  }) => Promise<OpenIntentHandoffResult>;
  suggestSoloActivity: (userId: string) => Promise<ActivityCatalogEntry>;
  sendMessage: (input: {
    userId: string;
    body: string;
  }) => Promise<void>;
  updateSessionMode: (input: {
    userId: string;
    mode: "awaiting_social_choice";
  }) => Promise<void>;
};

type HandleOpenIntentDependencyOverrides = Partial<HandleOpenIntentDependencies>;

export async function handleOpenIntent(
  userId: string,
  message: string,
  session: ConversationSession,
  overrides?: HandleOpenIntentDependencyOverrides,
): Promise<void> {
  const dependencies = resolveDependencies(overrides);

  const linkupEligibility = await dependencies.evaluateEligibility({
    userId,
    action_type: "can_initiate_linkup",
  });

  if (linkupEligibility.allowed) {
    const handoff = await dependencies.handoffToLinkupFlow({
      userId,
      message,
      session,
    });
    if (handoff.took_over) {
      return;
    }
  }

  const hasContactCircleEntries = await dependencies.hasContactCircleEntries(userId);
  if (hasContactCircleEntries) {
    const namedPlanEligibility = await dependencies.evaluateEligibility({
      userId,
      action_type: "can_initiate_named_plan",
    });

    if (namedPlanEligibility.allowed) {
      const handoff = await dependencies.handoffToNamedPlanFlow({
        userId,
        message,
        session,
      });
      if (handoff.took_over) {
        return;
      }
    }
  }

  const suggestion = await dependencies.suggestSoloActivity(userId);
  await dependencies.sendMessage({
    userId,
    body: renderSoloSuggestion(suggestion),
  });
  await dependencies.updateSessionMode({
    userId,
    mode: "awaiting_social_choice",
  });
}

export function renderSoloSuggestion(activity: ActivityCatalogEntry): string {
  const canonicalCopy = activity.short_description.trim();
  if (!canonicalCopy) {
    throw new Error("Solo activity suggestion requires activity_catalog.short_description.");
  }
  return canonicalCopy;
}

function resolveDependencies(
  overrides?: HandleOpenIntentDependencyOverrides,
): HandleOpenIntentDependencies {
  return {
    evaluateEligibility: overrides?.evaluateEligibility ??
      missingDependencyFn("evaluateEligibility"),
    hasContactCircleEntries: overrides?.hasContactCircleEntries ??
      missingDependencyFn("hasContactCircleEntries"),
    handoffToLinkupFlow: overrides?.handoffToLinkupFlow ??
      missingDependencyFn("handoffToLinkupFlow"),
    handoffToNamedPlanFlow: overrides?.handoffToNamedPlanFlow ??
      missingDependencyFn("handoffToNamedPlanFlow"),
    suggestSoloActivity: overrides?.suggestSoloActivity ?? missingDependencyFn("suggestSoloActivity"),
    sendMessage: overrides?.sendMessage ?? missingDependencyFn("sendMessage"),
    updateSessionMode: overrides?.updateSessionMode ?? missingDependencyFn("updateSessionMode"),
  };
}

function missingDependencyFn<T extends (...args: any[]) => unknown>(name: string): T {
  return ((..._args: any[]) => {
    throw new Error(`handleOpenIntent dependency '${name}' was not provided.`);
  }) as unknown as T;
}
