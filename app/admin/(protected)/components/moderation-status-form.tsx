"use client";

import { useState, type FormEvent } from "react";

type ModerationStatusFormProps = {
  incidentId: string;
  currentStatus: string;
};

const STATUS_OPTIONS = ["open", "reviewed", "resolved"] as const;

export function ModerationStatusForm(props: ModerationStatusFormProps) {
  const [status, setStatus] = useState(props.currentStatus);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const submitStatus = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setResult(null);

    try {
      const csrfToken = readCookie("josh_admin_csrf");
      const response = await fetch("/api/admin/moderation/status", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json",
          "x-admin-csrf-token": csrfToken,
        },
        credentials: "include",
        body: JSON.stringify({
          incident_id: props.incidentId,
          status,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setResult(payload?.message ?? "Status update failed.");
        setPending(false);
        return;
      }

      setResult("Status updated. Reloading...");
      window.setTimeout(() => window.location.reload(), 500);
    } catch {
      setResult("Status update failed.");
      setPending(false);
    }
  };

  return (
    <form onSubmit={submitStatus} style={{ display: "grid", gap: "0.3rem", minWidth: 180 }}>
      <select value={status} onChange={(event) => setStatus(event.target.value)} disabled={pending}>
        {STATUS_OPTIONS.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Update"}
      </button>
      {result ? (
        <span style={{ fontSize: "0.8rem", color: "#1f2937" }} role="status">
          {result}
        </span>
      ) : null}
    </form>
  );
}

function readCookie(name: string): string {
  const key = `${name}=`;
  const cookie = document.cookie.split("; ").find((entry) => entry.startsWith(key));
  return cookie ? decodeURIComponent(cookie.slice(key.length)) : "";
}
