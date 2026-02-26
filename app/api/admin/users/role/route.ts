import { NextResponse } from "next/server";

import { logAdminAction } from "../../../../lib/admin-audit";
import { AdminAuthError, createAdminScopedClient, requireAdminRole } from "../../../../lib/admin-auth";
import { isAdminRole } from "../../../../lib/admin-session";
import { logEvent } from "../../../../lib/observability";

export async function POST(request: Request): Promise<Response> {
  try {
    const admin = await requireAdminRole("super_admin", { request });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;

    const userId = typeof body?.user_id === "string" ? body.user_id.trim() : "";
    const role = typeof body?.role === "string" ? body.role.trim() : "";

    if (!isValidUuid(userId) || !isAdminRole(role)) {
      return NextResponse.json(
        { code: "INVALID_REQUEST", message: "Expected user_id (uuid) and role (super_admin|moderator|ops)." },
        { status: 400 },
      );
    }

    const client = createAdminScopedClient(admin.authorization);
    const { data, error } = await client
      .from("admin_users")
      .upsert({ user_id: userId, role }, { onConflict: "user_id" })
      .select("user_id,role")
      .single();

    if (error || !data?.user_id || !isAdminRole(data.role)) {
      return NextResponse.json(
        { code: "ADMIN_ROLE_UPDATE_FAILED", message: "Unable to upsert admin role." },
        { status: 500 },
      );
    }

    await logAdminAction({
      authorization: admin.authorization,
      admin_user_id: admin.userId,
      action: "admin_user_role_upsert",
      target_type: "admin_user",
      target_id: data.user_id,
      metadata_json: {
        assigned_role: data.role,
      },
    });

    logEvent({
      level: "info",
      event: "admin.role_updated",
      user_id: admin.userId,
      correlation_id: admin.userId,
      payload: {
        actor_admin_user_id: admin.userId,
        target_user_id: data.user_id,
        assigned_role: data.role,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        admin_user: {
          user_id: data.user_id,
          role: data.role,
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
        phase: "admin_users_role_route",
        error_name: error instanceof Error ? error.name : "Error",
        error_message: message,
      },
    });
    return NextResponse.json({ code: "INTERNAL_ERROR", message }, { status: 500 });
  }
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
