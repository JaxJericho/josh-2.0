import Link from "next/link";

export default function AdminHomePage() {
  return (
    <section style={{ display: "grid", gap: "1rem" }}>
      <h1 style={{ marginTop: 0 }}>Admin Ops Dashboard</h1>
      <p>
        Ticket 12.2 operational views are available for user debugging, LinkUp inspection, moderation workflow,
        safety review, and contact exchange review.
      </p>

      <ul style={{ margin: 0, paddingLeft: "1.25rem", display: "grid", gap: "0.5rem" }}>
        <li>
          <Link href="/admin/users">Users</Link>
        </li>
        <li>
          <Link href="/admin/linkups">LinkUps</Link>
        </li>
        <li>
          <Link href="/admin/moderation">Moderation incidents</Link>
        </li>
        <li>
          <Link href="/admin/safety">Safety system</Link>
        </li>
        <li>
          <Link href="/admin/exchanges">Contact exchanges</Link>
        </li>
      </ul>
    </section>
  );
}
