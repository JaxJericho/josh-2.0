import { DB_ERROR_CODES, DbError, assertRequiredEnv } from "./errors.mjs";

const DEFAULT_AUTH_OPTIONS = Object.freeze({
  persistSession: false,
  autoRefreshToken: false,
});

function resolveKeyEnvName(role) {
  if (role === "service") {
    return "SUPABASE_SERVICE_ROLE_KEY";
  }

  if (role === "anon") {
    return "SUPABASE_ANON_KEY";
  }

  throw new DbError(DB_ERROR_CODES.INVALID_ENV, `Unsupported db client role: ${String(role)}`, {
    status: 500,
    context: { role },
  });
}

function buildOptions(params) {
  const auth = {
    ...DEFAULT_AUTH_OPTIONS,
    ...(params.clientOptions?.auth ?? {}),
  };

  const headers = {
    ...(params.clientOptions?.global?.headers ?? {}),
  };

  if (params.authorization) {
    headers.authorization = params.authorization;
  }

  const hasHeaders = Object.keys(headers).length > 0;

  return {
    ...(params.clientOptions ?? {}),
    auth,
    global: hasHeaders
      ? {
          ...(params.clientOptions?.global ?? {}),
          headers,
        }
      : params.clientOptions?.global,
  };
}

export function createDbClient(params = {}) {
  const {
    role = "service",
    getEnv,
    createClientImpl,
    authorization,
    clientOptions,
  } = params;

  if (typeof createClientImpl !== "function") {
    throw new DbError(
      DB_ERROR_CODES.CLIENT_INIT_FAILED,
      "createClient implementation is required.",
      {
        status: 500,
      },
    );
  }

  if (typeof getEnv !== "function") {
    throw new DbError(DB_ERROR_CODES.CLIENT_INIT_FAILED, "Environment reader is required.", {
      status: 500,
    });
  }

  const supabaseUrl = assertRequiredEnv("SUPABASE_URL", getEnv("SUPABASE_URL"));
  const keyName = resolveKeyEnvName(role);
  const supabaseKey = assertRequiredEnv(keyName, getEnv(keyName));

  try {
    return createClientImpl(supabaseUrl, supabaseKey, buildOptions({ authorization, clientOptions }));
  } catch (error) {
    throw DbError.fromUnknown({
      code: DB_ERROR_CODES.CLIENT_INIT_FAILED,
      message: "Failed to create Supabase client.",
      error,
      status: 500,
      context: { role },
    });
  }
}
