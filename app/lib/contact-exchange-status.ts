import type { DbClient } from "../../packages/db/src/types";

export type ExchangeDashboardStatus =
  | "pending"
  | "mutual_revealed"
  | "declined"
  | "blocked_by_safety";

export type LinkupExchangeStatus = {
  linkup_id: string;
  exchange_opt_in: boolean | null;
  exchange_revealed_at: string | null;
  status: ExchangeDashboardStatus;
};

export function deriveExchangeDashboardStatus(input: {
  exchangeOptIn: boolean | null;
  exchangeRevealedAt: string | null;
  hasSafetySuppression: boolean;
}): ExchangeDashboardStatus {
  if (input.exchangeRevealedAt) {
    return "mutual_revealed";
  }

  if (input.exchangeOptIn === false) {
    return "declined";
  }

  if (input.exchangeOptIn === true && input.hasSafetySuppression) {
    return "blocked_by_safety";
  }

  return "pending";
}

export async function listUserLinkupExchangeStatuses(params: {
  db: DbClient;
  userId: string;
}): Promise<LinkupExchangeStatus[]> {
  const { data: outcomes, error: outcomesError } = await params.db
    .from("linkup_outcomes")
    .select("linkup_id,exchange_opt_in,exchange_revealed_at")
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false });

  if (outcomesError) {
    throw new Error("Unable to load linkup exchange outcomes for dashboard status.");
  }

  if (!outcomes || outcomes.length === 0) {
    return [];
  }

  const linkupIds = outcomes
    .map((row) => row.linkup_id)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (linkupIds.length === 0) {
    return [];
  }

  const { data: suppressionEvents, error: suppressionError } = await params.db
    .from("contact_exchange_events")
    .select("linkup_id,payload")
    .eq("event_type", "contact_exchange_suppressed")
    .in("linkup_id", linkupIds);

  if (suppressionError) {
    throw new Error("Unable to load contact exchange safety suppression events.");
  }

  const suppressedLinkupIds = new Set<string>();
  for (const eventRow of suppressionEvents ?? []) {
    const payload = eventRow.payload;
    if (!payload || typeof payload !== "object") {
      continue;
    }

    const userA = typeof (payload as Record<string, unknown>).user_a_id === "string"
      ? (payload as Record<string, string>).user_a_id
      : null;
    const userB = typeof (payload as Record<string, unknown>).user_b_id === "string"
      ? (payload as Record<string, string>).user_b_id
      : null;

    if (userA === params.userId || userB === params.userId) {
      if (typeof eventRow.linkup_id === "string" && eventRow.linkup_id.length > 0) {
        suppressedLinkupIds.add(eventRow.linkup_id);
      }
    }
  }

  return outcomes.map((row) => {
    const exchangeOptIn = typeof row.exchange_opt_in === "boolean"
      ? row.exchange_opt_in
      : null;
    const exchangeRevealedAt = typeof row.exchange_revealed_at === "string"
      ? row.exchange_revealed_at
      : null;

    return {
      linkup_id: row.linkup_id,
      exchange_opt_in: exchangeOptIn,
      exchange_revealed_at: exchangeRevealedAt,
      status: deriveExchangeDashboardStatus({
        exchangeOptIn,
        exchangeRevealedAt,
        hasSafetySuppression: suppressedLinkupIds.has(row.linkup_id),
      }),
    };
  });
}
