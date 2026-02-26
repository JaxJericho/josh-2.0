import type { CSSProperties } from "react";
import { getSupabaseServiceRoleClient } from "../lib/supabase-service-role";
import {
  listUserLinkupExchangeStatuses,
  type ExchangeDashboardStatus,
} from "../lib/contact-exchange-status";

type DashboardPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

const STATUS_LABEL: Record<ExchangeDashboardStatus, string> = {
  pending: "Pending",
  mutual_revealed: "Mutual Revealed",
  declined: "Declined",
  blocked_by_safety: "Blocked by Safety",
};

const STATUS_COLOR: Record<ExchangeDashboardStatus, string> = {
  pending: "#0f766e",
  mutual_revealed: "#14532d",
  declined: "#9a3412",
  blocked_by_safety: "#991b1b",
};

export default async function DashboardPage(props: DashboardPageProps) {
  const userId = normalizeQueryParam(props.searchParams?.userId);

  if (!userId) {
    return (
      <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "58rem" }}>
        <h1 style={{ marginBottom: "0.5rem" }}>Dashboard</h1>
        <p style={{ marginTop: 0 }}>
          Provide <code>userId</code> in the query string to view contact exchange status.
        </p>
      </main>
    );
  }

  const statuses = await listUserLinkupExchangeStatuses({
    db: getSupabaseServiceRoleClient(),
    userId,
  });

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "58rem" }}>
      <h1 style={{ marginBottom: "0.5rem" }}>Dashboard</h1>
      <p style={{ marginTop: 0, color: "#334155" }}>
        Contact exchange status for user <code>{userId}</code>
      </p>
      {statuses.length === 0 ? (
        <p>No LinkUp exchange outcomes found.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
          <thead>
            <tr>
              <th style={headerCellStyle}>LinkUp</th>
              <th style={headerCellStyle}>Exchange Opt-In</th>
              <th style={headerCellStyle}>Revealed At</th>
              <th style={headerCellStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((row) => (
              <tr key={row.linkup_id}>
                <td style={bodyCellStyle}>
                  <code>{row.linkup_id}</code>
                </td>
                <td style={bodyCellStyle}>
                  {row.exchange_opt_in === null ? "later / unanswered" : row.exchange_opt_in ? "yes" : "no"}
                </td>
                <td style={bodyCellStyle}>{row.exchange_revealed_at ?? "-"}</td>
                <td style={bodyCellStyle}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "0.15rem 0.5rem",
                      borderRadius: "999px",
                      color: "white",
                      backgroundColor: STATUS_COLOR[row.status],
                      fontSize: "0.825rem",
                      fontWeight: 600,
                    }}
                  >
                    {STATUS_LABEL[row.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

function normalizeQueryParam(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0].trim();
  }

  return "";
}

const headerCellStyle: CSSProperties = {
  textAlign: "left",
  padding: "0.5rem",
  borderBottom: "1px solid #cbd5e1",
};

const bodyCellStyle: CSSProperties = {
  padding: "0.5rem",
  borderBottom: "1px solid #e2e8f0",
};
