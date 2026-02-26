// @ts-ignore: Deno runtime requires explicit file extensions for local imports.
import {
  createAnonDbClient,
  createServiceRoleDbClient,
} from "../../../packages/db/src/client-deno.mjs";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import {
  ELIGIBLE_WAITLIST_STATUSES,
  executeWaitlistBatchNotify,
  parseWaitlistBatchNotifyRequest,
  type WaitlistBatchEntry,
  type WaitlistBatchNotifyRepository,
  type WaitlistBatchNotifySummary,
  type WaitlistBatchRegion,
  WaitlistBatchNotifyError,
} from "../_shared/waitlist/admin-waitlist-batch-notify.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { startOnboardingForActivatedUser } from "../_shared/engines/onboarding-engine.ts";
// @ts-ignore: Deno runtime requires explicit .ts extensions for local imports.
import { logEvent } from "../../../packages/core/src/observability/logger.ts";

const textEncoder = new TextEncoder();

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

    phase = "auth";
    await verifyAdminAccess(req, supabaseUrl);

    phase = "parse";
    const rawBody = await req.text();
    const parsedBody = parseJsonBody(rawBody);
    const command = parseWaitlistBatchNotifyRequest(parsedBody);

    phase = "repository";
    const serviceClient = createServiceRoleDbClient({
      env: {
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      },
    });
    const repository = createRepository({
      supabase: serviceClient,
    });

    phase = "execute";
    const summary = await executeWaitlistBatchNotify({
      request: command,
      repository,
    });

    logEvent({
      event: "admin.action_performed",
      correlation_id: requestId,
      payload: {
        action: "admin_waitlist_batch_notify",
        target_type: "waitlist_region",
        target_id: summary.region_slug,
        request_id: requestId,
        dry_run: summary.dry_run,
        selected_count: summary.selected_count,
        claimed_count: summary.claimed_count,
        attempted_send_count: summary.attempted_send_count,
        sent_count: summary.sent_count,
        skipped_already_notified_count: summary.skipped_already_notified_count,
        error_count: summary.errors.length,
      },
    });

    return jsonResponse(summary, 200, requestId);
  } catch (error) {
    const handled = toHandledError(error);
    logEvent({
      level: "error",
      event: "system.unhandled_error",
      correlation_id: requestId,
      payload: {
        request_id: requestId,
        phase,
        error_name: handled.code,
        error_message: handled.message,
        status_code: handled.status,
      },
    });

    return jsonResponse(
      {
        code: handled.code,
        message: handled.message,
        request_id: requestId,
      },
      handled.status,
      requestId,
    );
  }
});

