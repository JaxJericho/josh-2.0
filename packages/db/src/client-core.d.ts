import type { SupabaseClient, SupabaseClientOptions } from "@supabase/supabase-js";
import type { Database } from "../../../supabase/types/database";

export type DbClientRole = "service" | "anon";

export type DbCreateClientImpl = (
  supabaseUrl: string,
  supabaseKey: string,
  options: SupabaseClientOptions<"public">,
) => SupabaseClient<Database>;

export type CreateDbClientParams = {
  role?: DbClientRole;
  getEnv: (name: string) => string | undefined;
  createClientImpl: DbCreateClientImpl;
  authorization?: string | null;
  clientOptions?: SupabaseClientOptions<"public">;
};

export declare function createDbClient(params: CreateDbClientParams): SupabaseClient<Database>;
