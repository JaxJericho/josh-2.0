import { describe, expect, it } from "vitest";

import { createDbClient } from "../../packages/db/src/client-node.mjs";
import { DbError } from "../../packages/db/src/errors.mjs";

describe("packages/db client factory", () => {
  it("fails fast when SUPABASE_URL is missing", () => {
    expect(() =>
      createDbClient({
        role: "service",
        env: {
          SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        },
      }),
    ).toThrowError(DbError);

    try {
      createDbClient({
        role: "service",
        env: {
          SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        },
      });
    } catch (error) {
      const dbError = error as DbError;
      expect(dbError.code).toBe("DB_MISSING_ENV");
      expect(dbError.message).toBe("Missing required env var: SUPABASE_URL");
    }
  });

  it("fails fast when SUPABASE_SERVICE_ROLE_KEY is missing", () => {
    expect(() =>
      createDbClient({
        role: "service",
        env: {
          SUPABASE_URL: "https://example.supabase.co",
        },
      }),
    ).toThrowError("Missing required env var: SUPABASE_SERVICE_ROLE_KEY");
  });
});
