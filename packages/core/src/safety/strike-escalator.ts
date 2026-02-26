import type { SafetySeverity } from "./keyword-catalog.ts";

export type StrikeEscalationState = {
  strike_count: number;
  safety_hold: boolean;
};

export type StrikeEscalationEvaluation = {
  strike_increment: number;
  next_strike_count: number;
  next_safety_hold: boolean;
  escalated: boolean;
};

export function resolveStrikeIncrement(
  severity: SafetySeverity,
): number {
  switch (severity) {
    case "low":
      return 0;
    case "medium":
      return 1;
    case "high":
      return 2;
    case "crisis":
      return 0;
    default: {
      const exhaustiveCheck: never = severity;
      throw new Error(`Unsupported severity '${exhaustiveCheck}'.`);
    }
  }
}

export function evaluateStrikeEscalation(params: {
  state: StrikeEscalationState;
  severity: SafetySeverity;
  escalation_threshold: number;
}): StrikeEscalationEvaluation {
  if (params.escalation_threshold <= 0) {
    throw new Error("Escalation threshold must be greater than zero.");
  }

  const increment = resolveStrikeIncrement(params.severity);
  const nextStrikeCount = Math.max(0, params.state.strike_count) + increment;
  const nextSafetyHold = params.severity === "crisis"
    ? true
    : params.state.safety_hold || nextStrikeCount >= params.escalation_threshold;

  return {
    strike_increment: increment,
    next_strike_count: nextStrikeCount,
    next_safety_hold: nextSafetyHold,
    escalated: !params.state.safety_hold && nextSafetyHold,
  };
}
