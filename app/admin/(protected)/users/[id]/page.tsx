import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";

import { AdminRoleForm } from "../../components/admin-role-form";
import { SafetyHoldForm } from "../../components/safety-hold-form";
import { getAdminUserDetail } from "../../../../lib/admin-ops";
import { requireAdminRole } from "../../../../lib/admin-auth";

type AdminUserDetailPageProps = {
  params: {
    id: string;
  };
};

export default async function AdminUserDetailPage(props: AdminUserDetailPageProps) {
  const admin = await requireAdminRole(["super_admin", "moderator", "ops"]);
  const detail = await getAdminUserDetail(props.params.id);

  if (!detail.user) {
    notFound();
  }

  return (
    <section style={{ display: "grid", gap: "1.25rem" }}>
      <header>
        <h1 style={{ marginBottom: "0.25rem" }}>
          {detail.user.first_name} {detail.user.last_name}
        </h1>
        <p style={{ marginTop: 0, color: "#4b5563" }}>
          <code>{detail.user.id}</code> · {detail.user.state} · Phone: {detail.user.phone_e164}
        </p>
      </header>

      <section style={cardStyle}>
        <h2 style={h2Style}>Account</h2>
        <p style={pStyle}>Region: {detail.user.region_id ?? "unassigned"}</p>
        <p style={pStyle}>Suspended at: {detail.user.suspended_at ? formatDateTime(detail.user.suspended_at) : "no"}</p>
        <p style={pStyle}>Created: {formatDateTime(detail.user.created_at)}</p>
        <p style={pStyle}>Admin role: {detail.admin_role ?? "none"}</p>
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>Profile</h2>
        {detail.profile ? (
          <>
            <p style={pStyle}>State: {detail.profile.state}</p>
            <p style={pStyle}>Completeness: {detail.profile.completeness_percent}%</p>
            <p style={pStyle}>MVP complete: {detail.profile.is_complete_mvp ? "yes" : "no"}</p>
            <p style={pStyle}>Last interview step: {detail.profile.last_interview_step ?? "none"}</p>
            <p style={pStyle}>Fingerprint: {stringifyJson(detail.profile.fingerprint)}</p>
            <p style={pStyle}>Activity patterns: {stringifyJson(detail.profile.activity_patterns)}</p>
          </>
        ) : (
          <p style={pStyle}>No profile record.</p>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>Safety State</h2>
        <p style={pStyle}>Safety hold: {detail.safety_state?.safety_hold ? "enabled" : "disabled"}</p>
        <p style={pStyle}>Strike count: {detail.safety_state?.strike_count ?? 0}</p>
        <p style={pStyle}>
          Last strike: {detail.safety_state?.last_strike_at ? formatDateTime(detail.safety_state.last_strike_at) : "none"}
        </p>
        <p style={pStyle}>
          Last safety event: {detail.safety_state?.last_safety_event_at
            ? formatDateTime(detail.safety_state.last_safety_event_at)
            : "none"}
        </p>
      </section>

      {(admin.role === "moderator" || admin.role === "super_admin") ? (
        <section style={cardStyle}>
          <h2 style={h2Style}>Safety Hold Action</h2>
          <SafetyHoldForm userId={detail.user.id} safetyHold={detail.safety_state?.safety_hold ?? false} />
        </section>
      ) : null}

      {admin.role === "super_admin" ? (
        <section style={cardStyle}>
          <h2 style={h2Style}>Role Action</h2>
          <AdminRoleForm userId={detail.user.id} currentRole={detail.admin_role} />
        </section>
      ) : null}

      <section style={cardStyle}>
        <h2 style={h2Style}>Active Session</h2>
        {detail.conversation_session ? (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Mode</th>
                <th style={thStyle}>State token</th>
                <th style={thStyle}>LinkUp</th>
                <th style={thStyle}>Updated</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={tdStyle}>{detail.conversation_session.mode}</td>
                <td style={tdStyle}>
                  <code>{detail.conversation_session.state_token}</code>
                </td>
                <td style={tdStyle}>
                  {detail.conversation_session.linkup_id ? (
                    <Link href={`/admin/linkups/${detail.conversation_session.linkup_id}`}>
                      {detail.conversation_session.linkup_id}
                    </Link>
                  ) : (
                    "none"
                  )}
                </td>
                <td style={tdStyle}>{formatDateTime(detail.conversation_session.updated_at)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p style={pStyle}>No active conversation session.</p>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>Conversation Events</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Event type</th>
              <th style={thStyle}>Step token</th>
              <th style={thStyle}>Created</th>
            </tr>
          </thead>
          <tbody>
            {detail.conversation_events.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={3}>No events.</td>
              </tr>
            ) : (
              detail.conversation_events.map((event) => (
                <tr key={event.id}>
                  <td style={tdStyle}>{event.event_type}</td>
                  <td style={tdStyle}>{event.step_token ?? "n/a"}</td>
                  <td style={tdStyle}>{formatDateTime(event.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>LinkUps</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>LinkUp</th>
              <th style={thStyle}>State</th>
              <th style={thStyle}>Participant status</th>
              <th style={thStyle}>Attendance</th>
              <th style={thStyle}>Do again</th>
              <th style={thStyle}>Exchange</th>
            </tr>
          </thead>
          <tbody>
            {detail.linkups.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={6}>No linkup records.</td>
              </tr>
            ) : (
              detail.linkups.map((row) => (
                <tr key={row.linkup_id}>
                  <td style={tdStyle}>
                    <Link href={`/admin/linkups/${row.linkup_id}`}>{row.linkup_id}</Link>
                  </td>
                  <td style={tdStyle}>{row.state}</td>
                  <td style={tdStyle}>{row.status}</td>
                  <td style={tdStyle}>{row.attendance_response ?? "n/a"}</td>
                  <td style={tdStyle}>{row.do_again === null ? "n/a" : row.do_again ? "yes" : "no"}</td>
                  <td style={tdStyle}>{row.exchange_status}</td>
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
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Occurred</th>
              <th style={thStyle}>Value</th>
            </tr>
          </thead>
          <tbody>
            {detail.learning_signals.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={3}>No learning signals.</td>
              </tr>
            ) : (
              detail.learning_signals.map((signal) => (
                <tr key={signal.id}>
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
        <h2 style={h2Style}>Blocks</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Blocker</th>
              <th style={thStyle}>Blocked</th>
              <th style={thStyle}>Created</th>
            </tr>
          </thead>
          <tbody>
            {detail.blocks.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={3}>No blocks.</td>
              </tr>
            ) : (
              detail.blocks.map((row) => (
                <tr key={row.id}>
                  <td style={tdStyle}>
                    <code>{row.blocker_user_id}</code>
                    <div>{row.blocker ? `${row.blocker.first_name} ${row.blocker.last_name}` : "Unknown"}</div>
                  </td>
                  <td style={tdStyle}>
                    <code>{row.blocked_user_id}</code>
                    <div>{row.blocked ? `${row.blocked.first_name} ${row.blocked.last_name}` : "Unknown"}</div>
                  </td>
                  <td style={tdStyle}>{formatDateTime(row.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section style={cardStyle}>
        <h2 style={h2Style}>Admin Audit History</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Action</th>
              <th style={thStyle}>Admin</th>
              <th style={thStyle}>Target</th>
              <th style={thStyle}>Metadata</th>
              <th style={thStyle}>Created</th>
            </tr>
          </thead>
          <tbody>
            {detail.admin_audit_history.length === 0 ? (
              <tr>
                <td style={tdStyle} colSpan={5}>No admin audit actions for this user.</td>
              </tr>
            ) : (
              detail.admin_audit_history.map((row) => (
                <tr key={row.id}>
                  <td style={tdStyle}>{row.action}</td>
                  <td style={tdStyle}>
                    <code>{row.admin_user_id}</code>
                  </td>
                  <td style={tdStyle}>
                    {row.target_type} · {row.target_id ?? "n/a"}
                  </td>
                  <td style={tdStyle}>{stringifyJson(row.metadata_json)}</td>
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

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
