export function renderSystemOtpMessage(input: {
  code: string;
  expiresInMinutes: number;
}): string {
  const code = requireNonEmpty(input.code, "code");
  const expiresInMinutes = normalizePositiveInt(input.expiresInMinutes, "expiresInMinutes");
  return `JOSH verification code: ${code}. It expires in ${expiresInMinutes} minutes.`;
}

export function systemHelpResponse(): string {
  return "JOSH help: Reply STOP to opt out. Reply START to resubscribe.";
}

export function systemUnknownIntentResponse(): string {
  return "I didn't catch that. Reply HELP if you need support.";
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must be non-empty.`);
  }
  return normalized;
}

function normalizePositiveInt(value: number, field: string): number {
  const normalized = Math.trunc(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return normalized;
}
