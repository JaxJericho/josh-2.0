"use client";

import { useState, type FormEvent } from "react";

type SafetyHoldFormProps = {
  userId: string;
  safetyHold: boolean;
};

export function SafetyHoldForm(props: SafetyHoldFormProps) {
  const [safetyHold, setSafetyHold] = useState(props.safetyHold);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const submitToggle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setResult(null);

    try {
      const csrfToken = readCookie("josh_admin_csrf");
      const response = await fetch("/api/admin/users/safety-hold", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json",
          "x-admin-csrf-token": csrfToken,
        },
        credentials: "include",
        body: JSON.stringify({
          user_id: props.userId,
          safety_hold: safetyHold,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setResult(payload?.message ?? "Safety hold update failed.");
        setPending(false);
        return;
      }

      setResult("Safety hold updated. Reloading...");
      window.setTimeout(() => window.location.reload(), 500);
    } catch {
      setResult("Safety hold update failed.");
      setPending(false);
    }
  };

  return (
    <form onSubmit={submitToggle} style={{ display: "grid", gap: "0.6rem", maxWidth: 360 }}>
      <label style={{ display: "grid", gap: "0.3rem" }}>
        Safety hold
        <select
          value={safetyHold ? "true" : "false"}
          onChange={(event) => setSafetyHold(event.target.value === "true")}
          disabled={pending}
        >
          <option value="true">Enabled</option>
          <option value="false">Disabled</option>
        </select>
      </label>

      <button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Update safety hold"}
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
