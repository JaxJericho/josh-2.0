import { describe, expect, it } from "vitest";
import { resolveAdminAuthContext } from "../../supabase/functions/_shared/entitlements/admin-auth";
import { AdminSetEntitlementsError } from "../../supabase/functions/_shared/entitlements/admin-set-entitlements";

describe("admin-set-entitlements auth", () => {
  it("returns unauthorized when neither bearer token nor admin secret is present", () => {
    const run = () =>
      resolveAdminAuthContext({
        authorizationHeader: null,
        adminSecretHeader: null,
        configuredAdminOpsSecret: "configured-secret",
        parseUserIdFromJwt: () => null,
      });

    expect(run).toThrowError(AdminSetEntitlementsError);
    try {
      run();
      throw new Error("Expected unauthorized error.");
    } catch (error) {
      const authError = error as AdminSetEntitlementsError;
      expect(authError.status).toBe(401);
      expect(authError.code).toBe("UNAUTHORIZED");
    }
  });

  it("returns unauthorized when x-admin-secret is wrong", () => {
    const run = () =>
      resolveAdminAuthContext({
        authorizationHeader: null,
        adminSecretHeader: "wrong-secret",
        configuredAdminOpsSecret: "correct-secret",
        parseUserIdFromJwt: () => null,
      });

    expect(run).toThrowError(AdminSetEntitlementsError);
    try {
      run();
      throw new Error("Expected unauthorized error.");
    } catch (error) {
      const authError = error as AdminSetEntitlementsError;
      expect(authError.status).toBe(401);
      expect(authError.code).toBe("UNAUTHORIZED");
    }
  });

  it("authorizes with x-admin-secret and resolves status 200 ok:true", () => {
    const result = resolveAdminAuthContext({
      authorizationHeader: null,
      adminSecretHeader: "correct-secret",
      configuredAdminOpsSecret: "correct-secret",
      parseUserIdFromJwt: () => null,
    });

    expect(result).toEqual({
      ok: true,
      status: 200,
      mode: "secret",
    });
  });

  it("fails fast with 500 when x-admin-secret is supplied but ADMIN_OPS_SECRET is unset", () => {
    const run = () =>
      resolveAdminAuthContext({
        authorizationHeader: null,
        adminSecretHeader: "some-secret",
        configuredAdminOpsSecret: null,
        parseUserIdFromJwt: () => null,
      });

    expect(run).toThrowError(AdminSetEntitlementsError);
    try {
      run();
      throw new Error("Expected missing env error.");
    } catch (error) {
      const authError = error as AdminSetEntitlementsError;
      expect(authError.status).toBe(500);
      expect(authError.code).toBe("MISSING_ENV");
      expect(authError.message).toContain("ADMIN_OPS_SECRET");
    }
  });
});
