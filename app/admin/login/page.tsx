const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "Invalid email or password.",
  forbidden: "Your account is not authorized for admin access.",
  session_expired: "Your admin session expired. Please sign in again.",
  internal_error: "Unable to complete sign-in.",
};

type LoginPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default function AdminLoginPage(props: LoginPageProps) {
  const rawError = props.searchParams?.error;
  const errorKey = Array.isArray(rawError) ? rawError[0] : rawError;
  const errorMessage = errorKey ? ERROR_MESSAGES[errorKey] ?? "Admin login failed." : null;

  return (
    <main style={{ maxWidth: 420, margin: "4rem auto", padding: "1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginBottom: "0.5rem" }}>Admin Login</h1>
      <p style={{ marginTop: 0, color: "#4b5563" }}>Sign in with your admin email and password.</p>

      {errorMessage ? (
        <p style={{ color: "#b91c1c", marginTop: "1rem" }} role="alert">
          {errorMessage}
        </p>
      ) : null}

      <form action="/api/admin/auth/login" method="post" style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
        <input type="hidden" name="redirect_to" value="/admin" />
        <label>
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            style={{ display: "block", width: "100%", marginTop: "0.25rem", padding: "0.5rem" }}
          />
        </label>

        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            style={{ display: "block", width: "100%", marginTop: "0.25rem", padding: "0.5rem" }}
          />
        </label>

        <button type="submit" style={{ padding: "0.6rem 0.8rem" }}>
          Sign in
        </button>
      </form>
    </main>
  );
}
