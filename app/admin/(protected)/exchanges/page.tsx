import Link from "next/link";
import type { CSSProperties } from "react";

import { listAdminContactExchanges } from "../../../lib/admin-ops";
import { requireAdminRole } from "../../../lib/admin-auth";

type AdminExchangesPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function AdminExchangesPage(props: AdminExchangesPageProps) {
  await requireAdminRole(["super_admin", "moderator", "ops"]);

  const blockedOnly = readSearchParam(props.searchParams, "blocked_only") === "true";
  const page = Number(readSearchParam(props.searchParams, "page") ?? "1");
  const list = await listAdminContactExchanges({ blockedBySafetyOnly: blockedOnly, page });

  const hasPrev = list.page > 1;
  const hasNext = list.page * list.pageSize < list.total;

  return (
    <section style={{ display: "grid", gap: "1rem" }}>
      <h1 style={{ marginTop: 0 }}>Contact Exchanges</h1>

      <form method="get" style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
          <input type="checkbox" name="blocked_only" value="true" defaultChecked={blockedOnly} />
          Blocked by safety only
        </label>
        <button type="submit">Apply</button>
      </form>

      <p style={{ margin: 0, color: "#374151" }}>
        Showing {list.rows.length} of {list.total} exchanges.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>LinkUp</th>
              <th style={thStyle}>User A</th>
              <th style={thStyle}>User B</th>
              <th style={thStyle}>Revealed</th>
              <th style={thStyle}>Blocked by safety</th>
              <th style={thStyle}>Created</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={6}>No exchanges found.</td>
              </tr>
            ) : (
              list.rows.map((row) => (
                <tr key={row.id}>
                  <td style={tdStyle}>
                    <Link href={`/admin/linkups/${row.linkup_id}`}>
                      <code>{row.linkup_id}</code>
                    </Link>
                  </td>
                  <td style={tdStyle}>
                    <Link href={`/admin/users/${row.user_a_id}`}>
                      {row.user_a ? `${row.user_a.first_name} ${row.user_a.last_name}` : row.user_a_id}
                    </Link>
                    <div style={{ color: "#6b7280", fontSize: "0.8rem" }}>{row.user_a?.masked_phone ?? "hidden"}</div>
                  </td>
                  <td style={tdStyle}>
                    <Link href={`/admin/users/${row.user_b_id}`}>
                      {row.user_b ? `${row.user_b.first_name} ${row.user_b.last_name}` : row.user_b_id}
                    </Link>
                    <div style={{ color: "#6b7280", fontSize: "0.8rem" }}>{row.user_b?.masked_phone ?? "hidden"}</div>
                  </td>
                  <td style={tdStyle}>{formatDateTime(row.revealed_at)}</td>
                  <td style={tdStyle}>{row.blocked_by_safety ? "yes" : "no"}</td>
                  <td style={tdStyle}>{formatDateTime(row.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        {hasPrev ? (
          <Link href={buildExchangeHref({ blockedOnly, page: list.page - 1 })}>Previous</Link>
        ) : (
          <span style={{ color: "#9ca3af" }}>Previous</span>
        )}
        <span>Page {list.page}</span>
        {hasNext ? (
          <Link href={buildExchangeHref({ blockedOnly, page: list.page + 1 })}>Next</Link>
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

function buildExchangeHref(params: { blockedOnly: boolean; page: number }): string {
  const url = new URL("https://admin.example.com/admin/exchanges");
  if (params.blockedOnly) {
    url.searchParams.set("blocked_only", "true");
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
