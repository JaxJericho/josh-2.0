import Link from "next/link";
import type { CSSProperties } from "react";

import { listAdminUsers } from "../../../lib/admin-ops";
import { requireAdminRole } from "../../../lib/admin-auth";

type AdminUsersPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function AdminUsersPage(props: AdminUsersPageProps) {
  await requireAdminRole(["super_admin", "moderator", "ops"]);

  const query = readSearchParam(props.searchParams, "query");
  const page = Number(readSearchParam(props.searchParams, "page") ?? "1");
  const list = await listAdminUsers({ query, page });

  const hasPrev = list.page > 1;
  const hasNext = list.page * list.pageSize < list.total;

  return (
    <section style={{ display: "grid", gap: "1rem" }}>
      <h1 style={{ marginTop: 0 }}>Users</h1>

      <form method="get" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input
          type="text"
          name="query"
          defaultValue={query}
          placeholder="Search by phone or user_id"
          style={{ minWidth: 320 }}
        />
        <button type="submit">Search</button>
      </form>

      <p style={{ margin: 0, color: "#374151" }}>
        Showing {list.rows.length} of {list.total} users.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>User</th>
              <th style={thStyle}>Phone (masked)</th>
              <th style={thStyle}>State</th>
              <th style={thStyle}>Safety hold</th>
              <th style={thStyle}>Strikes</th>
              <th style={thStyle}>Created</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((row) => (
              <tr key={row.id}>
                <td style={tdStyle}>
                  <Link href={`/admin/users/${row.id}`}>
                    {row.first_name} {row.last_name}
                  </Link>
                  <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                    <code>{row.id}</code>
                  </div>
                </td>
                <td style={tdStyle}>{row.masked_phone}</td>
                <td style={tdStyle}>{row.state}</td>
                <td style={tdStyle}>{row.safety_hold ? "yes" : "no"}</td>
                <td style={tdStyle}>{row.strike_count}</td>
                <td style={tdStyle}>{formatDateTime(row.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        {hasPrev ? (
          <Link href={buildUsersHref({ query, page: list.page - 1 })}>Previous</Link>
        ) : (
          <span style={{ color: "#9ca3af" }}>Previous</span>
        )}
        <span>Page {list.page}</span>
        {hasNext ? (
          <Link href={buildUsersHref({ query, page: list.page + 1 })}>Next</Link>
        ) : (
          <span style={{ color: "#9ca3af" }}>Next</span>
        )}
      </div>
    </section>
  );
}

function readSearchParam(
  searchParams: Record<string, string | string[] | undefined> | undefined,
  key: string,
): string {
  const value = searchParams?.[key];
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function buildUsersHref(params: { query: string; page: number }): string {
  const url = new URL("https://admin.example.com/admin/users");
  if (params.query) {
    url.searchParams.set("query", params.query);
  }
  if (params.page > 1) {
    url.searchParams.set("page", String(params.page));
  }
  return `${url.pathname}${url.search}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return date.toLocaleString();
}

const thStyle: CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid #e5e7eb",
  padding: "0.5rem",
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  borderBottom: "1px solid #f3f4f6",
  padding: "0.5rem",
  verticalAlign: "top",
};
