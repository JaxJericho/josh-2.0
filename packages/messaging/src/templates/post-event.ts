export function renderPostEventAttendanceMessage(input: {
  firstName: string;
  activityName: string;
}): string {
  const firstName = requireNonEmpty(input.firstName, "firstName");
  const activityName = requireNonEmpty(input.activityName, "activityName");
  return `Hey ${firstName} — hope ${activityName} went well. Did you make it? Reply Yes or No.`;
}

export function postEventDoAgainMessage(): string {
  return "Glad you made it. Would you want to hang out with this group again? Reply A) Yes, B) Maybe, C) Probably not.";
}

export function postEventDoAgainClarifier(): string {
  return "Just reply A, B, or C.";
}

export function postEventFeedbackMessage(): string {
  return "Anything that would have made it better? Reply or just skip this one.";
}

export function renderPostEventDropoutNudgeMessage(input: { firstName: string }): string {
  const firstName = requireNonEmpty(input.firstName, "firstName");
  return `Still there, ${firstName}? No pressure — just reply when you can.`;
}

export function renderPostEventContactIntroMessage(input: {
  activityName: string;
}): string {
  const activityName = requireNonEmpty(input.activityName, "activityName");
  return `Want to stay in touch with anyone from ${activityName}? You can share your number with anyone who shares theirs back. Reply Yes to share with everyone, No to keep private, or name someone specific.`;
}

export function renderPostEventContactRevealMessage(input: {
  otherFirstName: string;
  phoneE164Formatted: string;
}): string {
  const otherFirstName = requireNonEmpty(input.otherFirstName, "otherFirstName");
  const phoneE164Formatted = requireNonEmpty(input.phoneE164Formatted, "phoneE164Formatted");
  return `Good news — ${otherFirstName} wants to stay in touch too. Here's their number: ${phoneE164Formatted}. Reply STOP anytime.`;
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must be non-empty.`);
  }
  return normalized;
}
