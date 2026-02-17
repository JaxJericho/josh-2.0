import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  AdminSetEntitlementsError,
  executeAdminSetEntitlements,
  parseAdminSetEntitlementsRequest,
  type AdminSetEntitlementsRepository,
  type ProfileEntitlementsRecord,
} from "../_shared/entitlements/admin-set-entitlements.ts";

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  let phase = "start";

  try {
    phase = "method";
    if (req.method !== "POST") {
      return jsonResponse(
        {
          code: "METHOD_NOT_ALLOWED",
          message: "Method Not Allowed",
          request_id: requestId,
        },
        405,
      );
    }

    phase = "env";
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = requireEnv("SUPABASE_ANON_KEY");

    phase = "auth";
    const authContext = await verifyAdminAccess({
      req,
      supabaseUrl,
      anonKey,
    });

    phase = "parse";
    const rawBody = await req.text();
    const body = parseJsonBody(rawBody);
    const command = parseAdminSetEntitlementsRequest(body);

    phase = "service_client";
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    phase = "actor";
    const actor = await resolveAdminActor({
      serviceClient,
      userId: authContext.user_id,
    });

    phase = "execute";
    const repository = createRepository(serviceClient);
    const result = await executeAdminSetEntitlements({
      command,
      actor,
      repository,
    });

    console.info("admin.profile_entitlements.updated", {
      request_id: requestId,
      admin_user_id: actor.admin_user_id,
      admin_profile_id: actor.admin_profile_id,
      profile_id: command.profile_id,
      fields: Object.keys(command.fields).sort(),
      has_reason: Boolean(command.reason),
      audit_log: result.audit_log,
    });

    return jsonResponse(
      {
        ok: true,
        profile_entitlements: result.profile_entitlements,
        idempotency_key: result.idempotency_key,
        audit_log: result.audit_log,
        request_id: requestId,
      },
      200,
    );
  } catch (error) {
    const handled = toHandledError(error);
    console.error("admin.profile_entitlements.failed", {
      request_id: requestId,
      phase,
      code: handled.code,
      message: handled.message,
      status: handled.status,
    });

    return jsonResponse(
      {
        code: handled.code,
        message: handled.message,
        request_id: requestId,
      },
      handled.status,
    );
  }
});

function createRepository(
  serviceClient: ReturnType<typeof createClient>,
): AdminSetEntitlementsRepository {
  return {
    upsertProfileEntitlements: async (input): Promise<ProfileEntitlementsRecord> => {
      const payload: Record<string, unknown> = {
        profile_id: input.profile_id,
        updated_by: input.updated_by,
        reason: input.reason,
      };

      for (const [field, value] of Object.entries(input.fields)) {
        payload[field] = value;
      }

      const { data, error } = await serviceClient
        .from("profile_entitlements")
        .upsert(payload, { onConflict: "profile_id" })
        .select(
          "id,profile_id,can_initiate,can_participate,can_exchange_contact,region_override,waitlist_override,safety_override,reason,updated_by,created_at,updated_at",
        )
        .single();

      if (error || !data?.id || !data.profile_id) {
        throw new AdminSetEntitlementsError(
          500,
          "UPSERT_FAILED",
          "Unable to upsert profile entitlements.",
        );
      }

      return {
        id: data.id,
        profile_id: data.profile_id,
        can_initiate: Boolean(data.can_initiate),
        can_participate: Boolean(data.can_participate),
        can_exchange_contact: Boolean(data.can_exchange_contact),
        region_override: Boolean(data.region_override),
        waitlist_override: Boolean(data.waitlist_override),
        safety_override: Boolean(data.safety_override),
        reason: typeof data.reason === "string" ? data.reason : null,
        updated_by: typeof data.updated_by === "string" ? data.updated_by : null,
        created_at: data.created_at,
        updated_at: data.updated_at,
      };
    },

    writeAuditLog: async (input): Promise<"inserted" | "duplicate"> => {
      const { error } = await serviceClient
        .from("audit_log")
        .insert({
          admin_user_id: input.admin_user_id,
          action: "admin_set_entitlements",
          target_type: "profile_entitlements",
          target_id: input.profile_id,
          reason: input.reason,
          payload: {
            fields: input.fields,
            updated_by: input.updated_by,
          },
          idempotency_key: input.idempotency_key,
        });

      if (error) {
        if (isDuplicateKeyError(error)) {
          return "duplicate";
        }
        throw new AdminSetEntitlementsError(
          500,
          "AUDIT_LOG_FAILED",
          "Unable to write admin audit log.",
        );
      }

      return "inserted";
    },
  };
}

