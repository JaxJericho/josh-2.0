export const SOCIAL_CHOICE_STATE_TOKEN_PREFIX = "social:awaiting_choice";
export const PENDING_PLAN_CONFIRMATION_STATE_TOKEN = "plan:pending_confirmation";
export const MAX_SOCIAL_CHOICE_ALTERNATIVE_REQUESTS = 3;

export type SocialChoiceState = {
  activityKey: string | null;
  alternativeRequestCount: number;
};

export function buildSocialChoiceStateToken(
  activityKey: string | null,
  alternativeRequestCount: number,
): string {
  const normalizedCount = normalizeAlternativeRequestCount(alternativeRequestCount);
  const normalizedActivityKey = sanitizeTokenSegment(activityKey);

  if (!normalizedActivityKey) {
    return `${SOCIAL_CHOICE_STATE_TOKEN_PREFIX}:${normalizedCount}`;
  }

  return `${SOCIAL_CHOICE_STATE_TOKEN_PREFIX}:${normalizedActivityKey}:${normalizedCount}`;
}

export function parseSocialChoiceStateToken(
  stateToken: string | null | undefined,
): SocialChoiceState {
  const token = stateToken?.trim() ?? "";
  if (!token.startsWith(SOCIAL_CHOICE_STATE_TOKEN_PREFIX)) {
    return {
      activityKey: null,
      alternativeRequestCount: 0,
    };
  }

  const suffix = token.slice(SOCIAL_CHOICE_STATE_TOKEN_PREFIX.length);
  const segments = suffix
    .split(":")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return {
      activityKey: null,
      alternativeRequestCount: 0,
    };
  }

  if (segments.length === 1) {
    const maybeCount = Number.parseInt(segments[0], 10);
    if (!Number.isNaN(maybeCount)) {
      return {
        activityKey: null,
        alternativeRequestCount: normalizeAlternativeRequestCount(maybeCount),
      };
    }

    return {
      activityKey: segments[0],
      alternativeRequestCount: 0,
    };
  }

  const maybeCount = Number.parseInt(segments[segments.length - 1], 10);
  if (Number.isNaN(maybeCount)) {
    return {
      activityKey: segments.join(":"),
      alternativeRequestCount: 0,
    };
  }

  return {
    activityKey: segments.slice(0, -1).join(":") || null,
    alternativeRequestCount: normalizeAlternativeRequestCount(maybeCount),
  };
}

function sanitizeTokenSegment(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized.length > 0 ? sanitized : null;
}

function normalizeAlternativeRequestCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}
