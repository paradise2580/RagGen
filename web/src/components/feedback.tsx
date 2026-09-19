import React from "react";
import { Icon, type IconName } from "./Icon";
import { Button } from "./primitives";
import "./feedback.css";

/* ------------------------------ EmptyState ----------------------------- */

export function EmptyState({
  icon = "sparkle",
  title,
  description,
  action,
  compact = false,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state${compact ? " empty-state--compact" : ""}`}>
      <span className="empty-state__icon" aria-hidden="true">
        <Icon name={icon} size={compact ? 20 : 26} />
      </span>
      <div className="empty-state__text">
        <strong>{title}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

/* ------------------------------ ErrorState ----------------------------- */

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  retryLabel = "Try again",
  compact = false,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
}) {
  return (
    <div className={`error-state${compact ? " error-state--compact" : ""}`} role="alert">
      <span className="error-state__icon" aria-hidden="true">
        <Icon name="alert" size={compact ? 18 : 22} />
      </span>
      <div className="error-state__text">
        <strong>{title}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" leftIcon="retry" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

/* --------------------------- InlineMessage ----------------------------- */

export function InlineMessage({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "error" | "success" | "info";
  children: React.ReactNode;
}) {
  const icon: IconName | null =
    tone === "error"
      ? "alert"
      : tone === "success"
        ? "check-circle"
        : tone === "info"
          ? "info"
          : null;
  return (
    <p
      className={`inline-message inline-message--${tone}`}
      role={tone === "error" ? "alert" : undefined}
    >
      {icon ? <Icon name={icon} size={15} /> : null}
      <span>{children}</span>
    </p>
  );
}

/* --------------------------------- Tabs -------------------------------- */

export interface TabItem {
  id: string;
  label: string;
  icon?: IconName;
  count?: number;
}

export function Tabs({
  tabs,
  active,
  onChange,
  ariaLabel,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={selected}
            className={`tab${selected ? " is-active" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.icon ? <Icon name={tab.icon} size={16} /> : null}
            {tab.label}
            {typeof tab.count === "number" ? (
              <span className="tab__count tnum">{tab.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