async function verifyAdminAccess(params: {
  req: Request;
  supabaseUrl: string;
  anonKey: string;
}): Promise<{ user_id: string }> {
  const authorization = params.req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new AdminSetEntitlementsError(401, "UNAUTHORIZED", "Unauthorized.");
  }
  const accessToken = authorization.slice("Bearer ".length).trim();
  const userIdFromToken = parseUserIdFromJwt(accessToken);
  if (!userIdFromToken) {
    throw new AdminSetEntitlementsError(401, "UNAUTHORIZED", "Unauthorized.");
  }

  const authClient = createClient(params.supabaseUrl, params.anonKey, {
    auth: { persistSession: false },
    global: {
      headers: {
        authorization,
      },
    },
  });

  const { data: isAdmin, error: adminCheckError } = await authClient.rpc("is_admin_user");
  if (adminCheckError) {
    throw new AdminSetEntitlementsError(
      500,
      "ADMIN_CHECK_FAILED",
      "Unable to verify admin access.",
    );
  }

  if (!isAdmin) {
    throw new AdminSetEntitlementsError(403, "FORBIDDEN", "Forbidden.");
  }

  return {
    user_id: userIdFromToken,
  };
}

async function resolveAdminActor(params: {
  serviceClient: ReturnType<typeof createClient>;
  userId: string;
}): Promise<{ admin_user_id: string; admin_profile_id: string }> {
  const { data: adminUser, error: adminUserError } = await params.serviceClient
    .from("admin_users")
    .select("id")
    .eq("user_id", params.userId)
    .maybeSingle();

  if (adminUserError) {
    throw new AdminSetEntitlementsError(
      500,
      "ADMIN_LOOKUP_FAILED",
      "Unable to resolve admin identity.",
    );
  }

  if (!adminUser?.id) {
    throw new AdminSetEntitlementsError(403, "FORBIDDEN", "Forbidden.");
  }

  const { data: profile, error: profileError } = await params.serviceClient
    .from("profiles")
    .select("id")
    .eq("user_id", params.userId)
    .maybeSingle();

  if (profileError) {
    throw new AdminSetEntitlementsError(
      500,
      "ADMIN_PROFILE_LOOKUP_FAILED",
      "Unable to resolve admin profile.",
    );
  }

  if (!profile?.id) {
    throw new AdminSetEntitlementsError(
      403,
      "ADMIN_PROFILE_REQUIRED",
      "Admin profile is required for entitlement overrides.",
    );
  }

  return {
    admin_user_id: adminUser.id,
    admin_profile_id: profile.id,
  };
}

function parseJsonBody(raw: string): unknown {
  if (!raw || raw.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new AdminSetEntitlementsError(
      400,
      "INVALID_REQUEST",
      "Request body must be valid JSON.",
    );
  }
}

function toHandledError(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  if (error instanceof AdminSetEntitlementsError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
    };
  }

  const message = error instanceof Error ? error.message : "Internal server error.";
  if (message.startsWith("Missing required env var:")) {
    return {
      status: 500,
      code: "MISSING_ENV",
      message: "Server misconfiguration.",
    };
  }

  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Internal server error.",
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function isDuplicateKeyError(error: { code?: string; message?: string } | null): boolean {
  if (!error) {
    return false;
  }
  if (error.code === "23505") {
    return true;
  }
  const message = error.message ?? "";
  return message.toLowerCase().includes("duplicate key");
}

function parseUserIdFromJwt(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  try {
    const payloadJson = new TextDecoder().decode(base64UrlDecode(parts[1]));
    const payload = JSON.parse(payloadJson) as { sub?: unknown };
    if (typeof payload.sub !== "string") {
      return null;
    }
    const normalized = payload.sub.trim();
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
