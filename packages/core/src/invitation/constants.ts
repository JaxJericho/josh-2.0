// Invitation cadence constants.
// Do not hardcode these values anywhere else - always import from here.

export const INVITATION_EXPIRY_HOURS = 48;
export const INVITATION_COOLDOWN_DAYS = 2;
export const INVITATION_WEEKLY_CAP = 3;
export const INVITATION_BACKOFF_THRESHOLD = 5; // backoff_count >= this -> suppressed
export const INVITATION_WEEK_ROLLING_DAYS = 7;
export const MAX_CLUSTER_SIZE = 10;
export const CLUSTER_MIN_PAIRWISE_SCORE = 0.65;

export const INVITATION_IDEMPOTENCY_KEY = (
  userId: string,
  activityKey: string,
  isoWeek: string,
): string => `invitation:${userId}:${activityKey}:${isoWeek}`;
