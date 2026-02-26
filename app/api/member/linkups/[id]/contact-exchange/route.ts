import { getSupabaseServiceRoleClient } from "../../../../../lib/supabase-service-role";
import { listUserLinkupExchangeStatuses } from "../../../../../lib/contact-exchange-status";
import { logEvent } from "../../../../../lib/observability";

export async function GET(
  request: Request,
  context: { params: { id: string } },
): Promise<Response> {
  const userId = new URL(request.url).searchParams.get("userId")?.trim() ?? "";
  const linkupId = context.params.id?.trim() ?? "";

  if (!userId) {
    return jsonResponse({ error: "Missing required query parameter: userId" }, 400);
  }

  if (!linkupId) {
    return jsonResponse({ error: "Missing required route parameter: id" }, 400);
  }

  try {
    const statuses = await listUserLinkupExchangeStatuses({
      db: getSupabaseServiceRoleClient(),
      userId,
    });

    const status = statuses.find((row) => row.linkup_id === linkupId);
    if (!status) {
      return jsonResponse({ error: "LinkUp outcome not found for user." }, 404);
    }

    const exchangeChoice = status.exchange_opt_in === true
      ? "yes"
      : status.exchange_opt_in === false
      ? "no"
      : "later";

    logEvent({
      level: "info",
      event: "post_event.contact_exchange_opt_in",
      user_id: userId,
      linkup_id: status.linkup_id,
      correlation_id: status.linkup_id,
      payload: {
        exchange_choice: exchangeChoice,
        exchange_opt_in: status.exchange_opt_in,
        mutual_detected: status.status === "mutual_revealed",
        reveal_sent: Boolean(status.exchange_revealed_at),
        blocked_by_safety: status.status === "blocked_by_safety",
      },
    });

    if (status.status === "mutual_revealed") {
      logEvent({
        level: "info",
        event: "post_event.contact_exchange_revealed",
        user_id: userId,
        linkup_id: status.linkup_id,
        correlation_id: status.linkup_id,
        payload: {
          linkup_id: status.linkup_id,
          mutual_detected: true,
          reveal_sent: true,
          exchange_choice: exchangeChoice,
        },
      });
    }

    return jsonResponse({
      linkup_id: status.linkup_id,
      exchange_opt_in: status.exchange_opt_in,
      exchange_revealed_at: status.exchange_revealed_at,
      status: status.status,
    }, 200);
  } catch (error) {
    logEvent({
      level: "error",
      event: "system.unhandled_error",
      correlation_id: linkupId || userId,
      payload: {
        phase: "member_contact_exchange_status_route",
        error_name: error instanceof Error ? error.name : "Error",
        error_message: (error as Error)?.message ?? "Unable to load contact exchange status.",
      },
    });
    return jsonResponse({
      error: (error as Error)?.message ?? "Unable to load contact exchange status.",
    }, 500);
  }
}

function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}
