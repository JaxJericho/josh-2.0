import type { Json } from "../../supabase/types/database";
import type { DbClient } from "../../packages/db/src/types";
import { createAdminScopedClient } from "./admin-auth";
import { logEvent } from "./observability";

export async function logAdminAction(input: {
  authorization: string;
  admin_user_id: string;
  action: string;
  target_type: string;
  target_id?: string | null;
  metadata_json?: Json;
}, dependencies?: {
  client?: Pick<DbClient, "from">;
}): Promise<void> {
  const client = dependencies?.client ?? createAdminScopedClient(input.authorization);
  const payload = {
    admin_user_id: input.admin_user_id,
    action: input.action,
    target_type: input.target_type,
    target_id: input.target_id ?? null,
    metadata_json: input.metadata_json ?? {},
  };

  const { error } = await client.from("admin_audit_log").insert(payload);
  if (error) {
    throw new Error(`Unable to write admin audit log: ${error.message}`);
  }

  logEvent({
    level: "info",
    event: "admin.action_performed",
    user_id: input.admin_user_id,
    payload: {
      action: input.action,
      target_type: input.target_type,
      target_id: input.target_id ?? null,
      metadata_json: input.metadata_json ?? {},
    },
  });
}
