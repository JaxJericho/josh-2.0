export function safetyCrisisResources(): string {
  return "I'm concerned about you. If you're in crisis, please reach out to the 988 Suicide and Crisis Lifeline by calling or texting 988. They're available 24/7. You can also text HOME to 741741 for the Crisis Text Line.";
}

export function safetyHoldNotification(): string {
  return "Your account is currently paused for safety review. Reply HELP for support.";
}

export function renderSafetyBlockConfirmation(input: { name: string }): string {
  const name = requireNonEmpty(input.name, "name");
  return `Done. ${name} won't be included in any future plans with you.`;
}

export function safetyReportPrompt(): string {
  return "What's this about? Reply A) Inappropriate behavior, B) Made me uncomfortable, C) No-show or canceled last minute, D) Other.";
}

export function safetyReportConfirmation(): string {
  return "Got it. We'll look into it. Thanks for letting us know.";
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must be non-empty.`);
  }
  return normalized;
}