function createRepository(input: {
  supabase: ReturnType<typeof createServiceRoleDbClient>;
}): WaitlistBatchNotifyRepository {
  return {
    findRegionBySlug: async (slug: string): Promise<WaitlistBatchRegion | null> => {
      const { data, error } = await input.supabase
        .from("regions")
        .select("id,slug,display_name,is_active")
        .eq("slug", slug)
        .maybeSingle();

      if (error) {
        throw new Error("Unable to resolve region by slug.");
      }
      if (!data?.id || !data.slug || !data.display_name) {
        return null;
      }

      return {
        id: data.id,
        slug: data.slug,
        display_name: data.display_name,
        is_active: Boolean(data.is_active),
      };
    },

    openRegion: async (regionId: string): Promise<boolean> => {
      const { data, error } = await input.supabase
        .from("regions")
        .update({
          is_active: true,
        })
        .eq("id", regionId)
        .eq("is_active", false)
        .select("id");

      if (error) {
        throw new Error("Unable to activate region.");
      }
      return (data?.length ?? 0) > 0;
    },

    selectEligibleEntries: async (
      regionId: string,
      limit: number,
    ): Promise<WaitlistBatchEntry[]> => {
      const { data, error } = await input.supabase
        .from("waitlist_entries")
        .select(
          "id,profile_id,user_id,region_id,status,created_at,last_notified_at,notified_at,updated_at",
        )
        .eq("region_id", regionId)
        .in("status", ELIGIBLE_WAITLIST_STATUSES as unknown as string[])
        .is("last_notified_at", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(limit);

      if (error) {
        throw new Error("Unable to select waitlist entries.");
      }

      return normalizeEntries(data ?? []);
    },

    claimEntries: async (
      regionId: string,
      entryIds: string[],
      claimedAtIso: string,
    ): Promise<WaitlistBatchEntry[]> => {
      if (entryIds.length === 0) {
        return [];
      }

      const { data, error } = await input.supabase
        .from("waitlist_entries")
        .update({
          status: "activated",
          activated_at: claimedAtIso,
          last_notified_at: claimedAtIso,
          notified_at: claimedAtIso,
        })
        .eq("region_id", regionId)
        .in("id", entryIds)
        .in("status", ELIGIBLE_WAITLIST_STATUSES as unknown as string[])
        .is("last_notified_at", null)
        .select(
          "id,profile_id,user_id,region_id,status,created_at,last_notified_at,notified_at,updated_at",
        );

      if (error) {
        throw new Error("Unable to claim waitlist entries.");
      }

      return normalizeEntries(data ?? []);
    },

    startOnboardingForActivatedUser: async (payload): Promise<"inserted" | "duplicate"> => {
      return startOnboardingForActivatedUser({
        supabase: input.supabase,
        userId: payload.user_id,
        correlationId: payload.waitlist_entry_id,
        activationIdempotencyKey: payload.idempotency_key,
      });
    },
  };
}

async function verifyAdminAccess(
  req: Request,
  supabaseUrl: string,
): Promise<void> {
  const adminSecretHeader = req.headers.get("x-admin-secret") ?? "";
  const configuredSecret = Deno.env.get("QSTASH_RUNNER_SECRET") ?? "";

  if (adminSecretHeader) {
    if (!configuredSecret) {
      throw new WaitlistBatchNotifyError(
        500,
        "MISSING_ENV",
        "Server misconfiguration: missing required env var QSTASH_RUNNER_SECRET.",
      );
    }
    if (!timingSafeEqual(adminSecretHeader, configuredSecret)) {
      throw new WaitlistBatchNotifyError(401, "UNAUTHORIZED", "Unauthorized.");
    }
    return;
  }

  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new WaitlistBatchNotifyError(401, "UNAUTHORIZED", "Unauthorized.");
  }

  const anonKey = requireEnv("SUPABASE_ANON_KEY");
  const authClient = createAnonDbClient({
    env: {
      SUPABASE_URL: supabaseUrl,
      SUPABASE_ANON_KEY: anonKey,
    },
    authorization,
  });

  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData.user?.id) {
    throw new WaitlistBatchNotifyError(401, "UNAUTHORIZED", "Unauthorized.");
  }

  const { data: isAdmin, error: adminCheckError } = await authClient.rpc(
    "is_admin_user",
  );
  if (adminCheckError) {
    throw new WaitlistBatchNotifyError(
      500,
      "ADMIN_CHECK_FAILED",
      "Unable to verify admin access.",
    );
  }

  if (!isAdmin) {
    throw new WaitlistBatchNotifyError(403, "FORBIDDEN", "Forbidden.");
  }
}

function normalizeEntries(rows: Array<Record<string, unknown>>): WaitlistBatchEntry[] {
  const entries: WaitlistBatchEntry[] = [];

  for (const row of rows) {
    if (
      typeof row.id !== "string" ||
      typeof row.profile_id !== "string" ||
      typeof row.user_id !== "string" ||
      typeof row.region_id !== "string" ||
      typeof row.status !== "string" ||
      typeof row.created_at !== "string"
    ) {
      continue;
    }

    entries.push({
      id: row.id,
      profile_id: row.profile_id,
      user_id: row.user_id,
      region_id: row.region_id,
      status: row.status,
      created_at: row.created_at,
      last_notified_at: typeof row.last_notified_at === "string" ? row.last_notified_at : null,
      notified_at: typeof row.notified_at === "string" ? row.notified_at : null,
      updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
    });
  }

  return entries;
}

function parseJsonBody(raw: string): unknown {
  if (!raw || raw.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new WaitlistBatchNotifyError(
      400,
      "INVALID_REQUEST",
      "Request body must be valid JSON.",
    );
  }
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new WaitlistBatchNotifyError(
      500,
      "MISSING_ENV",
      `Server misconfiguration: missing required env var ${name}.`,
    );
  }
  return value;
}

function toHandledError(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  if (error instanceof WaitlistBatchNotifyError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
    };
  }

  const message = extractMissingEnvName(error);
  if (message) {
    return {
      status: 500,
      code: "MISSING_ENV",
      message: `Server misconfiguration: missing required env var ${message}.`,
    };
  }

  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Internal error.",
  };
}

function extractMissingEnvName(error: unknown): string | null {
  const message = (error as { message?: string })?.message ?? "";
  const match = /missing required env var ([A-Z0-9_]+)/i.exec(message);
  return match ? match[1] : null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const aBytes = textEncoder.encode(a);
  const bBytes = textEncoder.encode(b);
  let result = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}

function jsonResponse(
  payload: WaitlistBatchNotifySummary | Record<string, unknown>,
  status: number,
  requestId?: string,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(requestId ? { "x-request-id": requestId } : {}),
    },
  });
}
