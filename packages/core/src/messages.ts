export type PlanConfirmationPromptInput = {
  contactName: string;
  activityHint?: string;
  timeWindowHint?: string;
};

const NAMED_PLAN_SUBSCRIPTION_PROMPT =
  "To coordinate plans with your contacts, you'll need an active JOSH subscription. Reply SUBSCRIBE to get started.";

export const CLARIFY_CONTACT_MESSAGE =
  "Who should I reach out to? Share their name and I can draft the plan.";

export const SOLO_CHECKIN_DO_AGAIN_PROMPT =
  "Would you do something like this again?";
export const SOLO_CHECKIN_BRIDGE_OFFER =
  "Want me to find someone to do this with next time?";
export const SOLO_CHECKIN_CLARIFY_ATTENDANCE = "Did you end up going?";
export const SOLO_CHECKIN_CLARIFY_DO_AGAIN = "Worth doing again?";
export const SOLO_CHECKIN_WRAP_ATTENDED = "Nice. I'll keep that in mind.";
export const SOLO_CHECKIN_WRAP_SKIPPED =
  "No worries - I'll keep an eye out for a good time.";
export const SOLO_CHECKIN_WRAP_BRIDGE_DECLINED = "Got it.";
export const SOLO_CHECKIN_WRAP_BRIDGE_ACCEPTED =
  "On it. I'll loop in your contacts when the time is right.";
export const CHECKIN_ERROR_RECOVERY_MESSAGE =
  "Hey - something went sideways on my end. Text me whenever you're ready and we'll pick up.";

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
