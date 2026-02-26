import { notFound } from "next/navigation";
import type { CSSProperties } from "react";

import { getAdminLinkupDetail } from "../../../../lib/admin-ops";
import { requireAdminRole } from "../../../../lib/admin-auth";

type AdminLinkupDetailPageProps = {
  params: {
    id: string;
  };
};

export default async function AdminLinkupDetailPage(props: AdminLinkupDetailPageProps) {
  await requireAdminRole(["super_admin", "moderator", "ops"]);

  const detail = await getAdminLinkupDetail(props.params.id);
  if (!detail.linkup) {
    notFound();
  }

  return (
    <section style={{ display: "grid", gap: "1.25rem" }}>
      <header>
        <h1 style={{ marginBottom: "0.25rem" }}>LinkUp Detail</h1>
        <p style={{ marginTop: 0, color: "#4b5563" }}>
          <code>{detail.linkup.id}</code> · {detail.linkup.state} · region {detail.linkup.region_id}
        </p>
      </header>

      <section style={cardStyle}>
        <h2 style={h2Style}>Summary</h2>
        <p style={pStyle}>Scheduled: {detail.linkup.scheduled_at ? formatDateTime(detail.linkup.scheduled_at) : "n/a"}</p>
        <p style={pStyle}>Event time: {detail.linkup.event_time ? formatDateTime(detail.linkup.event_time) : "n/a"}</p>
        <p style={pStyle}>
          Size: {detail.linkup.min_size} - {detail.linkup.max_size}
        </p>
        <p style={pStyle}>Updated: {formatDateTime(detail.linkup.updated_at)}</p>
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>Participants</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>User</th>
              <th style={thStyle}>Phone (masked)</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Attendance</th>
              <th style={thStyle}>Do again</th>
              <th style={thStyle}>Exchange status</th>
            </tr>
          </thead>
          <tbody>
            {detail.participants.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={6}>No participants.</td>
              </tr>
            ) : (
              detail.participants.map((participant) => (
                <tr key={participant.user_id}>
                  <td style={tdStyle}>
                    {participant.first_name} {participant.last_name}
                    <div style={{ color: "#6b7280", fontSize: "0.8rem" }}>
                      <code>{participant.user_id}</code>
                    </div>
                  </td>
                  <td style={tdStyle}>{participant.masked_phone}</td>
                  <td style={tdStyle}>{participant.status}</td>
                  <td style={tdStyle}>{participant.attendance_response ?? "n/a"}</td>
                  <td style={tdStyle}>{participant.do_again === null ? "n/a" : participant.do_again ? "yes" : "no"}</td>
                  <td style={tdStyle}>{participant.exchange_status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>Contact Exchanges</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Pair</th>
              <th style={thStyle}>Revealed</th>
              <th style={thStyle}>Blocked by safety</th>
              <th style={thStyle}>Created</th>
            </tr>
          </thead>
          <tbody>
            {detail.exchanges.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={4}>No mutual exchanges.</td>
              </tr>
            ) : (
              detail.exchanges.map((exchange) => (
                <tr key={exchange.id}>
                  <td style={tdStyle}>
                    {exchange.user_a ? `${exchange.user_a.first_name} ${exchange.user_a.last_name}` : exchange.user_a_id}
                    {" ↔ "}
                    {exchange.user_b ? `${exchange.user_b.first_name} ${exchange.user_b.last_name}` : exchange.user_b_id}
                  </td>
                  <td style={tdStyle}>{formatDateTime(exchange.revealed_at)}</td>
                  <td style={tdStyle}>{exchange.blocked_by_safety ? "yes" : "no"}</td>
                  <td style={tdStyle}>{formatDateTime(exchange.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>Learning Signals</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>User</th>
              <th style={thStyle}>Signal type</th>
              <th style={thStyle}>Occurred</th>
              <th style={thStyle}>Value</th>
            </tr>
          </thead>
          <tbody>
            {detail.learning_signals.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={4}>No learning signals for this linkup.</td>
              </tr>
            ) : (
              detail.learning_signals.map((signal) => (
                <tr key={signal.id}>
                  <td style={tdStyle}>
                    <code>{signal.user_id}</code>
                  </td>
                  <td style={tdStyle}>{signal.signal_type}</td>
                  <td style={tdStyle}>{formatDateTime(signal.occurred_at)}</td>
                  <td style={tdStyle}>{formatSignalValue(signal)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>Conversation Sessions</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Session</th>
              <th style={thStyle}>User</th>
              <th style={thStyle}>Mode</th>
              <th style={thStyle}>State token</th>
              <th style={thStyle}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {detail.conversation_sessions.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={5}>No linked sessions.</td>
              </tr>
            ) : (
              detail.conversation_sessions.map((session) => (
                <tr key={session.id}>
                  <td style={tdStyle}>
                    <code>{session.id}</code>
                  </td>
                  <td style={tdStyle}>
                    <code>{session.user_id}</code>
                  </td>
                  <td style={tdStyle}>{session.mode}</td>
                  <td style={tdStyle}>{session.state_token}</td>
                  <td style={tdStyle}>{formatDateTime(session.updated_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </section>
  );
}

function formatSignalValue(signal: {
  value_bool: boolean | null;
  value_num: number | null;
  value_text: string | null;
}): string {
  if (typeof signal.value_text === "string" && signal.value_text) {
    return signal.value_text;
  }
  if (typeof signal.value_num === "number") {
    return String(signal.value_num);
  }
  if (typeof signal.value_bool === "boolean") {
    return signal.value_bool ? "true" : "false";
  }
  return "n/a";
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

const pStyle: CSSProperties = {
  margin: 0,
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
