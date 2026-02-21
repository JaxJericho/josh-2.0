import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createDbClient as createDbClientInternal } from "./client-core.mjs";

function createEnvReader(env) {
  return (name) => {
    const value = env?.[name];
    if (typeof value === "string") {
      return value;
    }
    return value == null ? undefined : String(value);
  };
}

export function createDbClient(params = {}) {
  const env = params.env ?? process.env;

  return createDbClientInternal({
    role: params.role,
    authorization: params.authorization,
    clientOptions: params.clientOptions,
    getEnv: createEnvReader(env),
    createClientImpl: createSupabaseClient,
  });
}

export function createServiceRoleDbClient(params = {}) {
  return createDbClient({ ...params, role: "service" });
}

export function createAnonDbClient(params = {}) {
  return createDbClient({ ...params, role: "anon" });
}
