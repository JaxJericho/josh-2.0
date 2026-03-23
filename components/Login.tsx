"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface LoginProps {
  onSuccess?: () => void;
}

export function Login({ onSuccess: _onSuccess }: LoginProps = {}) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [countryCode, setCountryCode] = useState("+1");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [showError, setShowError] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendLabel, setResendLabel] = useState("Didn't get it? Send again.");

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitted(true);
    setShowError(false);
  };

  const handleResend = () => {
    if (resendCooldown > 0) return;
    setResendLabel("Sent.");
    setResendCooldown(30);
    setTimeout(() => setResendLabel("Didn't get it? Send again."), 3000);
  };

  const handleStartOver = () => {
    setPhoneNumber("");
    setIsSubmitted(false);
    setShowError(false);
    setResendCooldown(0);
  };

  const isFormValid = phoneNumber.trim();

  return (
    <div
      style={{
        background: "var(--surface-landing)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Navigation */}
      <nav
        style={{
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--surface-card)",
          padding: "var(--space-4) var(--space-6)",
        }}
      >
        <div style={{ maxWidth: "1440px", margin: "0 auto" }}>
          <Link
            href="/"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--type-display-sm)",
              color: "var(--text-primary)",
              fontWeight: "500",
              textDecoration: "none",
            }}
          >
            JOSH
          </Link>
        </div>
      </nav>

      {/* Main Content — Vertically Centered */}
      <main
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-5)",
        }}
      >
        <div style={{ maxWidth: "420px", width: "100%" }}>
          {!isSubmitted ? (
            <div>
              {/* Header */}
              <header
                style={{ marginBottom: "var(--space-6)", textAlign: "center" }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--type-ui-label)",
                    letterSpacing: "var(--tracking-ui-label)",
                    textTransform: "lowercase",
                    color: "var(--text-secondary)",
                    marginBottom: "var(--space-4)",
                  }}
                >
                  welcome back
                </div>
                <h1
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "var(--type-display-lg)",
                    lineHeight: "1.3",
                    color: "var(--text-primary)",
                    margin: 0,
                  }}
                >
                  What&apos;s your number?
                </h1>
              </header>

              {/* Form */}
              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: "var(--space-2)" }}>
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <select
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "var(--type-body-md)",
                        color: "var(--text-primary)",
                        background: "var(--surface-card)",
                        border: `1px solid ${showError ? "#C84C3C" : "var(--border-default)"}`,
                        borderRadius: "var(--radius-input)",
                        padding: "var(--space-3)",
                        outline: "none",
                        cursor: "pointer",
                        minWidth: "80px",
                      }}
                    >
                      <option value="+1">+1</option>
                      <option value="+44">+44</option>
                      <option value="+61">+61</option>
                      <option value="+81">+81</option>
                      <option value="+86">+86</option>
                    </select>
                    <input
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => {
                        setPhoneNumber(e.target.value);
                        setShowError(false);
                      }}
                      placeholder="Your mobile number"
                      required
                      autoFocus
                      style={{
                        flex: 1,
                        fontFamily: "var(--font-ui)",
                        fontSize: "var(--type-body-md)",
                        color: "var(--text-primary)",
                        background: "var(--surface-card)",
                        border: `1px solid ${showError ? "#C84C3C" : "var(--border-default)"}`,
                        borderRadius: "var(--radius-input)",
                        padding: "var(--space-3)",
                        outline: "none",
                        transition: "border-color var(--transition-default)",
                      }}
                      onFocus={(e) =>
                        !showError &&
                        (e.target.style.borderColor = "var(--accent-700)")
                      }
                      onBlur={(e) =>
                        !showError &&
                        (e.target.style.borderColor = "var(--border-default)")
                      }
                    />
                  </div>
                </div>

                {/* Helper / Error */}
                {!showError ? (
                  <div
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--type-body-sm)",
                      color: "var(--text-secondary)",
                      marginBottom: "var(--space-5)",
                    }}
                  >
                    We&apos;ll send you a link. Tap it and you&apos;re in.
                  </div>
                ) : (
                  <div style={{ marginBottom: "var(--space-5)" }}>
                    <div
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "var(--type-body-sm)",
                        color: "#C84C3C",
                        marginBottom: "var(--space-2)",
                      }}
                    >
                      We don&apos;t recognize that number.
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "var(--type-body-sm)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      Want to join JOSH?{" "}
                      <Link
                        href="/register"
                        style={{ color: "var(--accent-700)", textDecoration: "none" }}
                      >
                        Get started.
                      </Link>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!isFormValid}
                  style={{
                    width: "100%",
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--type-body-md)",
                    fontWeight: "500",
                    color: isFormValid ? "var(--neutral-50)" : "var(--text-tertiary)",
                    background: isFormValid
                      ? "var(--accent-700)"
                      : "var(--neutral-300)",
                    border: "none",
                    borderRadius: "var(--radius-button)",
                    padding: "var(--space-4)",
                    cursor: isFormValid ? "pointer" : "not-allowed",
                    transition: "all var(--transition-default)",
                    minHeight: "56px",
                  }}
                >
                  Send my link
                </button>
              </form>
            </div>
          ) : (
            /* Post-Submit State */
            <div
              style={{ textAlign: "center", animation: "fadeIn 400ms ease-out" }}
            >
              <h2
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--type-display-md)",
                  lineHeight: "1.45",
                  color: "var(--text-primary)",
                  marginBottom: "16px",
                }}
              >
                Check your phone.
              </h2>
              <p
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-md)",
                  color: "var(--text-secondary)",
                  marginBottom: "24px",
                }}
              >
                We sent a link to {countryCode} {phoneNumber}. Tap it to open your
                dashboard.
              </p>
              <button
                onClick={handleResend}
                disabled={resendCooldown > 0}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-sm)",
                  color:
                    resendCooldown > 0
                      ? "var(--text-secondary)"
                      : "var(--accent-700)",
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: resendCooldown > 0 ? "not-allowed" : "pointer",
                  display: "block",
                  marginBottom: "var(--space-3)",
                }}
              >
                {resendCooldown > 0
                  ? `Resend available in ${resendCooldown}s`
                  : resendLabel}
              </button>
              <button
                onClick={handleStartOver}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-sm)",
                  color: "var(--text-secondary)",
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  marginTop: "var(--space-2)",
                }}
              >
                Wrong number? Start over.
              </button>
            </div>
          )}
        </div>
      </main>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
