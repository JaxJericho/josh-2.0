import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = "supabase/migrations/20260227001500_ticket_12_1_admin_auth_rbac.sql";

describe("admin RLS migration coverage", () => {
  const migrationSql = readFileSync(MIGRATION_PATH, "utf8");

  it("creates admin_audit_log table and append-only mutation trigger", () => {
    expect(migrationSql).toContain("create table if not exists public.admin_audit_log");
    expect(migrationSql).toContain("create trigger admin_audit_log_prevent_update");
    expect(migrationSql).toContain("create trigger admin_audit_log_prevent_delete");
  });

  it("enforces super_admin-only admin_users writes", () => {
    expect(migrationSql).toContain("create policy admin_users_insert_super_admin");
    expect(migrationSql).toContain("create policy admin_users_update_super_admin");
    expect(migrationSql).toContain("public.has_admin_role(array['super_admin'::public.admin_role])");
  });

  it("enforces own-log and super-admin read policies on admin_audit_log", () => {
    expect(migrationSql).toContain("create policy admin_audit_log_select_own");
    expect(migrationSql).toContain("create policy admin_audit_log_select_all_super_admin");
    expect(migrationSql).toContain("create policy admin_audit_log_insert_self");
  });
});
