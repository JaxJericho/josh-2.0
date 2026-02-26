export type SentryEnvironment = "local" | "staging" | "production";

export type ResolveSentryRuntimeConfigInput = {
  dsn?: string | null;
  environment?: string | null;
  release?: string | null;
};

export type SentryRuntimeConfig = {
  dsn: string | null;
  environment: SentryEnvironment;
  release: string | null;
  enabled: boolean;
  tracesSampleRate: number;
};

export function resolveSentryRuntimeConfig(
  input: ResolveSentryRuntimeConfigInput,
): SentryRuntimeConfig {
  const dsn = normalizeString(input.dsn);
  const environment = normalizeSentryEnvironment(input.environment);
  const release = normalizeString(input.release);
  const enabled = Boolean(dsn) && environment !== "local";

  return {
    dsn,
    environment,
    release,
    enabled,
    tracesSampleRate: environment === "staging" ? 1.0 : 0.2,
  };
}

export function normalizeSentryEnvironment(value: string | null | undefined): SentryEnvironment {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "staging") {
    return "staging";
  }
  if (normalized === "production" || normalized === "prod") {
    return "production";
  }
  return "local";
}

function normalizeString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
