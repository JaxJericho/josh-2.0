import Link from "next/link";
import type { CSSProperties } from "react";

import { listAdminSafetyOverview } from "../../../lib/admin-ops";
import { requireAdminRole } from "../../../lib/admin-auth";

type AdminSafetyPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function AdminSafetyPage(props: AdminSafetyPageProps) {
  await requireAdminRole(["super_admin", "moderator"]);

  const holdOnly = readSearchParam(props.searchParams, "hold_only") === "true";
  const page = Number(readSearchParam(props.searchParams, "page") ?? "1");

  const overview = await listAdminSafetyOverview({ holdOnly, page });
  const hasPrev = overview.page > 1;
  const hasNext = overview.page * overview.pageSize < overview.total;

  return (
    <section style={{ display: "grid", gap: "1rem" }}>
      <h1 style={{ marginTop: 0 }}>Safety View</h1>

      <form method="get" style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
          <input type="checkbox" name="hold_only" value="true" defaultChecked={holdOnly} />
          Holds only
        </label>
        <button type="submit">Apply</button>
      </form>

      <section style={cardStyle}>
        <h2 style={h2Style}>User Safety State</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>User</th>
              <th style={thStyle}>Hold</th>
              <th style={thStyle}>Strikes</th>
              <th style={thStyle}>Last strike</th>
              <th style={thStyle}>Last safety event</th>
            </tr>
          </thead>
          <tbody>
            {overview.state_rows.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={5}>No safety state rows found.</td>
              </tr>
            ) : (
              overview.state_rows.map((row) => (
                <tr key={row.user_id}>
                  <td style={tdStyle}>
                    <Link href={`/admin/users/${row.user_id}`}>
                      {row.user ? `${row.user.first_name} ${row.user.last_name}` : row.user_id}
                    </Link>
                    <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>{row.user?.masked_phone ?? "hidden"}</div>
                  </td>
                  <td style={tdStyle}>{row.safety_hold ? "enabled" : "disabled"}</td>
                  <td style={tdStyle}>{row.strike_count}</td>
                  <td style={tdStyle}>{row.last_strike_at ? formatDateTime(row.last_strike_at) : "none"}</td>
                  <td style={tdStyle}>{row.last_safety_event_at ? formatDateTime(row.last_safety_event_at) : "none"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {hasPrev ? (
            <Link href={buildSafetyHref({ holdOnly, page: overview.page - 1 })}>Previous</Link>
          ) : (
            <span style={{ color: "#9ca3af" }}>Previous</span>
          )}
          <span>Page {overview.page}</span>
          {hasNext ? (
            <Link href={buildSafetyHref({ holdOnly, page: overview.page + 1 })}>Next</Link>
          ) : (
            <span style={{ color: "#9ca3af" }}>Next</span>
          )}
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>Recent Strike History</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>User</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Points</th>
              <th style={thStyle}>Reason</th>
              <th style={thStyle}>Created</th>
            </tr>
          </thead>
          <tbody>
            {overview.strikes.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={5}>No strike rows.</td>
              </tr>
            ) : (
              overview.strikes.map((row) => (
                <tr key={row.id}>
                  <td style={tdStyle}>
                    <Link href={`/admin/users/${row.user_id}`}>
                      {row.user ? `${row.user.first_name} ${row.user.last_name}` : row.user_id}
                    </Link>
                  </td>
                  <td style={tdStyle}>{row.strike_type}</td>
                  <td style={tdStyle}>{row.points}</td>
                  <td style={tdStyle}>{row.reason ?? "n/a"}</td>
                  <td style={tdStyle}>{formatDateTime(row.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>Recent Safety Events</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>User</th>
              <th style={thStyle}>Severity</th>
              <th style={thStyle}>Action</th>
              <th style={thStyle}>Created</th>
            </tr>
          </thead>
          <tbody>
            {overview.safety_events.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={4}>No safety events.</td>
              </tr>
            ) : (
              overview.safety_events.map((row) => (
                <tr key={row.id}>
                  <td style={tdStyle}>
                    {row.user_id ? (
                      <Link href={`/admin/users/${row.user_id}`}>
                        {row.user ? `${row.user.first_name} ${row.user.last_name}` : row.user_id}
                      </Link>
                    ) : (
                      "n/a"
                    )}
                  </td>
                  <td style={tdStyle}>{row.severity ?? "n/a"}</td>
                  <td style={tdStyle}>{row.action_taken}</td>
                  <td style={tdStyle}>{formatDateTime(row.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
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

function buildSafetyHref(params: { holdOnly: boolean; page: number }): string {
  const url = new URL("https://admin.example.com/admin/safety");
  if (params.holdOnly) {
    url.searchParams.set("hold_only", "true");
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

const cardStyle: CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: "0.4rem",
  padding: "0.9rem",
  display: "grid",
  gap: "0.5rem",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const h2Style: CSSProperties = {
  margin: 0,
  fontSize: "1.05rem",
};

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
