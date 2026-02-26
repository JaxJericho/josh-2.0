import { ModerationStatusForm } from "../components/moderation-status-form";
import type { CSSProperties } from "react";
import { listAdminModerationIncidents } from "../../../lib/admin-ops";
import { requireAdminRole } from "../../../lib/admin-auth";

type AdminModerationPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function AdminModerationPage(props: AdminModerationPageProps) {
  const admin = await requireAdminRole(["super_admin", "moderator"]);

  const status = readSearchParam(props.searchParams, "status");
  const page = Number(readSearchParam(props.searchParams, "page") ?? "1");
  const list = await listAdminModerationIncidents({ status, page });

  const hasPrev = list.page > 1;
  const hasNext = list.page * list.pageSize < list.total;

  return (
    <section style={{ display: "grid", gap: "1rem" }}>
      <h1 style={{ marginTop: 0 }}>Moderation Incidents</h1>

      <form method="get" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <label>
          Status
          <select name="status" defaultValue={status || "all"}>
            <option value="all">all</option>
            <option value="open">open</option>
            <option value="reviewed">reviewed</option>
            <option value="resolved">resolved</option>
          </select>
        </label>
        <button type="submit">Filter</button>
      </form>

      <p style={{ margin: 0, color: "#374151" }}>
        Showing {list.rows.length} of {list.total} incidents.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Incident</th>
              <th style={thStyle}>Reporter</th>
              <th style={thStyle}>Reported</th>
              <th style={thStyle}>Reason</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Created</th>
              <th style={thStyle}>Action</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={7}>No incidents found.</td>
              </tr>
            ) : (
              list.rows.map((row) => (
                <tr key={row.id}>
                  <td style={tdStyle}>
                    <code>{row.id}</code>
                    {row.linkup_id ? (
                      <div style={{ color: "#6b7280", fontSize: "0.8rem" }}>
                        LinkUp <code>{row.linkup_id}</code>
                      </div>
                    ) : null}
                  </td>
                  <td style={tdStyle}>
                    <div>{row.reporter ? `${row.reporter.first_name} ${row.reporter.last_name}` : row.reporter_user_id}</div>
                    <div style={{ color: "#6b7280", fontSize: "0.8rem" }}>{row.reporter?.masked_phone ?? "hidden"}</div>
                  </td>
                  <td style={tdStyle}>
                    <div>{row.reported ? `${row.reported.first_name} ${row.reported.last_name}` : row.reported_user_id}</div>
                    <div style={{ color: "#6b7280", fontSize: "0.8rem" }}>{row.reported?.masked_phone ?? "hidden"}</div>
                  </td>
                  <td style={tdStyle}>
                    <div>{row.reason_category}</div>
                    {row.free_text ? <div style={{ color: "#6b7280", fontSize: "0.8rem" }}>{row.free_text}</div> : null}
                  </td>
                  <td style={tdStyle}>{row.status}</td>
                  <td style={tdStyle}>{formatDateTime(row.created_at)}</td>
                  <td style={tdStyle}>
                    {(admin.role === "moderator" || admin.role === "super_admin") ? (
                      <ModerationStatusForm incidentId={row.id} currentStatus={row.status} />
                    ) : (
                      "n/a"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        {hasPrev ? (
          <a href={buildModerationHref({ status, page: list.page - 1 })}>Previous</a>
        ) : (
          <span style={{ color: "#9ca3af" }}>Previous</span>
        )}
        <span>Page {list.page}</span>
        {hasNext ? (
          <a href={buildModerationHref({ status, page: list.page + 1 })}>Next</a>
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

function buildModerationHref(params: { status: string; page: number }): string {
  const url = new URL("https://admin.example.com/admin/moderation");
  if (params.status && params.status !== "all") {
    url.searchParams.set("status", params.status);
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
