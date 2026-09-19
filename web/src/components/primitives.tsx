import React from "react";
import { Icon, type IconName } from "./Icon";
import { statusMeta, type StatusTone } from "../lib/status";
import "./primitives.css";

/* ------------------------------- Button -------------------------------- */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "subtle" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export function buttonClassName(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  extra?: string,
): string {
  return ["btn", `btn--${variant}`, `btn--${size}`, extra].filter(Boolean).join(" ");
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
  leftIcon?: IconName;
  rightIcon?: IconName;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    variant = "primary",
    size = "md",
    loading = false,
    block = false,
    leftIcon,
    rightIcon,
    className,
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClassName(
        variant,
        size,
        [block ? "btn--block" : "", loading ? "is-loading" : "", className]
          .filter(Boolean)
          .join(" "),
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <span className="btn__spinner" aria-hidden="true" /> : null}
      <span className="btn__content">
        {leftIcon ? <Icon name={leftIcon} size={16} /> : null}
        {children ? <span>{children}</span> : null}
        {rightIcon ? <Icon name={rightIcon} size={16} /> : null}
      </span>
    </button>
  );
});

/* ------------------------------ IconButton ----------------------------- */

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  variant?: "ghost" | "subtle" | "secondary";
  size?: ButtonSize;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = "ghost", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={["icon-btn", `icon-btn--${variant}`, `icon-btn--${size}`, className]
        .filter(Boolean)
        .join(" ")}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon name={icon} size={size === "sm" ? 16 : 18} />
    </button>
  );
});

/* -------------------------------- Badge -------------------------------- */

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: StatusTone | "accent";
  className?: string;
}) {
  return (
    <span className={["badge", `badge--${tone}`, className].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
}

/** Status pill that pairs a tone with a label + dot so status is never color-only. */
export function StatusBadge({ status, pulse }: { status: string; pulse?: boolean }) {
  const meta = statusMeta(status);
  return (
    <span className={`status-badge status-badge--${meta.tone}`}>
      <span
        className={["status-dot", pulse && meta.tone === "running" ? "status-dot--pulse" : ""]
          .filter(Boolean)
          .join(" ")}
        aria-hidden="true"
      />
      {meta.label}
    </span>
  );
}

/* -------------------------------- Card --------------------------------- */

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: "div" | "section" | "article";
  padding?: "none" | "sm" | "md" | "lg";
  interactive?: boolean;
}

export function Card({
  children,
  className,
  as: Tag = "div",
  padding = "md",
  interactive = false,
  ...props
}: CardProps) {
  return (
    <Tag
      className={["card", `card--pad-${padding}`, interactive ? "card--interactive" : "", className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </Tag>
  );
}

/* ------------------------------- Spinner ------------------------------- */

export function Spinner({ label = "Loading", size = 22 }: { label?: string; size?: number }) {
  return (
    <span
      className="spinner"
      role="status"
      aria-label={label}
      style={{ width: size, height: size }}
    />
  );
}

/* ------------------------------ Skeleton ------------------------------- */

export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={["skeleton", className].filter(Boolean).join(" ")}
      style={style}
      aria-hidden="true"
    />
  );
}

/* ------------------------------- Progress ------------------------------ */

export function ProgressBar({
  value,
  tone = "accent",
  indeterminate = false,
  showLabel = false,
}: {
  value: number;
  tone?: "accent" | "success" | "danger";
  indeterminate?: boolean;
  showLabel?: boolean;
}) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div className="progress-row">
      <div
        className={`progress progress--${tone}${indeterminate ? " progress--indeterminate" : ""}`}
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="progress__fill"
          style={indeterminate ? undefined : { width: `${clamped}%` }}
        />
      </div>
      {showLabel ? <span className="progress__label tnum">{clamped}%</span> : null}
    </div>
  );
}
