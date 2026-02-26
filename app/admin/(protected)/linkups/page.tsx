import Link from "next/link";
import type { CSSProperties } from "react";

import { listAdminLinkups } from "../../../lib/admin-ops";
import { requireAdminRole } from "../../../lib/admin-auth";

type AdminLinkupsPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function AdminLinkupsPage(props: AdminLinkupsPageProps) {
  await requireAdminRole(["super_admin", "moderator", "ops"]);

  const state = readSearchParam(props.searchParams, "state");
  const dateFrom = readSearchParam(props.searchParams, "date_from");
  const dateTo = readSearchParam(props.searchParams, "date_to");
  const page = Number(readSearchParam(props.searchParams, "page") ?? "1");

  const list = await listAdminLinkups({ state, dateFrom, dateTo, page });
  const hasPrev = list.page > 1;
  const hasNext = list.page * list.pageSize < list.total;

  return (
    <section style={{ display: "grid", gap: "1rem" }}>
      <h1 style={{ marginTop: 0 }}>LinkUps</h1>

      <form method="get" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <label>
          State
          <select name="state" defaultValue={state || "all"}>
            <option value="all">all</option>
            <option value="draft">draft</option>
            <option value="broadcasting">broadcasting</option>
            <option value="locked">locked</option>
            <option value="completed">completed</option>
            <option value="expired">expired</option>
            <option value="canceled">canceled</option>
          </select>
        </label>
        <label>
          Date from
          <input type="date" name="date_from" defaultValue={dateFrom} />
        </label>
        <label>
          Date to
          <input type="date" name="date_to" defaultValue={dateTo} />
        </label>
        <button type="submit">Apply</button>
      </form>

      <p style={{ margin: 0, color: "#374151" }}>
        Showing {list.rows.length} of {list.total} linkups.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>LinkUp</th>
              <th style={thStyle}>State</th>
              <th style={thStyle}>Region</th>
              <th style={thStyle}>Event time</th>
              <th style={thStyle}>Participants</th>
              <th style={thStyle}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((row) => (
              <tr key={row.id}>
                <td style={tdStyle}>
                  <Link href={`/admin/linkups/${row.id}`}>
                    <code>{row.id}</code>
                  </Link>
                </td>
                <td style={tdStyle}>{row.state}</td>
                <td style={tdStyle}>{row.region_id}</td>
                <td style={tdStyle}>{row.event_time ? formatDateTime(row.event_time) : "n/a"}</td>
                <td style={tdStyle}>{row.participant_count}</td>
                <td style={tdStyle}>{formatDateTime(row.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        {hasPrev ? (
          <Link href={buildLinkupHref({ state, dateFrom, dateTo, page: list.page - 1 })}>Previous</Link>
        ) : (
          <span style={{ color: "#9ca3af" }}>Previous</span>
        )}
        <span>Page {list.page}</span>
        {hasNext ? (
          <Link href={buildLinkupHref({ state, dateFrom, dateTo, page: list.page + 1 })}>Next</Link>
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

function buildLinkupHref(params: {
  state: string;
  dateFrom: string;
  dateTo: string;
  page: number;
}): string {
  const url = new URL("https://admin.example.com/admin/linkups");
  if (params.state && params.state !== "all") {
    url.searchParams.set("state", params.state);
  }
  if (params.dateFrom) {
    url.searchParams.set("date_from", params.dateFrom);
  }
  if (params.dateTo) {
    url.searchParams.set("date_to", params.dateTo);
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
