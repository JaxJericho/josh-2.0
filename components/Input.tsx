"use client";

import React from "react";
import { Check } from "lucide-react";

type InputState = "default" | "focus" | "error" | "verified";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  inputState?: InputState;
  errorMessage?: string;
  label?: string;
}

export function Input({
  inputState = "default",
  errorMessage,
  label,
  className = "",
  ...props
}: InputProps) {
  const [isFocused, setIsFocused] = React.useState(false);

  const effectiveState = isFocused && inputState === "default" ? "focus" : inputState;

  return (
    <div className={`flex flex-col gap-[var(--space-2)] ${className}`}>
      {label && (
        <label
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--type-ui-label)",
            lineHeight: "var(--leading-ui-label)",
            letterSpacing: "var(--tracking-ui-label)",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
            fontWeight: "500",
          }}
        >
          {label}
        </label>
      )}
      <div style={{ position: "relative" }}>
        <input
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--type-body-md)",
            lineHeight: "var(--leading-body-md)",
            padding: "var(--space-3)",
            paddingRight:
              effectiveState === "verified" ? "var(--space-6)" : "var(--space-3)",
            background: "var(--surface-landing)",
            border: `1px solid ${
              effectiveState === "error"
                ? "var(--destructive-600)"
                : effectiveState === "focus"
                ? "var(--neutral-600)"
                : "var(--border-subtle)"
            }`,
            borderRadius: "var(--radius-input)",
            color: "var(--text-primary)",
            width: "100%",
            transition: "border-color var(--transition-default)",
            outline: "none",
          }}
          {...props}
        />
        {effectiveState === "verified" && (
          <div
            style={{
              position: "absolute",
              right: "var(--space-3)",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--accent-700)",
            }}
          >
            <Check size={20} />
          </div>
        )}
      </div>
      {effectiveState === "error" && errorMessage && (
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--type-body-sm)",
            lineHeight: "var(--leading-body-sm)",
            color: "var(--destructive-600)",
          }}
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
}
