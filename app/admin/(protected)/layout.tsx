import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";

import { AdminAuthError, requireAdminRole } from "../../lib/admin-auth";

type AdminLayoutProps = {
  children: ReactNode;
};

export default async function AdminProtectedLayout(props: AdminLayoutProps) {
  try {
    const admin = await requireAdminRole(["super_admin", "moderator", "ops"]);
    const navItems = [
      { href: "/admin", label: "Overview" },
      { href: "/admin/users", label: "Users" },
      { href: "/admin/linkups", label: "LinkUps" },
      { href: "/admin/moderation", label: "Moderation" },
      { href: "/admin/safety", label: "Safety" },
      { href: "/admin/exchanges", label: "Exchanges" },
    ];

    return (
      <div style={{ fontFamily: "system-ui, sans-serif", minHeight: "100vh", background: "#f8fafc" }}>
        <header
          style={{
            padding: "1rem 1.5rem",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#ffffff",
          }}
        >
          <div>
            <strong>JOSH Admin</strong>
            <p style={{ margin: 0, color: "#4b5563", fontSize: "0.9rem" }}>
              Signed in as <code>{admin.userId}</code> ({admin.role})
            </p>
          </div>

          <form action="/api/admin/auth/logout" method="post">
            <button type="submit">Sign out</button>
          </form>
        </header>

        <nav style={{ padding: "0.75rem 1.5rem", borderBottom: "1px solid #e5e7eb", background: "#ffffff" }}>
          <ul style={{ margin: 0, padding: 0, display: "flex", listStyle: "none", gap: "1rem", flexWrap: "wrap" }}>
            {navItems.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <main style={{ padding: "1.5rem" }}>{props.children}</main>
      </div>
    );
  } catch (error) {
    if (error instanceof AdminAuthError) {
      if (error.status === 401) {
        redirect("/admin/login?error=session_expired");
      }

      if (error.status === 403) {
        return (
          <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
            <h1>Forbidden</h1>
            <p>Your account is authenticated but does not have admin access.</p>
          </main>
        );
      }
    }

    throw error;
  }
}
