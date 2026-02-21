import type { SupabaseClient, SupabaseClientOptions } from "@supabase/supabase-js";
import type { Database } from "../../../supabase/types/database";
import type { DbClientRole } from "./client-core.d.ts";

export type NodeDbEnv = Record<string, string | undefined>;

export type NodeCreateDbClientParams = {
  role?: DbClientRole;
  env?: NodeDbEnv;
  authorization?: string | null;
  clientOptions?: SupabaseClientOptions<"public">;
};

export declare function createDbClient(
  params?: NodeCreateDbClientParams,
): SupabaseClient<Database>;

export declare function createServiceRoleDbClient(
  params?: Omit<NodeCreateDbClientParams, "role">,
): SupabaseClient<Database>;

export declare function createAnonDbClient(
  params?: Omit<NodeCreateDbClientParams, "role">,
): SupabaseClient<Database>;
