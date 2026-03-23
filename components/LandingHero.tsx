"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ImageWithFallback } from "@/components/figma/ImageWithFallback";
import { Button } from "@/components/Button";

interface LandingHeroProps {
  onLoginClick?: () => void;
}

export function LandingHero({ onLoginClick }: LandingHeroProps = {}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 80);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div style={{ background: "var(--surface-landing)" }}>
      {/* Navigation */}
      <nav
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          padding: "var(--space-4) var(--space-6)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: scrolled ? "var(--surface-landing)" : "transparent",
          borderBottom: scrolled ? "1px solid var(--border-subtle)" : "none",
          transition: "all 300ms ease-out",
          zIndex: 100,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--type-display-sm)",
            letterSpacing: "var(--tracking-display)",
            color: scrolled ? "var(--text-primary)" : "var(--surface-landing)",
          }}
        >
          JOSH
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
          <button
            onClick={onLoginClick}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--type-body-md)",
              fontWeight: "500",
              color: scrolled ? "var(--text-primary)" : "var(--surface-landing)",
              background: "transparent",
              border: "none",
              padding: "var(--space-2) var(--space-3)",
              cursor: "pointer",
              transition: "all var(--transition-default)",
            }}
          >
            Log in
          </button>
          <Button variant="primary" size="medium">
            Get started
          </Button>
        </div>
      </nav>

      {/* Hero Section */}
      <section
        style={{
          position: "relative",
          height: "100vh",
          width: "100%",
          overflow: "hidden",
        }}
      >
        <ImageWithFallback
          src="https://images.unsplash.com/photo-1743866691397-50f22c9c72f1?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxncm91cCUyMGRpbm5lciUyMHRhYmxlJTIwZnJpZW5kcyUyMGFkdWx0cyUyMGNvbnZlcnNhdGlvbiUyMHdhcm0lMjBsaWdodGluZ3xlbnwxfHx8fDE3NzM4MDAyOTZ8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
          alt="Group dinner"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "sepia(8%) saturate(85%) brightness(102%) contrast(98%)",
          }}
        />
        {/* Gradient Overlay */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "30%",
            background: "linear-gradient(to top, rgba(26, 23, 20, 0.6), transparent)",
            pointerEvents: "none",
          }}
        />
        {/* Content */}
        <div
          style={{
            position: "absolute",
            bottom: "var(--space-8)",
            left: "var(--space-8)",
            maxWidth: "560px",
          }}
        >
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--type-display-xl)",
              lineHeight: "var(--leading-display-xl)",
              letterSpacing: "var(--tracking-display)",
              color: "var(--surface-landing)",
              marginBottom: "var(--space-4)",
            }}
          >
            Your people are out there.
          </h1>
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--type-body-lg)",
              lineHeight: "var(--leading-body-lg)",
              color: "var(--surface-landing)",
              opacity: 0.95,
              marginBottom: "var(--space-5)",
            }}
          >
            JOSH coordinates your social life so you don&apos;t have to.
          </p>
          {/* Phone CTA */}
          <div style={{ marginBottom: "var(--space-3)" }}>
            <div
              style={{
                display: "flex",
                maxWidth: "420px",
                height: "56px",
                background: "var(--surface-card)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-input)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "0 var(--space-3)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  borderRight: "1px solid var(--border-subtle)",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-md)",
                  color: "var(--text-primary)",
                }}
              >
                🇺🇸 +1
              </div>
              <input
                type="tel"
                placeholder="Your mobile number"
                style={{
                  flex: 1,
                  border: "none",
                  background: "transparent",
                  padding: "0 var(--space-3)",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-md)",
                  color: "var(--text-primary)",
                  outline: "none",
                }}
              />
              <Button variant="primary" style={{ borderRadius: 0 }}>
                Get started
              </Button>
            </div>
          </div>
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--type-body-sm)",
              color: "var(--surface-landing)",
              opacity: 0.85,
            }}
          >
            No app. No account. Just a text.
          </p>
        </div>
      </section>

      {/* Section 2: Typography */}
      <section
        style={{
          padding: "var(--space-9) var(--space-6)",
          background: "var(--surface-landing)",
        }}
      >
        <div style={{ maxWidth: "1440px", margin: "0 auto" }}>
          <div style={{ maxWidth: "55%" }}>
            <p
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--type-display-md)",
                lineHeight: "1.45",
                color: "var(--text-primary)",
                margin: 0,
              }}
            >
              You have a full life. Work, obligations, the things that fill a week
              without being asked. But when you look at what&apos;s actually on the
              calendar — what you&apos;re actually doing, with people you actually
              chose — it&apos;s less than you&apos;d like. Not empty. Just quieter
              than the version of your life you had in mind.
            </p>
          </div>
        </div>
      </section>

      {/* Section 3: The Shift */}
      <section
        style={{
          background: "var(--surface-landing)",
          paddingTop: "var(--space-9)",
          paddingBottom: "var(--space-9)",
        }}
      >
        <div
          style={{
            maxWidth: "1440px",
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "52% 48%",
            alignItems: "center",
          }}
        >
          {/* Image Column */}
          <div
            style={{
              position: "relative",
              marginLeft: "calc(-50vw + 50%)",
              width: "calc(100% + 50vw - 50%)",
              height: "100%",
            }}
          >
            <ImageWithFallback
              src="https://images.unsplash.com/photo-1752201460566-47bbfc76b630?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxhZHVsdHMlMjBmcmllbmRzJTIwYnJld2VyeSUyMGxpdmUlMjBtdXNpYyUyMHZlbnVlJTIwZXZlbmluZyUyMHdhcm0lMjBsaWdodGluZ3xlbnwxfHx8fDE3NzM4MDE1NTN8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
              alt="Evening with friends"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: "sepia(8%) saturate(85%) brightness(102%) contrast(98%)",
              }}
            />
          </div>
          {/* Copy Column */}
          <div
            style={{
              paddingLeft: "var(--space-8)",
              paddingRight: "var(--space-8)",
            }}
          >
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
              meet josh
            </div>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--type-display-lg)",
                lineHeight: "var(--leading-display-lg)",
                letterSpacing: "var(--tracking-display)",
                color: "var(--text-primary)",
                marginBottom: "var(--space-5)",
              }}
            >
              Your social life, handled.
            </h2>
            <div style={{ maxWidth: "480px" }}>
              <p
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-lg)",
                  lineHeight: "var(--leading-body-lg)",
                  color: "var(--text-primary)",
                  marginBottom: "var(--space-4)",
                }}
              >
                JOSH is an AI that works like the friend everyone wishes they had
                — the one who knows what you&apos;re like, knows interesting people,
                and makes things happen without being asked. Not an app you open.
                Not a service you manage. A number you text when you&apos;re ready,
                and a presence that works in the background when you&apos;re not.
              </p>
              <p
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-lg)",
                  lineHeight: "var(--leading-body-lg)",
                  color: "var(--text-primary)",
                  margin: 0,
                }}
              >
                The plans that used to require three weeks of calendar negotiation
                start appearing on their own. The people you keep meaning to see
                show up in the same place at the same time. The version of your
                social life you had in mind begins to look a lot like the one
                you&apos;re actually living.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Section 4: How It Works */}
      <section
        style={{
          background: "var(--accent-100)",
          paddingTop: "var(--space-9)",
          paddingBottom: "var(--space-9)",
        }}
      >
        <div
          style={{
            maxWidth: "680px",
            margin: "0 auto",
            textAlign: "center",
            padding: "0 var(--space-6)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--type-ui-label)",
              letterSpacing: "var(--tracking-ui-label)",
              textTransform: "lowercase",
              color: "var(--text-secondary)",
              marginBottom: "var(--space-5)",
            }}
          >
            how it works
          </div>
          <p
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--type-display-md)",
              lineHeight: "1.45",
              color: "var(--text-primary)",
              marginBottom: "var(--space-5)",
              textAlign: "center",
            }}
          >
            You answer a few questions once. JOSH learns what you are actually like
            — not your best self on a profile, just you: how you like to spend time,
            what kinds of people you do well with, what a good evening looks like
            for you. Then it gets to work. Invitations arrive by text. You say yes
            or pass. Plans get made. You show up.
          </p>
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--type-body-lg)",
              lineHeight: "var(--leading-body-lg)",
              color: "var(--text-secondary)",
              marginBottom: "var(--space-6)",
              textAlign: "center",
            }}
          >
            No feed to check. No profile to maintain. No one reaches out to you
            and you don&apos;t reach out to anyone.
          </p>
          <Button variant="secondary" size="medium">
            Get started
          </Button>
        </div>
      </section>

      {/* Section 5: Close */}
      <section
        style={{
          background: "var(--accent-500)",
          minHeight: "480px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          paddingTop: "var(--space-9)",
          paddingBottom: "var(--space-9)",
          paddingLeft: "var(--space-6)",
          paddingRight: "var(--space-6)",
        }}
      >
        <div style={{ maxWidth: "680px", textAlign: "center" }}>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--type-display-lg)",
              lineHeight: "var(--leading-display-lg)",
              letterSpacing: "var(--tracking-display)",
              color: "var(--surface-landing)",
              marginBottom: "var(--space-6)",
            }}
          >
            Your next plan is closer than you think.
          </h2>
          <div style={{ marginBottom: "var(--space-3)" }}>
            <div
              style={{
                display: "flex",
                maxWidth: "440px",
                height: "56px",
                margin: "0 auto",
                background: "var(--surface-landing)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-input)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "0 var(--space-3)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  borderRight: "1px solid var(--border-subtle)",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-md)",
                  color: "var(--text-primary)",
                }}
              >
                🇺🇸 +1
              </div>
              <input
                type="tel"
                placeholder="Your mobile number"
                style={{
                  flex: 1,
                  border: "none",
                  background: "transparent",
                  padding: "0 var(--space-3)",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-md)",
                  color: "var(--text-primary)",
                  outline: "none",
                }}
              />
              <button
                style={{
                  padding: "0 var(--space-5)",
                  background: "var(--text-primary)",
                  color: "var(--surface-landing)",
                  border: "none",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-md)",
                  fontWeight: "500",
                  cursor: "pointer",
                  transition: "all var(--transition-default)",
                }}
              >
                Get started
              </button>
            </div>
          </div>
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--type-body-sm)",
              color: "var(--surface-landing)",
              opacity: 0.7,
            }}
          >
            Seattle beta. Limited spots.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer
        style={{
          background: "var(--text-primary)",
          padding: "var(--space-6)",
          borderTop: "1px solid rgba(247, 244, 239, 0.1)",
        }}
      >
        <div style={{ maxWidth: "1440px", margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "var(--space-4)",
              flexWrap: "wrap",
              gap: "var(--space-4)",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--type-display-sm)",
                letterSpacing: "var(--tracking-display)",
                color: "var(--surface-landing)",
              }}
            >
              JOSH
            </div>
            <div style={{ display: "flex", gap: "var(--space-5)" }}>
              <Link
                href="/privacy-policy"
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-sm)",
                  color: "var(--text-secondary)",
                  textDecoration: "none",
                }}
              >
                Privacy
              </Link>
              <Link
                href="/terms-of-service"
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-sm)",
                  color: "var(--text-secondary)",
                  textDecoration: "none",
                }}
              >
                Terms
              </Link>
              <a
                href="mailto:hello@josh.app"
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-sm)",
                  color: "var(--text-secondary)",
                  textDecoration: "none",
                }}
              >
                Contact
              </a>
            </div>
          </div>
          <div
            style={{
              textAlign: "center",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--type-body-sm)",
              color: "var(--text-secondary)",
            }}
          >
            © 2026 JOSH. Seattle, WA.
          </div>
        </div>
      </footer>
    </div>
  );
}
