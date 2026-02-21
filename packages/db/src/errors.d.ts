export type DbErrorCode =
  | "DB_MISSING_ENV"
  | "DB_INVALID_ENV"
  | "DB_CLIENT_INIT_FAILED"
  | "DB_QUERY_FAILED"
  | "DB_UNEXPECTED_RESPONSE"
  | "DB_MIGRATION_FAILED";

export declare const DB_ERROR_CODES: {
  readonly MISSING_ENV: "DB_MISSING_ENV";
  readonly INVALID_ENV: "DB_INVALID_ENV";
  readonly CLIENT_INIT_FAILED: "DB_CLIENT_INIT_FAILED";
  readonly QUERY_FAILED: "DB_QUERY_FAILED";
  readonly UNEXPECTED_RESPONSE: "DB_UNEXPECTED_RESPONSE";
  readonly MIGRATION_FAILED: "DB_MIGRATION_FAILED";
};

export declare function sanitizeForError(value: unknown): unknown;

export declare class DbError extends Error {
  code: DbErrorCode;
  status: number;
  context: unknown;

  constructor(
    code: DbErrorCode,
    message: string,
    options?: {
      status?: number;
      context?: unknown;
      cause?: unknown;
    },
  );

  toJSON(): {
    name: string;
    code: DbErrorCode;
    message: string;
    status: number;
    context: unknown;
  };

  static fromUnknown(params: {
    code: DbErrorCode;
    message: string;
    error: unknown;
    status?: number;
    context?: unknown;
  }): DbError;
}

export declare function assertRequiredEnv(name: string, value: string | undefined | null): string;
