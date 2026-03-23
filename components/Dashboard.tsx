"use client";

import { useEffect, useState } from "react";
import {
  DASHBOARD_PROFILE_STORAGE_KEY,
  type DashboardRegistrationProfile,
} from "@/app/lib/dashboard-registration-profile";

type DashboardTab = "Home" | "Circle" | "LinkUp" | "Profile";
type LinkupFilter = "upcoming" | "past";

type DashboardProps = {
  checkoutState?: "success" | "cancel" | null;
};

const TABS: DashboardTab[] = ["Home", "Circle", "LinkUp", "Profile"];

const emptyProfile: DashboardRegistrationProfile = {
  firstName: "",
  lastName: "",
  email: "",
  birthday: "",
  zipCode: "",
  phoneNumber: "",
};

export function Dashboard({ checkoutState = null }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<DashboardTab>("Home");
  const [profile, setProfile] = useState<DashboardRegistrationProfile>(emptyProfile);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.sessionStorage.getItem(DASHBOARD_PROFILE_STORAGE_KEY);
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as Partial<DashboardRegistrationProfile>;
      setProfile({
        firstName: parsed.firstName?.trim() ?? "",
        lastName: parsed.lastName?.trim() ?? "",
        email: parsed.email?.trim() ?? "",
        birthday: parsed.birthday?.trim() ?? "",
        zipCode: parsed.zipCode?.trim() ?? "",
        phoneNumber: parsed.phoneNumber?.trim() ?? "",
      });
    } catch {
      window.sessionStorage.removeItem(DASHBOARD_PROFILE_STORAGE_KEY);
    }
  }, []);

  return (
    <div
      className="dashboard-shell"
      style={{
        background: "var(--surface-landing)",
        minHeight: "100vh",
        paddingBottom: "80px",
      }}
    >
      <nav
        className="dashboard-desktop-nav"
        style={{
          display: "none",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--surface-card)",
          padding: "var(--space-4) var(--space-6)",
        }}
      >
        <div
          style={{
            maxWidth: "960px",
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "var(--space-5)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--type-display-sm)",
              letterSpacing: "var(--tracking-display)",
              color: "var(--text-primary)",
            }}
          >
            JOSH
          </div>
          <div
            style={{
              display: "flex",
              gap: "var(--space-6)",
            }}
          >
            {TABS.map((tab) => (
              <TabButton key={tab} active={activeTab === tab} label={tab} onClick={() => setActiveTab(tab)} />
            ))}
          </div>
        </div>
      </nav>

      <div>
        {activeTab === "Home" && <DashboardHome profile={profile} checkoutState={checkoutState} />}
        {activeTab === "Circle" && <DashboardCircle />}
        {activeTab === "LinkUp" && <DashboardLinkUp />}
        {activeTab === "Profile" && <DashboardProfile profile={profile} />}
      </div>

      <nav
        className="dashboard-mobile-nav"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "var(--surface-card)",
          borderTop: "1px solid var(--border-subtle)",
          height: "56px",
          display: "flex",
          justifyContent: "space-around",
          alignItems: "center",
          zIndex: 100,
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "none",
              padding: "var(--space-2)",
              cursor: "pointer",
              flex: 1,
              gap: "4px",
            }}
          >
            <div
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: activeTab === tab ? "var(--accent-700)" : "transparent",
                marginBottom: "2px",
              }}
            />
            <div
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--type-body-sm)",
                color: activeTab === tab ? "var(--accent-700)" : "var(--text-secondary)",
                fontWeight: activeTab === tab ? "500" : "400",
              }}
            >
              {tab}
            </div>
          </button>
        ))}
      </nav>

      <style jsx>{`
        @media (min-width: 768px) {
          .dashboard-shell {
            padding-bottom: 0 !important;
          }

          .dashboard-desktop-nav {
            display: block !important;
          }

          .dashboard-mobile-nav {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}

function DashboardHome({
  profile,
  checkoutState,
}: {
  profile: DashboardRegistrationProfile;
  checkoutState: "success" | "cancel" | null;
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = profile.firstName || "there";
  const currentDate = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  return (
    <main
      style={{
        maxWidth: "720px",
        margin: "0 auto",
        padding: "0 var(--space-5) var(--space-6)",
      }}
    >
      <header
        style={{
          paddingTop: "var(--space-6)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--type-body-lg)",
            lineHeight: "var(--leading-body-lg)",
            color: "var(--text-primary)",
            marginBottom: "var(--space-2)",
          }}
        >
          {greeting}, {firstName}.
        </div>
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--type-body-sm)",
            color: "var(--text-secondary)",
          }}
        >
          {currentDate}
        </div>
      </header>

      {checkoutState ? <CheckoutNotice checkoutState={checkoutState} /> : null}

      <section
        style={{
          marginTop: "var(--space-5)",
        }}
      >
        <SectionLabel>coming up</SectionLabel>
        <EmptyCard
          title="Nothing on the calendar yet."
          description="Your LinkUps will appear here once they are confirmed."
        />
      </section>

      <section
        style={{
          marginTop: "var(--space-6)",
        }}
      >
        <SectionLabel>recently</SectionLabel>
        <EmptyCard
          title="No past LinkUps yet."
          description="When you have activity to look back on, it will show up here."
        />
      </section>
    </main>
  );
}

function DashboardCircle() {
  return (
    <main
      style={{
        maxWidth: "720px",
        margin: "0 auto",
        padding: "0 var(--space-5) var(--space-6)",
      }}
    >
      <header
        style={{
          paddingTop: "var(--space-6)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--type-display-md)",
            lineHeight: "1.45",
            color: "var(--text-primary)",
            marginBottom: "var(--space-2)",
          }}
        >
          Your Circle
        </h1>
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--type-body-sm)",
            color: "var(--text-secondary)",
          }}
        >
          The people you want to see more of. JOSH keeps them in mind.
        </p>
      </header>

      <section
        style={{
          marginTop: "var(--space-5)",
        }}
      >
        <EmptyCard
          title="Your Circle is empty."
          description="When Circle management is set up for your account, the people you add will appear here."
        />
      </section>
    </main>
  );
}

function DashboardLinkUp() {
  const [activeFilter, setActiveFilter] = useState<LinkupFilter>("upcoming");

  return (
    <main
      style={{
        maxWidth: "720px",
        margin: "0 auto",
        padding: "0 var(--space-5) var(--space-6)",
      }}
    >
      <header
        style={{
          paddingTop: "var(--space-6)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--type-display-md)",
            lineHeight: "1.45",
            color: "var(--text-primary)",
            marginBottom: "var(--space-2)",
          }}
        >
          LinkUps
        </h1>
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--type-body-sm)",
            color: "var(--text-secondary)",
          }}
        >
          Plans JOSH has made for you.
        </p>
      </header>

      <div
        style={{
          marginTop: "var(--space-5)",
          display: "flex",
          gap: "var(--space-5)",
        }}
      >
        <FilterButton label="Upcoming" active={activeFilter === "upcoming"} onClick={() => setActiveFilter("upcoming")} />
        <FilterButton label="Past" active={activeFilter === "past"} onClick={() => setActiveFilter("past")} />
      </div>

      <div
        style={{
          marginTop: "var(--space-5)",
        }}
      >
        {activeFilter === "upcoming" ? (
          <EmptyCard
            title="Your next LinkUp is on its way."
            description="Nothing is scheduled yet. When something is confirmed, it will appear here."
          />
        ) : (
          <EmptyCard
            title="No past LinkUps yet."
            description="Completed plans and contact exchange history will appear here later."
          />
        )}
      </div>
    </main>
  );
}

function DashboardProfile({ profile }: { profile: DashboardRegistrationProfile }) {
  const fullName = buildFullName(profile);
  const initials = buildInitials(profile);

  return (
    <main
      style={{
        maxWidth: "720px",
        margin: "0 auto",
        padding: "0 var(--space-5) var(--space-8)",
      }}
    >
      <header
        style={{
          paddingTop: "var(--space-6)",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: "80px",
            height: "80px",
            borderRadius: "50%",
            background: "var(--accent-100)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--type-body-lg)",
            fontWeight: "600",
            color: "var(--accent-700)",
            marginBottom: "var(--space-3)",
          }}
        >
          {initials}
        </div>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--type-display-md)",
            lineHeight: "1.45",
            color: "var(--text-primary)",
            marginBottom: "4px",
          }}
        >
          {fullName || "Your Profile"}
        </h1>
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--type-body-sm)",
            color: "var(--text-secondary)",
          }}
        >
          Registration details
        </p>
      </header>

      <section
        style={{
          marginTop: "var(--space-6)",
        }}
      >
        <SectionLabel>from registration</SectionLabel>
        <InfoCard>
          <InfoRow label="Full name" value={fullName} />
          <InfoRow label="Email" value={profile.email} />
          <InfoRow label="Phone number" value={profile.phoneNumber} />
          <InfoRow label="Zip code" value={profile.zipCode} />
          <InfoRow label="Birthday" value={formatBirthday(profile.birthday)} />
        </InfoCard>
      </section>

      <section
        style={{
          marginTop: "var(--space-6)",
        }}
      >
        <SectionLabel>next</SectionLabel>
        <div
          style={{
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-card)",
            padding: "var(--space-5)",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--type-body-sm)",
              color: "var(--text-secondary)",
            }}
          >
            Your dashboard stays intentionally quiet until JOSH has real activity, profile updates, or settings to show you.
          </p>
        </div>
      </section>
    </main>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: "var(--type-body-md)",
        fontWeight: "500",
        color: active ? "var(--accent-700)" : "var(--text-secondary)",
        background: "transparent",
        border: "none",
        borderBottom: `3px solid ${active ? "var(--accent-700)" : "transparent"}`,
        padding: "var(--space-3) 0",
        cursor: "pointer",
        transition: "all var(--transition-default)",
      }}
    >
      {label}
    </button>
  );
}

function FilterButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: "var(--type-body-sm)",
        fontWeight: active ? "500" : "400",
        color: active ? "var(--accent-700)" : "var(--text-secondary)",
        background: "transparent",
        border: "none",
        borderBottom: active ? "2px solid var(--accent-700)" : "none",
        padding: "0 0 var(--space-2) 0",
        cursor: "pointer",
        transition: "color 150ms ease",
      }}
    >
      {label}
    </button>
  );
}

function CheckoutNotice({ checkoutState }: { checkoutState: "success" | "cancel" }) {
  const title = checkoutState === "success" ? "Subscription updated." : "Checkout canceled.";
  const description =
    checkoutState === "success"
      ? "Your billing change went through successfully."
      : "No billing changes were made.";

  return (
    <div
      style={{
        marginTop: "var(--space-5)",
        background: checkoutState === "success" ? "var(--accent-100)" : "var(--neutral-100)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-card)",
        padding: "var(--space-4)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--type-body-md)",
          fontWeight: "500",
          color: "var(--text-primary)",
          marginBottom: "var(--space-1)",
        }}
      >
        {title}
      </div>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--type-body-sm)",
          color: "var(--text-secondary)",
        }}
      >
        {description}
      </p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </div>
  );
}

function EmptyCard({ title, description }: { title: string; description: string }) {
  return (
    <div
      style={{
        background: "var(--surface-card)",
        border: "1px dashed var(--border-subtle)",
        borderRadius: "var(--radius-card)",
        padding: "var(--space-6)",
        minHeight: "180px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--type-display-md)",
          lineHeight: "1.45",
          color: "var(--text-primary)",
          marginBottom: "var(--space-3)",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--type-body-sm)",
          color: "var(--text-secondary)",
        }}
      >
        {description}
      </div>
    </div>
  );
}

function InfoCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-card)",
        padding: "0 var(--space-5)",
      }}
    >
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "var(--space-4) 0",
        borderBottom: label === "Birthday" ? "none" : "1px solid var(--border-subtle)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--type-body-sm)",
          color: "var(--text-secondary)",
          marginBottom: "4px",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--type-body-md)",
          color: value ? "var(--text-primary)" : "var(--text-secondary)",
        }}
      >
        {value || "Not provided"}
      </div>
    </div>
  );
}

function buildFullName(profile: DashboardRegistrationProfile): string {
  return [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
}

function buildInitials(profile: DashboardRegistrationProfile): string {
  const parts = [profile.firstName, profile.lastName].filter(Boolean);
  if (parts.length === 0) {
    return "J";
  }

  return parts
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}

function formatBirthday(value: string): string {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}
