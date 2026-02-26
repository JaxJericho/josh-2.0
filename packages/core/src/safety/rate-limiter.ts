export type RollingWindowState = {
  window_start: string | null;
  count: number;
};

export type RateLimitConfig = {
  max_messages: number;
  window_seconds: number;
};

export type RateLimitEvaluation = {
  exceeded: boolean;
  next_window_start: string;
  next_count: number;
};

export function evaluateRollingWindowRateLimit(params: {
  now_iso: string;
  state: RollingWindowState;
  config: RateLimitConfig;
}): RateLimitEvaluation {
  const now = new Date(params.now_iso);
  if (Number.isNaN(now.getTime())) {
    throw new Error("Invalid now_iso timestamp for rate limiting.");
  }

  if (params.config.max_messages <= 0) {
    throw new Error("Rate-limit max_messages must be greater than zero.");
  }

  if (params.config.window_seconds <= 0) {
    throw new Error("Rate-limit window_seconds must be greater than zero.");
  }

  const existingWindowStart = params.state.window_start
    ? new Date(params.state.window_start)
    : null;

  const isCurrentWindow = existingWindowStart !== null &&
    !Number.isNaN(existingWindowStart.getTime()) &&
    (now.getTime() - existingWindowStart.getTime()) <
      params.config.window_seconds * 1000;

  const nextCount = isCurrentWindow
    ? Math.max(0, params.state.count) + 1
    : 1;

  const nextWindowStart = isCurrentWindow
    ? existingWindowStart!.toISOString()
    : now.toISOString();

  return {
    exceeded: nextCount > params.config.max_messages,
    next_window_start: nextWindowStart,
    next_count: nextCount,
  };
}
