"use client";

import { useState } from "react";
import Link from "next/link";

export function Confirmation() {
  const [copyButtonLabel, setCopyButtonLabel] = useState("Copy invite link");
  const [showToast, setShowToast] = useState(false);

  const handleCopyLink = () => {
    navigator.clipboard.writeText("https://josh.app/invite/abc123xyz");
    setShowToast(true);
    setCopyButtonLabel("Copied");
    setTimeout(() => {
      setCopyButtonLabel("Copy invite link");
      setShowToast(false);
    }, 2000);
  };

  const handleScheduleCall = () => {
    window.open("https://calendly.com/josh", "_blank");
  };

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
          maxWidth: "960px",
          margin: "0 auto",
          padding: "clamp(var(--space-7), 10vw, var(--space-8)) var(--space-5)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: "var(--space-7)",
            alignItems: "start",
          }}
        >
          {/* Left Column */}
          <div>
            <div style={{ marginBottom: "var(--space-6)" }}>
              <div
                style={{
                  width: "24px",
                  height: "24px",
                  borderRadius: "50%",
                  background: "var(--accent-700)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "var(--space-4)",
                  color: "var(--neutral-50)",
                  fontSize: "14px",
                  fontWeight: "700",
                }}
              >
                ✓
              </div>
              <h1
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--type-display-lg)",
                  lineHeight: "1.3",
                  color: "var(--text-primary)",
                  marginBottom: "16px",
                }}
              >
                You&apos;re on the list.
              </h1>
              <p
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-lg)",
                  color: "var(--text-secondary)",
                  margin: 0,
                }}
              >
                We review every registration personally. When your spot opens,
                JOSH will text you directly.
              </p>
            </div>

            <div
              style={{
                height: "1px",
                background: "var(--border-subtle)",
                marginBottom: "var(--space-6)",
              }}
            />

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-5)",
              }}
            >
              {[
                {
                  title: "We review your registration.",
                  body: "Every request is looked at personally. If it's a good fit for the beta, you'll hear from us.",
                },
                {
                  title: "JOSH texts you.",
                  body: "When your spot opens, you'll get a text — not an email, not a notification. Just a message.",
                },
                {
                  title: "Your first plan gets made.",
                  body: "JOSH will ask you a few questions by text to understand what you're like. Then it gets to work.",
                },
              ].map((step) => (
                <div key={step.title}>
                  <div
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--type-body-md)",
                      fontWeight: "600",
                      color: "var(--text-primary)",
                      marginBottom: "4px",
                    }}
                  >
                    {step.title}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--type-body-md)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {step.body}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--type-body-sm)",
                color: "var(--text-secondary)",
                marginTop: "var(--space-6)",
              }}
            >
              We&apos;ll only contact you about your spot. Nothing else.
            </div>
          </div>

          {/* Right Column */}
          <div>
            <div style={{ marginBottom: "var(--space-6)" }}>
              <div
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-ui-label)",
                  letterSpacing: "var(--tracking-ui-label)",
                  textTransform: "lowercase",
                  color: "var(--text-secondary)",
                  marginBottom: "var(--space-3)",
                }}
              >
                while you wait
              </div>
              <h2
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--type-display-md)",
                  lineHeight: "1.45",
                  color: "var(--text-primary)",
                  marginBottom: "16px",
                }}
              >
                Tell me what you&apos;re hoping for.
              </h2>
              <p
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-md)",
                  color: "var(--text-secondary)",
                  marginBottom: "var(--space-4)",
                }}
              >
                I&apos;m spending 15 minutes with anyone who wants to share their
                story. What do you hope to find? What hasn&apos;t worked before?
                Your input shapes what we build.
              </p>
              <button
                onClick={handleScheduleCall}
                style={{
                  width: "100%",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-md)",
                  fontWeight: "500",
                  color: "var(--neutral-50)",
                  background: "var(--accent-700)",
                  border: "none",
                  borderRadius: "var(--radius-button)",
                  padding: "var(--space-4)",
                  cursor: "pointer",
                  transition: "all var(--transition-default)",
                  minHeight: "56px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "var(--space-2)",
                }}
              >
                <span style={{ fontSize: "16px" }}>📅</span>
                Schedule 15 minutes
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
                No pitch. No pressure. Just conversation.
              </div>
            </div>

            <div
              style={{
                height: "1px",
                background: "var(--border-subtle)",
                marginBottom: "var(--space-6)",
              }}
            />

            <div>
              <div
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-ui-label)",
                  letterSpacing: "var(--tracking-ui-label)",
                  textTransform: "lowercase",
                  color: "var(--text-secondary)",
                  marginBottom: "8px",
                }}
              >
                know someone who&apos;d get this?
              </div>
              <p
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-md)",
                  color: "var(--text-secondary)",
                  marginBottom: "var(--space-4)",
                }}
              >
                Share JOSH with someone dealing with the same thing. The more
                people who join, the better the plans get for everyone.
              </p>
              <button
                onClick={handleCopyLink}
                style={{
                  width: "100%",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-md)",
                  fontWeight: "500",
                  color: "var(--text-primary)",
                  background: "var(--surface-card)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-button)",
                  padding: "var(--space-4)",
                  cursor: "pointer",
                  transition: "all var(--transition-default)",
                  minHeight: "56px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "var(--space-2)",
                }}
              >
                <span style={{ fontSize: "16px" }}>📋</span>
                {copyButtonLabel}
              </button>
            </div>
          </div>
        </div>

        <footer
          style={{
            marginTop: "var(--space-8)",
            paddingTop: "var(--space-6)",
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
            © 2026 JOSH. Seattle, WA.
          </div>
        </footer>
      </main>

      {showToast && (
        <div
          style={{
            position: "fixed",
            bottom: "var(--space-6)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--text-primary)",
            color: "var(--neutral-50)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--type-body-sm)",
            padding: "var(--space-3) var(--space-5)",
            borderRadius: "var(--radius-button)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            animation: "slideUp 300ms ease-out",
            zIndex: 1000,
          }}
        >
          Link copied.
        </div>
      )}

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(10px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  );
}
