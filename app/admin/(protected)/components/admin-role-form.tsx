"use client";

import { useState, type FormEvent } from "react";

type AdminRoleFormProps = {
  userId: string;
  currentRole: string | null;
};

const ADMIN_ROLE_OPTIONS = ["super_admin", "moderator", "ops"] as const;

export function AdminRoleForm(props: AdminRoleFormProps) {
  const [role, setRole] = useState(props.currentRole ?? "ops");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const submitRoleUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setResult(null);

    try {
      const csrfToken = readCookie("josh_admin_csrf");
      const response = await fetch("/api/admin/users/role", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json",
          "x-admin-csrf-token": csrfToken,
        },
        credentials: "include",
        body: JSON.stringify({
          user_id: props.userId,
          role,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setResult(payload?.message ?? "Role update failed.");
        setPending(false);
        return;
      }

      setResult("Role updated. Reloading...");
      window.setTimeout(() => window.location.reload(), 500);
    } catch {
      setResult("Role update failed.");
      setPending(false);
    }
  };

  return (
    <form onSubmit={submitRoleUpdate} style={{ display: "grid", gap: "0.6rem", maxWidth: 360 }}>
      <label style={{ display: "grid", gap: "0.3rem" }}>
        Role
        <select value={role} onChange={(event) => setRole(event.target.value)} disabled={pending}>
          {ADMIN_ROLE_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      <button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Update role"}
      </button>

      {result ? (
        <p style={{ margin: 0, color: "#1f2937" }} role="status">
          {result}
        </p>
      ) : null}
    </form>
  );
}

function readCookie(name: string): string {
  const key = `${name}=`;
  const cookie = document.cookie.split("; ").find((entry) => entry.startsWith(key));
  return cookie ? decodeURIComponent(cookie.slice(key.length)) : "";
}
