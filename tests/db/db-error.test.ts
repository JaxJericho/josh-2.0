import { describe, expect, it } from "vitest";

import { DB_ERROR_CODES, DbError } from "../../packages/db/src/errors.mjs";

describe("DbError", () => {
  it("serializes with safe redaction", () => {
    const error = new DbError(DB_ERROR_CODES.QUERY_FAILED, "query failed", {
      status: 500,
      context: {
        supabase_url: "https://example.supabase.co",
        service_role_key: "super-secret-key",
        authorization: "Bearer secret-token",
        nested: {
          token: "nested-token",
          ok: "value",
        },
      },
    });

    expect(error.toJSON()).toEqual({
      name: "DbError",
      code: "DB_QUERY_FAILED",
      message: "query failed",
      status: 500,
      context: {
        supabase_url: "[REDACTED]",
        service_role_key: "[REDACTED]",
        authorization: "[REDACTED]",
        nested: {
          token: "[REDACTED]",
          ok: "value",
        },
      },
    });
  });

  it("wraps unknown errors with stable code", () => {
    const wrapped = DbError.fromUnknown({
      code: DB_ERROR_CODES.CLIENT_INIT_FAILED,
      message: "client init failed",
      error: new Error("boom"),
      context: {
        secret: "should-not-leak",
      },
    });

    expect(wrapped).toBeInstanceOf(DbError);
    expect(wrapped.code).toBe("DB_CLIENT_INIT_FAILED");
    expect(wrapped.toJSON().context).toEqual({
      secret: "[REDACTED]",
    });
  });
});
