import { NextResponse } from "next/server";

import { logAdminAction } from "../../../../lib/admin-audit";
import { AdminAuthError, requireAdminRole } from "../../../../lib/admin-auth";
import { logEvent } from "../../../../lib/observability";
import { attachSentryScopeContext, traceApiRoute } from "../../../../lib/sentry";
import { getSupabaseServiceRoleClient } from "../../../../lib/supabase-service-role";
import {
  elapsedMetricMs,
  emitMetricBestEffort,
  nowMetricMs,
} from "../../../../../packages/core/src/observability/metrics";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DynamicClient = {
  from: (table: string) => any;
};

export async function POST(request: Request): Promise<Response> {
  const startedAt = nowMetricMs();
  const handler = "api/admin/users/safety-hold";
  let outcome: "success" | "error" = "success";
  return traceApiRoute(handler, async () => {
    try {
      const admin = await requireAdminRole(["super_admin", "moderator"], { request });
      attachSentryScopeContext({
        category: "admin_action",
        correlation_id: admin.userId,
        user_id: admin.userId,
        tags: { handler },
      });
      const payload = await parseRequestPayload(request);

      if (!UUID_PATTERN.test(payload.user_id) || typeof payload.safety_hold !== "boolean") {
        return NextResponse.json(
          { code: "INVALID_REQUEST", message: "Expected user_id (uuid) and safety_hold (boolean)." },
          { status: 400 },
        );
      }

      const serviceClient = getSupabaseServiceRoleClient();
      const dynamicDb = serviceClient as unknown as DynamicClient;

      const { data: before, error: beforeError } = await dynamicDb
        .from("user_safety_state")
        .select("user_id,safety_hold,strike_count,last_strike_at")
        .eq("user_id", payload.user_id)
        .maybeSingle();
      if (beforeError) {
        return NextResponse.json(
          { code: "SAFETY_STATE_READ_FAILED", message: "Unable to read prior safety state." },
          { status: 500 },
        );
      }

      const { data: updated, error: updateError } = await dynamicDb
        .from("user_safety_state")
        .upsert(
          {
            user_id: payload.user_id,
            safety_hold: payload.safety_hold,
            last_safety_event_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        )
        .select("user_id,safety_hold,strike_count,last_strike_at,last_safety_event_at")
        .single();
      if (updateError || !updated) {
        return NextResponse.json(
          { code: "SAFETY_STATE_UPDATE_FAILED", message: "Unable to update user safety hold." },
          { status: 500 },
        );
      }

      await logAdminAction(
        {
          authorization: admin.authorization,
          admin_user_id: admin.userId,
          action: payload.safety_hold ? "user_safety_hold_enabled" : "user_safety_hold_disabled",
          target_type: "user",
          target_id: payload.user_id,
          metadata_json: {
            before_state: before ?? null,
            after_state: updated,
          },
        },
        { client: serviceClient },
      );

      logEvent({
        level: "info",
        event: "admin.safety_hold_toggled",
        user_id: admin.userId,
        correlation_id: payload.user_id,
        payload: {
          actor_admin_user_id: admin.userId,
          target_user_id: payload.user_id,
          safety_hold: updated.safety_hold,
          before_state: before ?? null,
          after_state: updated,
        },
      });

      return NextResponse.json(
        {
          ok: true,
          user_safety_state: {
            user_id: updated.user_id,
            safety_hold: updated.safety_hold,
            strike_count: updated.strike_count,
            last_strike_at: updated.last_strike_at,
            last_safety_event_at: updated.last_safety_event_at,
          },
        },
        { status: 200 },
      );
    } catch (error) {
      outcome = "error";
      if (error instanceof AdminAuthError) {
        return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
      }

      const message = error instanceof Error ? error.message : "Internal server error.";
      logEvent({
        level: "error",
        event: "system.unhandled_error",
        payload: {
          phase: "admin_users_safety_hold_route",
          error_name: error instanceof Error ? error.name : "Error",
          error_message: message,
        },
      });
      return NextResponse.json({ code: "INTERNAL_ERROR", message }, { status: 500 });
    } finally {
      emitMetricBestEffort({
        metric: "system.request.latency",
        value: elapsedMetricMs(startedAt),
        tags: {
          component: "admin_api",
          operation: "users_safety_hold_post",
          outcome,
        },
      });
    }
  });
}

async function parseRequestPayload(request: Request): Promise<{
  user_id: string;
  safety_hold: boolean | null;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    return {
      user_id: typeof body?.user_id === "string" ? body.user_id.trim() : "",
      safety_hold: typeof body?.safety_hold === "boolean" ? body.safety_hold : null,
    };
  }

  const form = await request.formData();
  const safetyHold = String(form.get("safety_hold") ?? "");
  return {
    user_id: String(form.get("user_id") ?? "").trim(),
    safety_hold: safetyHold === "true" ? true : safetyHold === "false" ? false : null,
  };
}
