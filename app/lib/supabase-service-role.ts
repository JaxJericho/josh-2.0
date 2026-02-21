import "server-only";
import type { DbClient } from "../../packages/db/src/types";
import { createServiceRoleDbClient } from "../../packages/db/src/client-node.mjs";

let serviceRoleClient: DbClient | null = null;

export function getSupabaseServiceRoleClient(): DbClient {
  if (!serviceRoleClient) {
    serviceRoleClient = createServiceRoleDbClient();
  }

  if (!serviceRoleClient) {
    throw new Error("Failed to initialize Supabase service role client.");
  }

  return serviceRoleClient;
}
