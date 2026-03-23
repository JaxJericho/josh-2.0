"use client";

import { useState } from "react";
import Link from "next/link";

interface RegistrationProps {
  onComplete?: () => void;
}

export function Registration({ onComplete }: RegistrationProps = {}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [countryCode, setCountryCode] = useState("+1");
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitted(true);
    if (onComplete) onComplete();
  };

  const handleStartOver = () => {
    setFirstName("");
    setLastName("");
    setPhoneNumber("");
    setEmail("");
    setIsSubmitted(false);
  };

  const isFormValid =
    firstName.trim() && lastName.trim() && phoneNumber.trim() && email.trim();

  return (
    <div style={{ background: "var(--surface-landing)", minHeight: "100vh" }}>
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

      {/* Main Content */}
      <main
        style={{
          maxWidth: "480px",
          margin: "0 auto",
          padding: "clamp(var(--space-7), 10vw, var(--space-8)) var(--space-5)",
        }}
      >
        {!isSubmitted ? (
          <div>
            {/* Header */}
            <header style={{ marginBottom: "var(--space-7)" }}>
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
                join josh
              </div>
              <h1
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--type-display-lg)",
                  lineHeight: "1.3",
                  color: "var(--text-primary)",
                  marginBottom: "12px",
                }}
              >
                Let&apos;s get you set up.
              </h1>
              <p
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-lg)",
                  color: "var(--text-secondary)",
                  margin: 0,
                }}
              >
                A few details and you&apos;re done. JOSH takes it from there.
              </p>
            </header>

            {/* Form */}
            <form onSubmit={handleSubmit}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-4)",
                }}
              >
                {/* First Name */}
                <div>
                  <label
                    htmlFor="firstName"
                    style={{
                      display: "block",
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--type-body-md)",
                      fontWeight: "500",
                      color: "var(--text-primary)",
                      marginBottom: "var(--space-2)",
                    }}
                  >
                    First name
                  </label>
                  <input
                    id="firstName"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Sarah"
                    required
                    style={{
                      width: "100%",
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--type-body-md)",
                      color: "var(--text-primary)",
                      background: "var(--surface-card)",
                      border: "1px solid var(--border-default)",
                      borderRadius: "var(--radius-input)",
                      padding: "var(--space-3)",
                      outline: "none",
                      transition: "border-color var(--transition-default)",
                    }}
                    onFocus={(e) =>
                      (e.target.style.borderColor = "var(--accent-700)")
                    }
                    onBlur={(e) =>
                      (e.target.style.borderColor = "var(--border-default)")
                    }
                  />
                </div>

                {/* Last Name */}
                <div>
                  <label
                    htmlFor="lastName"
                    style={{
                      display: "block",
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--type-body-md)",
                      fontWeight: "500",
                      color: "var(--text-primary)",
                      marginBottom: "var(--space-2)",
                    }}
                  >
                    Last name
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Chen"
                    required
                    style={{
                      width: "100%",
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--type-body-md)",
                      color: "var(--text-primary)",
                      background: "var(--surface-card)",
                      border: "1px solid var(--border-default)",
                      borderRadius: "var(--radius-input)",
                      padding: "var(--space-3)",
                      outline: "none",
                      transition: "border-color var(--transition-default)",
                    }}
                    onFocus={(e) =>
                      (e.target.style.borderColor = "var(--accent-700)")
                    }
                    onBlur={(e) =>
                      (e.target.style.borderColor = "var(--border-default)")
                    }
                  />
                </div>

                {/* Mobile Number */}
                <div>
                  <label
                    htmlFor="phoneNumber"
                    style={{
                      display: "block",
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--type-body-md)",
                      fontWeight: "500",
                      color: "var(--text-primary)",
                      marginBottom: "var(--space-2)",
                    }}
                  >
                    Mobile number
                  </label>
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <select
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "var(--type-body-md)",
                        color: "var(--text-primary)",
                        background: "var(--surface-card)",
                        border: "1px solid var(--border-default)",
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
                      id="phoneNumber"
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="Your mobile number"
                      required
                      style={{
                        flex: 1,
                        fontFamily: "var(--font-ui)",
                        fontSize: "var(--type-body-md)",
                        color: "var(--text-primary)",
                        background: "var(--surface-card)",
                        border: "1px solid var(--border-default)",
                        borderRadius: "var(--radius-input)",
                        padding: "var(--space-3)",
                        outline: "none",
                        transition: "border-color var(--transition-default)",
                      }}
                      onFocus={(e) =>
                        (e.target.style.borderColor = "var(--accent-700)")
                      }
                      onBlur={(e) =>
                        (e.target.style.borderColor = "var(--border-default)")
                      }
                    />
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--type-body-sm)",
                      color: "var(--text-secondary)",
                      marginTop: "var(--space-2)",
                    }}
                  >
                    JOSH communicates with you by text. This is the number it will use.
                  </div>
                </div>

                {/* Email */}
                <div>
                  <label
                    htmlFor="email"
                    style={{
                      display: "block",
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--type-body-md)",
                      fontWeight: "500",
                      color: "var(--text-primary)",
                      marginBottom: "var(--space-2)",
                    }}
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="sarah@email.com"
                    required
                    style={{
                      width: "100%",
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--type-body-md)",
                      color: "var(--text-primary)",
                      background: "var(--surface-card)",
                      border: "1px solid var(--border-default)",
                      borderRadius: "var(--radius-input)",
                      padding: "var(--space-3)",
                      outline: "none",
                      transition: "border-color var(--transition-default)",
                    }}
                    onFocus={(e) =>
                      (e.target.style.borderColor = "var(--accent-700)")
                    }
                    onBlur={(e) =>
                      (e.target.style.borderColor = "var(--border-default)")
                    }
                  />
                  <div
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--type-body-sm)",
                      color: "var(--text-secondary)",
                      marginTop: "var(--space-2)",
                    }}
                  >
                    For your account only. We don&apos;t send marketing email.
                  </div>
                </div>
              </div>

              {/* Submit */}
              <div style={{ marginTop: "var(--space-6)" }}>
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
                  Create my account
                </button>
                <div
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--type-body-sm)",
                    color: "var(--text-secondary)",
                    textAlign: "center",
                    marginTop: "var(--space-3)",
                  }}
                >
                  By continuing, you agree to our{" "}
                  <Link
                    href="/terms-of-service"
                    style={{ color: "var(--accent-700)", textDecoration: "none" }}
                  >
                    Terms
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/privacy-policy"
                    style={{ color: "var(--accent-700)", textDecoration: "none" }}
                  >
                    Privacy Policy
                  </Link>
                  .
                </div>
              </div>
            </form>
          </div>
        ) : (
          /* Post-Submit State */
          <div
            style={{
              textAlign: "center",
              paddingTop: "var(--space-8)",
              animation: "fadeIn 400ms ease-out",
            }}
          >
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--type-display-md)",
                lineHeight: "1.45",
                color: "var(--text-primary)",
                marginBottom: "var(--space-4)",
              }}
            >
              Check your phone.
            </h2>
            <p
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--type-body-md)",
                color: "var(--text-secondary)",
                marginBottom: "var(--space-5)",
              }}
            >
              We sent a text to {countryCode} {phoneNumber}. Reply YES to confirm
              and you&apos;re in.
            </p>
            <button
              onClick={handleStartOver}
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--type-body-sm)",
                color: "var(--accent-700)",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            >
              Wrong number? Start over.
            </button>
          </div>
        )}

        {/* Footer */}
        <footer
          style={{
            marginTop: "var(--space-8)",
            paddingTop: "var(--space-8)",
            borderTop: "1px solid var(--border-subtle)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--type-body-sm)",
              color: "var(--text-secondary)",
            }}
          >
            JOSH is a Seattle-based beta. We review every registration personally.
          </div>
        </footer>
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
