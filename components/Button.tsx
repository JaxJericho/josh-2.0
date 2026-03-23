import React from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonState = "default" | "hover" | "focus" | "disabled";
type ButtonSize = "small" | "medium" | "large";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  state?: ButtonState;
  size?: ButtonSize;
  children: React.ReactNode;
}

export function Button({
  variant = "primary",
  state = "default",
  size,
  children,
  disabled,
  className = "",
  ...props
}: ButtonProps) {
  const baseStyles = `
    font-family: var(--font-ui);
    font-size: var(--type-body-md);
    font-weight: 500;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-button);
    border: none;
    cursor: pointer;
    transition: all var(--transition-default);
    letter-spacing: var(--tracking-normal);
  `;

  const variantStyles: Record<ButtonVariant, string> = {
    primary: `
      background: var(--accent-700);
      color: var(--surface-landing);
      border: none;
    `,
    secondary: `
      background: transparent;
      color: var(--accent-700);
      border: 1px solid var(--accent-700);
    `,
    ghost: `
      background: transparent;
      color: var(--accent-700);
      border: none;
      padding: var(--space-2) var(--space-3);
    `,
    destructive: `
      background: var(--destructive-600);
      color: var(--surface-landing);
      border: none;
    `,
  };

  const disabledStyles = `
    opacity: 0.4;
    cursor: not-allowed;
  `;

  return (
    <button
      disabled={disabled || state === "disabled"}
      className={className}
      style={{
        ...parseStyles(baseStyles),
        ...parseStyles(variantStyles[variant]),
        ...(disabled || state === "disabled" ? parseStyles(disabledStyles) : {}),
      }}
      {...props}
    >
      {children}
    </button>
  );
}

function parseStyles(cssString: string): React.CSSProperties {
  const styles: Record<string, string> = {};
  cssString.split(";").forEach((rule) => {
    const colonIdx = rule.indexOf(":");
    if (colonIdx === -1) return;
    const prop = rule.slice(0, colonIdx).trim();
    const value = rule.slice(colonIdx + 1).trim();
    if (prop && value) {
      const camelProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      styles[camelProp] = value;
    }
  });
  return styles as React.CSSProperties;
}
