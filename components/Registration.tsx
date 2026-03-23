"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DASHBOARD_PROFILE_STORAGE_KEY,
  type DashboardRegistrationProfile,
} from "@/app/lib/dashboard-registration-profile";

type Step = "form" | "otp";

export function Registration() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("form");

  // Form fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [birthday, setBirthday] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [countryCode, setCountryCode] = useState("+1");
  const [smsConsent, setSmsConsent] = useState(false);
  const [ageConsent, setAgeConsent] = useState(false);
  const [termsConsent, setTermsConsent] = useState(false);
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [registrationUserId, setRegistrationUserId] = useState<string | null>(null);
  const [otpSessionId, setOtpSessionId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [otpErrorMessage, setOtpErrorMessage] = useState<string | null>(null);
  const [isSubmittingForm, setIsSubmittingForm] = useState(false);
  const [isSubmittingOtp, setIsSubmittingOtp] = useState(false);
  const [isResendingOtp, setIsResendingOtp] = useState(false);

  // OTP
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [resendCooldown, setResendCooldown] = useState(0);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const isFormValid =
    firstName.trim() &&
    lastName.trim() &&
    phoneNumber.trim() &&
    birthday.trim() &&
    zipCode.trim() &&
    smsConsent &&
    ageConsent &&
    termsConsent &&
    privacyConsent;

  const otpValue = otp.join("");
  const isOtpComplete = otpValue.length === 6;
  const hasOtpError = Boolean(otpErrorMessage);

  useEffect(() => {
    if (resendCooldown <= 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setResendCooldown((current) => Math.max(0, current - 1));
    }, 1000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [resendCooldown]);

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || isSubmittingForm) {
      return;
    }

    setIsSubmittingForm(true);
    setFormError(null);
    setOtpErrorMessage(null);

    try {
      const registerResponse = await postJson<{
        user: { id: string };
      }>("/api/registration/register", {
        firstName,
        lastName,
        countryCode,
        phoneNumber,
        email,
        birthday,
        zipCode,
        smsConsent,
        ageConsent,
        termsConsent,
        privacyConsent,
      });

      const sendOtpResponse = await postJson<{
        otp_session: { id: string };
        resend_available_in_seconds: number;
      }>("/api/registration/send-otp", {
        userId: registerResponse.user.id,
      });

      setRegistrationUserId(registerResponse.user.id);
      setOtpSessionId(sendOtpResponse.otp_session.id);
      setOtp(["", "", "", "", "", ""]);
      setResendCooldown(sendOtpResponse.resend_available_in_seconds);
      setStep("otp");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to start registration.");
    } finally {
      setIsSubmittingForm(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...otp];
    next[index] = value.slice(-1);
    setOtp(next);
    setOtpErrorMessage(null);
    if (value && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingOtp) {
      return;
    }

    if (!registrationUserId || !otpSessionId) {
      setOtpErrorMessage("Your verification session expired. Please start over.");
      return;
    }

    if (!isOtpComplete) {
      setOtpErrorMessage("Please enter the full 6-digit code.");
      return;
    }

    setIsSubmittingOtp(true);
    setOtpErrorMessage(null);

    try {
      const verifyResponse = await postJson<{
        state: {
          user: {
            first_name: string;
            last_name: string;
            email: string | null;
            birthday: string;
            phone_e164: string;
          };
        };
      }>("/api/registration/verify-otp", {
        userId: registrationUserId,
        otpSessionId,
        code: otpValue,
      });

      const verifiedUser = verifyResponse.state.user;
      const dashboardProfile: DashboardRegistrationProfile = {
        firstName: verifiedUser.first_name,
        lastName: verifiedUser.last_name,
        email: verifiedUser.email ?? "",
        birthday: verifiedUser.birthday,
        zipCode: zipCode.trim(),
        phoneNumber: verifiedUser.phone_e164,
      };

      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(
          DASHBOARD_PROFILE_STORAGE_KEY,
          JSON.stringify(dashboardProfile),
        );
      }

      router.push("/dashboard");
    } catch (error) {
      setOtpErrorMessage(error instanceof Error ? error.message : "Unable to verify that code.");
    } finally {
      setIsSubmittingOtp(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || isResendingOtp || !registrationUserId) {
      return;
    }

    setIsResendingOtp(true);
    setOtpErrorMessage(null);

    try {
      const response = await postJson<{
        otp_session: { id: string };
        resend_available_in_seconds: number;
      }>("/api/registration/send-otp", {
        userId: registrationUserId,
      });

      setOtpSessionId(response.otp_session.id);
      setOtp(["", "", "", "", "", ""]);
      setResendCooldown(response.resend_available_in_seconds);
      otpRefs.current[0]?.focus();
    } catch (error) {
      setOtpErrorMessage(error instanceof Error ? error.message : "Unable to resend your code.");
    } finally {
      setIsResendingOtp(false);
    }
  };

  const handleStartOver = () => {
    setStep("form");
    setRegistrationUserId(null);
    setOtpSessionId(null);
    setOtp(["", "", "", "", "", ""]);
    setOtpErrorMessage(null);
    setFormError(null);
    setResendCooldown(0);
  };

  const inputStyle: React.CSSProperties = {
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
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--type-body-md)",
    fontWeight: "500",
    color: "var(--text-primary)",
    marginBottom: "var(--space-2)",
  };

  return (
    <div style={{ background: "var(--surface-landing)", minHeight: "100vh" }}>
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

      <main
        style={{
          maxWidth: "480px",
          margin: "0 auto",
          padding: "clamp(var(--space-7), 10vw, var(--space-8)) var(--space-5)",
        }}
      >
        {step === "form" && (
          <div>
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

            <form onSubmit={handleFormSubmit}>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                <div>
                  <label htmlFor="firstName" style={labelStyle}>First name</label>
                  <input
                    id="firstName" type="text" value={firstName} placeholder="Sarah" required
                    onChange={(e) => setFirstName(e.target.value)}
                    style={inputStyle}
                    onFocus={(e) => (e.target.style.borderColor = "var(--accent-700)")}
                    onBlur={(e) => (e.target.style.borderColor = "var(--border-default)")}
                  />
                </div>

                <div>
                  <label htmlFor="lastName" style={labelStyle}>Last name</label>
                  <input
                    id="lastName" type="text" value={lastName} placeholder="Chen" required
                    onChange={(e) => setLastName(e.target.value)}
                    style={inputStyle}
                    onFocus={(e) => (e.target.style.borderColor = "var(--accent-700)")}
                    onBlur={(e) => (e.target.style.borderColor = "var(--border-default)")}
                  />
                </div>

                <div>
                  <label htmlFor="phoneNumber" style={labelStyle}>Mobile number</label>
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <select
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      style={{ ...inputStyle, width: "auto", minWidth: "80px" }}
                    >
                      <option value="+1">+1</option>
                      <option value="+44">+44</option>
                      <option value="+61">+61</option>
                      <option value="+81">+81</option>
                      <option value="+86">+86</option>
                    </select>
                    <input
                      id="phoneNumber" type="tel" value={phoneNumber}
                      placeholder="Your mobile number" required
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      style={{ ...inputStyle, flex: 1, width: "auto" }}
                      onFocus={(e) => (e.target.style.borderColor = "var(--accent-700)")}
                      onBlur={(e) => (e.target.style.borderColor = "var(--border-default)")}
                    />
                  </div>
                  <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--type-body-sm)", color: "var(--text-secondary)", marginTop: "var(--space-2)" }}>
                    JOSH communicates with you by text. This is the number it will use.
                  </div>
                </div>

                <div>
                  <label htmlFor="email" style={labelStyle}>Email</label>
                  <input
                    id="email" type="email" value={email}
                    placeholder="sarah@email.com"
                    onChange={(e) => setEmail(e.target.value)}
                    style={inputStyle}
                    onFocus={(e) => (e.target.style.borderColor = "var(--accent-700)")}
                    onBlur={(e) => (e.target.style.borderColor = "var(--border-default)")}
                  />
                  <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--type-body-sm)", color: "var(--text-secondary)", marginTop: "var(--space-2)" }}>
                    Optional. We only use this for your account and launch updates.
                  </div>
                </div>

                <div>
                  <label htmlFor="birthday" style={labelStyle}>Birthday</label>
                  <input
                    id="birthday" type="date" value={birthday} required
                    onChange={(e) => setBirthday(e.target.value)}
                    style={inputStyle}
                    onFocus={(e) => (e.target.style.borderColor = "var(--accent-700)")}
                    onBlur={(e) => (e.target.style.borderColor = "var(--border-default)")}
                  />
                </div>

                <div>
                  <label htmlFor="zipCode" style={labelStyle}>Zip code</label>
                  <input
                    id="zipCode" type="text" value={zipCode} required
                    onChange={(e) => setZipCode(e.target.value)}
                    style={inputStyle}
                    onFocus={(e) => (e.target.style.borderColor = "var(--accent-700)")}
                    onBlur={(e) => (e.target.style.borderColor = "var(--border-default)")}
                  />
                </div>

                <div
                  style={{
                    marginTop: "var(--space-5)",
                    padding: "var(--space-4)",
                    background: "var(--surface-card)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-card)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-3)",
                  }}
                >
                  <label style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)", cursor: "pointer" }}>
                    <input
                      type="checkbox" checked={smsConsent} required
                      onChange={(e) => setSmsConsent(e.target.checked)}
                      style={{ marginTop: "4px", minWidth: "16px", cursor: "pointer" }}
                    />
                    <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--type-body-sm)", color: "var(--text-primary)", lineHeight: "1.5" }}>
                      I agree to receive text messages from JOSH for social coordination and account updates. I understand JOSH is an SMS-first service.
                    </span>
                  </label>

                  <label style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)", cursor: "pointer" }}>
                    <input
                      type="checkbox" checked={ageConsent} required
                      onChange={(e) => setAgeConsent(e.target.checked)}
                      style={{ marginTop: "4px", minWidth: "16px", cursor: "pointer" }}
                    />
                    <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--type-body-sm)", color: "var(--text-primary)", lineHeight: "1.5" }}>
                      I confirm that I am at least 18 years old.
                    </span>
                  </label>

                  <label style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)", cursor: "pointer" }}>
                    <input
                      type="checkbox" checked={termsConsent} required
                      onChange={(e) => setTermsConsent(e.target.checked)}
                      style={{ marginTop: "4px", minWidth: "16px", cursor: "pointer" }}
                    />
                    <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--type-body-sm)", color: "var(--text-primary)", lineHeight: "1.5" }}>
                      I have read and agree to the{" "}
                      <Link href="/terms" style={{ color: "var(--accent-700)" }}>
                        Terms of Service
                      </Link>
                    </span>
                  </label>

                  <label style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)", cursor: "pointer" }}>
                    <input
                      type="checkbox" checked={privacyConsent} required
                      onChange={(e) => setPrivacyConsent(e.target.checked)}
                      style={{ marginTop: "4px", minWidth: "16px", cursor: "pointer" }}
                    />
                    <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--type-body-sm)", color: "var(--text-primary)", lineHeight: "1.5" }}>
                      I have read and agree to the{" "}
                      <Link href="/privacy-policy" style={{ color: "var(--accent-700)" }}>
                        Privacy Policy
                      </Link>
                    </span>
                  </label>
                </div>
              </div>

              {formError ? (
                <p
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--type-body-sm)",
                    color: "var(--destructive-600)",
                    marginTop: "var(--space-4)",
                    marginBottom: 0,
                  }}
                >
                  {formError}
                </p>
              ) : null}

              <div style={{ marginTop: "var(--space-6)" }}>
                <button
                  type="submit"
                  disabled={!isFormValid || isSubmittingForm}
                  style={{
                    width: "100%",
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--type-body-md)",
                    fontWeight: "500",
                    color: isFormValid && !isSubmittingForm ? "var(--neutral-50)" : "var(--text-tertiary)",
                    background: isFormValid && !isSubmittingForm ? "var(--accent-700)" : "var(--neutral-300)",
                    border: "none",
                    borderRadius: "var(--radius-button)",
                    padding: "var(--space-4)",
                    cursor: isFormValid && !isSubmittingForm ? "pointer" : "not-allowed",
                    transition: "all var(--transition-default)",
                    minHeight: "56px",
                  }}
                >
                  {isSubmittingForm ? "Sending your code..." : "Create my account"}
                </button>
              </div>
            </form>
          </div>
        )}

        {step === "otp" && (
          <div style={{ animation: "fadeIn 400ms ease-out" }}>
            <header style={{ marginBottom: "var(--space-7)", textAlign: "center" }}>
              <h1
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--type-display-lg)",
                  lineHeight: "1.3",
                  color: "var(--text-primary)",
                  marginBottom: "12px",
                }}
              >
                Check your phone.
              </h1>
              <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--type-body-md)", color: "var(--text-secondary)", margin: 0 }}>
                We sent a 6-digit code to {countryCode} {phoneNumber}. Enter it below to verify your number.
              </p>
            </header>

            <form onSubmit={handleOtpVerify}>
              <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "center", marginBottom: "var(--space-3)" }}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { otpRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    style={{
                      width: "52px",
                      height: "56px",
                      textAlign: "center",
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--type-display-sm)",
                      fontWeight: "500",
                      color: "var(--text-primary)",
                      background: "var(--surface-card)",
                      border: `1px solid ${hasOtpError ? "var(--destructive-600)" : digit ? "var(--accent-700)" : "var(--border-default)"}`,
                      borderRadius: "var(--radius-input)",
                      outline: "none",
                      transition: "border-color var(--transition-default)",
                    }}
                    onFocus={(e) => !hasOtpError && (e.target.style.borderColor = "var(--accent-700)")}
                    onBlur={(e) => !digit && !hasOtpError && (e.target.style.borderColor = "var(--border-default)")}
                  />
                ))}
              </div>

              {otpErrorMessage ? (
                <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--type-body-sm)", color: "var(--destructive-600)", textAlign: "center", marginBottom: "var(--space-3)" }}>
                  {otpErrorMessage}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={!isOtpComplete || isSubmittingOtp}
                style={{
                  width: "100%",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-md)",
                  fontWeight: "500",
                  color: isOtpComplete && !isSubmittingOtp ? "var(--neutral-50)" : "var(--text-tertiary)",
                  background: isOtpComplete && !isSubmittingOtp ? "var(--accent-700)" : "var(--neutral-300)",
                  border: "none",
                  borderRadius: "var(--radius-button)",
                  padding: "var(--space-4)",
                  cursor: isOtpComplete && !isSubmittingOtp ? "pointer" : "not-allowed",
                  transition: "all var(--transition-default)",
                  minHeight: "56px",
                  marginBottom: "var(--space-4)",
                }}
              >
                {isSubmittingOtp ? "Verifying..." : "Verify my number"}
              </button>
            </form>

            <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <button
                onClick={handleResend}
                disabled={resendCooldown > 0 || isResendingOtp}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--type-body-sm)",
                  color: resendCooldown > 0 || isResendingOtp ? "var(--text-secondary)" : "var(--accent-700)",
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: resendCooldown > 0 || isResendingOtp ? "not-allowed" : "pointer",
                }}
              >
                {isResendingOtp
                  ? "Sending another code..."
                  : resendCooldown > 0
                  ? `Resend available in ${resendCooldown}s`
                  : "Didn't get it? Send again."}
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
                }}
              >
                Wrong number? Start over.
              </button>
            </div>
          </div>
        )}

        <footer
          style={{
            marginTop: "var(--space-8)",
            paddingTop: "var(--space-8)",
            borderTop: "1px solid var(--border-subtle)",
            textAlign: "center",
          }}
        >
          <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--type-body-sm)", color: "var(--text-secondary)" }}>
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

async function postJson<TResponse>(url: string, body: Record<string, unknown>): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null) as
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Request failed.");
  }

  return payload as TResponse;
}
