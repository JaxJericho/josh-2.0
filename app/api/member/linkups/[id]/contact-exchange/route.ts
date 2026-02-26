import { getSupabaseServiceRoleClient } from "../../../../../lib/supabase-service-role";
import { listUserLinkupExchangeStatuses } from "../../../../../lib/contact-exchange-status";

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

    return jsonResponse({
      linkup_id: status.linkup_id,
      exchange_opt_in: status.exchange_opt_in,
      exchange_revealed_at: status.exchange_revealed_at,
      status: status.status,
    }, 200);
  } catch (error) {
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
