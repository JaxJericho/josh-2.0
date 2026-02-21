export function renderLinkupInviteMessage(input: {
  firstName: string;
  activityName: string;
  whenText: string;
}): string {
  const firstName = requireNonEmpty(input.firstName, "firstName");
  const activityName = requireNonEmpty(input.activityName, "activityName");
  const whenText = requireNonEmpty(input.whenText, "whenText");
  return `Hey ${firstName} — want in on a LinkUp for ${activityName} ${whenText}? Reply YES or NO.`;
}

export function linkupInviteClarifier(): string {
  return "I didn't catch that. Reply YES to accept or NO to decline.";
}

export function linkupInviteAccepted(): string {
  return "You're in. I'll text you when this LinkUp is locked.";
}

export function linkupLockConfirmation(): string {
  return "You're in. This LinkUp is now locked.";
}

export function linkupInviteDeclined(): string {
  return "Got it. You're out for this LinkUp.";
}

export function linkupInviteClosed(): string {
  return "This LinkUp is already locked, so this invite is closed.";
}

export function linkupInviteExpired(): string {
  return "This invite already expired, so I couldn't apply that reply.";
}

export function linkupInviteCapacityReached(): string {
  return "This LinkUp just filled up, so I couldn't add you.";
}

export function linkupInviteNotFound(): string {
  return "I couldn't find an open invite for you right now.";
}

export function linkupInviteDuplicateReply(): string {
  return "Thanks - we already processed that reply.";
}

export function linkupInviteFallbackReply(): string {
  return "I couldn't apply that reply right now. Reply HELP for support.";
}

export function renderLinkupReminderMessage(input: {
  activityName: string;
  startsAtText: string;
}): string {
  const activityName = requireNonEmpty(input.activityName, "activityName");
  const startsAtText = requireNonEmpty(input.startsAtText, "startsAtText");
  return `Reminder: your LinkUp for ${activityName} starts ${startsAtText}.`;
}

export function renderLinkupCoordinationMessage(input: {
  activityName: string;
  locationName: string;
  startsAtText: string;
}): string {
  const activityName = requireNonEmpty(input.activityName, "activityName");
  const locationName = requireNonEmpty(input.locationName, "locationName");
  const startsAtText = requireNonEmpty(input.startsAtText, "startsAtText");
  return `Your LinkUp for ${activityName} is set: ${locationName}, ${startsAtText}. Reply HELP if you need support.`;
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must be non-empty.`);
  }
  return normalized;
}
