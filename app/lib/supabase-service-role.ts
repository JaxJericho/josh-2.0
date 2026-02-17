import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../supabase/types/database";

let serviceRoleClient: SupabaseClient<Database> | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function getSupabaseServiceRoleClient(): SupabaseClient<Database> {
  if (!serviceRoleClient) {
    serviceRoleClient = createClient<Database>(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }

  return serviceRoleClient;
}
