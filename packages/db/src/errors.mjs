const SENSITIVE_KEY_PATTERN = /(token|secret|password|key|authorization|cookie|dsn|url)$/i;
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export const DB_ERROR_CODES = Object.freeze({
  MISSING_ENV: "DB_MISSING_ENV",
  INVALID_ENV: "DB_INVALID_ENV",
  CLIENT_INIT_FAILED: "DB_CLIENT_INIT_FAILED",
  QUERY_FAILED: "DB_QUERY_FAILED",
  UNEXPECTED_RESPONSE: "DB_UNEXPECTED_RESPONSE",
  MIGRATION_FAILED: "DB_MIGRATION_FAILED",
});

function sanitizeString(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (JWT_PATTERN.test(trimmed)) {
    return "[REDACTED]";
  }

  if (trimmed.startsWith("postgres://") || trimmed.startsWith("postgresql://")) {
    return "[REDACTED]";
  }

  if (trimmed.length > 256) {
    return `${trimmed.slice(0, 16)}...[REDACTED]`;
  }

  return trimmed;
}

function sanitizeObject(input) {
  const output = {};

  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = "[REDACTED]";
      continue;
    }

    output[key] = sanitizeForError(value);
  }

  return output;
}

export function sanitizeForError(value) {
  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForError(entry));
  }

  if (typeof value === "object") {
    return sanitizeObject(value);
  }

  return value;
}

export class DbError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "DbError";
    this.code = code;
    this.status = options.status ?? 500;
    this.context = sanitizeForError(options.context ?? null);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
      context: this.context,
    };
  }

  static fromUnknown(params) {
    if (params.error instanceof DbError) {
      return params.error;
    }

    return new DbError(params.code, params.message, {
      status: params.status,
      cause: params.error,
      context: params.context,
    });
  }
}

export function assertRequiredEnv(name, value) {
  if (!value || !String(value).trim()) {
    throw new DbError(DB_ERROR_CODES.MISSING_ENV, `Missing required env var: ${name}`, {
      status: 500,
      context: { env_var: name },
    });
  }

  return String(value).trim();
}
