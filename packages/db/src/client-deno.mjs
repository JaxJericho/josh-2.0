import { createClient as createSupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";
import { createDbClient as createDbClientInternal } from "./client-core.mjs";

function createEnvReader(env) {
  return (name) => {
    if (env && typeof env[name] === "string") {
      return env[name];
    }

    const denoValue = Deno.env.get(name);
    return denoValue ?? undefined;
  };
}

export function createDbClient(params = {}) {
  return createDbClientInternal({
    role: params.role,
    authorization: params.authorization,
    clientOptions: params.clientOptions,
    getEnv: createEnvReader(params.env),
    createClientImpl: createSupabaseClient,
  });
}

export function createServiceRoleDbClient(params = {}) {
  return createDbClient({ ...params, role: "service" });
}

export function createAnonDbClient(params = {}) {
  return createDbClient({ ...params, role: "anon" });
}
