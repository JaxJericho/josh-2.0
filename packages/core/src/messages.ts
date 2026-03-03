export type PlanConfirmationPromptInput = {
  contactName: string;
  activityHint?: string;
  timeWindowHint?: string;
};

const NAMED_PLAN_SUBSCRIPTION_PROMPT =
  "To coordinate plans with your contacts, you'll need an active JOSH subscription. Reply SUBSCRIBE to get started.";

export const CLARIFY_CONTACT_MESSAGE =
  "Who should I reach out to? Share their name and I can draft the plan.";

export function buildSubscriptionPrompt(_reason?: string | null): string {
  return NAMED_PLAN_SUBSCRIPTION_PROMPT;
}

export function buildContactNotFoundMessage(contactName: string): string {
  const normalizedName = normalizeContactName(contactName);
  return `I don't have ${normalizedName} in your contacts yet. Want to add them? Reply with their number.`;
}

export function buildPlanConfirmationPrompt(input: PlanConfirmationPromptInput): string {
  const contactName = normalizeContactName(input.contactName);
  const activityHint = normalizeOptionalText(input.activityHint);
  const timeWindowHint = normalizeOptionalText(input.timeWindowHint);

  let detail = "";
  if (activityHint && timeWindowHint) {
    detail = ` about ${activityHint} ${timeWindowHint}`;
  } else if (activityHint) {
    detail = ` about ${activityHint}`;
  } else if (timeWindowHint) {
    detail = ` for ${timeWindowHint}`;
  }

  return `Got it. I'll reach out to ${contactName}${detail}. Should I go ahead?`;
}

function normalizeContactName(contactName: string): string {
  const normalized = normalizeOptionalText(contactName);
  return normalized ?? "them";
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
