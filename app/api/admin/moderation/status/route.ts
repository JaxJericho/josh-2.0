import { NextResponse } from "next/server";

import { logAdminAction } from "../../../../lib/admin-audit";
import { AdminAuthError, requireAdminRole } from "../../../../lib/admin-auth";
import { logEvent } from "../../../../lib/observability";
import { attachSentryScopeContext, traceApiRoute } from "../../../../lib/sentry";
import { getSupabaseServiceRoleClient } from "../../../../lib/supabase-service-role";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_STATUSES = new Set(["open", "reviewed", "resolved"]);

type DynamicClient = {
  from: (table: string) => any;
};

export async function POST(request: Request): Promise<Response> {
  const handler = "api/admin/moderation/status";
  attachSentryScopeContext({
    category: "admin_action",
    tags: { handler },
  });

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

    if (!UUID_PATTERN.test(payload.incident_id) || !ALLOWED_STATUSES.has(payload.status)) {
      return NextResponse.json(
        { code: "INVALID_REQUEST", message: "Expected incident_id (uuid) and status (open|reviewed|resolved)." },
        { status: 400 },
      );
    }

    const serviceClient = getSupabaseServiceRoleClient();
    const dynamicDb = serviceClient as unknown as DynamicClient;

    const { data: before, error: beforeError } = await dynamicDb
      .from("moderation_incidents")
      .select("id,status")
      .eq("id", payload.incident_id)
      .maybeSingle();
    if (beforeError) {
      return NextResponse.json(
        { code: "INCIDENT_READ_FAILED", message: "Unable to read moderation incident." },
        { status: 500 },
      );
    }

    if (!before?.id) {
      return NextResponse.json({ code: "NOT_FOUND", message: "Moderation incident not found." }, { status: 404 });
    }

    const { data: updated, error: updateError } = await dynamicDb
      .from("moderation_incidents")
      .update({ status: payload.status })
      .eq("id", payload.incident_id)
      .select("id,status")
      .single();
    if (updateError || !updated?.id) {
      return NextResponse.json(
        { code: "INCIDENT_UPDATE_FAILED", message: "Unable to update moderation incident status." },
        { status: 500 },
      );
    }

    await logAdminAction(
      {
        authorization: admin.authorization,
        admin_user_id: admin.userId,
        action: "moderation_incident_status_update",
        target_type: "moderation_incident",
        target_id: updated.id,
        metadata_json: {
          before_status: before.status,
          after_status: updated.status,
        },
      },
      { client: serviceClient },
    );

    logEvent({
      level: "info",
      event: "admin.incident_status_updated",
      user_id: admin.userId,
      correlation_id: updated.id,
      payload: {
        actor_admin_user_id: admin.userId,
        incident_id: updated.id,
        before_status: before.status,
        after_status: updated.status,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        incident: {
          id: updated.id,
          status: updated.status,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof AdminAuthError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Internal server error.";
    logEvent({
      level: "error",
      event: "system.unhandled_error",
      payload: {
        phase: "admin_moderation_status_route",
        error_name: error instanceof Error ? error.name : "Error",
        error_message: message,
      },
    });
    return NextResponse.json({ code: "INTERNAL_ERROR", message }, { status: 500 });
  }
  });
}

async function parseRequestPayload(request: Request): Promise<{
  incident_id: string;
  status: string;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    return {
      incident_id: typeof body?.incident_id === "string" ? body.incident_id.trim() : "",
      status: typeof body?.status === "string" ? body.status.trim().toLowerCase() : "",
    };
  }

  const form = await request.formData();
  return {
    incident_id: String(form.get("incident_id") ?? "").trim(),
    status: String(form.get("status") ?? "").trim().toLowerCase(),
  };
}
