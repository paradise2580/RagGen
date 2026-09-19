import React from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "./Icon";
import { Button } from "./primitives";
import { statusMeta } from "../lib/status";
import "./layout.css";

/* ------------------------------ PageHeader ----------------------------- */

export interface Breadcrumb {
  label: string;
  to?: string;
}

export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  actions,
}: {
  title: string;
  subtitle?: string;
  breadcrumbs?: Breadcrumb[];
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__lead">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            {breadcrumbs.map((crumb, index) => (
              <React.Fragment key={`${crumb.label}-${index}`}>
                {crumb.to ? (
                  <Link to={crumb.to}>{crumb.label}</Link>
                ) : (
                  <span aria-current="page">{crumb.label}</span>
                )}
                {index < breadcrumbs.length - 1 ? (
                  <Icon name="chevron-right" size={13} aria-hidden="true" />
                ) : null}
              </React.Fragment>
            ))}
          </nav>
        ) : null}
        <h1 className="page-header__title">{title}</h1>
        {subtitle ? <p className="page-header__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

/* ----------------------------- SectionHeader --------------------------- */

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="section-header">
      <div>
        <h2 className="section-header__title">{title}</h2>
        {description ? <p className="section-header__desc">{description}</p> : null}
      </div>
      {actions ? <div className="section-header__actions">{actions}</div> : null}
    </div>
  );
}

/* ------------------------------ DataToolbar ---------------------------- */

export function DataToolbar({
  children,
  end,
}: {
  children?: React.ReactNode;
  end?: React.ReactNode;
}) {
  return (
    <div className="data-toolbar">
      <div className="data-toolbar__start">{children}</div>
      {end ? <div className="data-toolbar__end">{end}</div> : null}
    </div>
  );
}

/* -------------------------------- Pager -------------------------------- */

/** Page-by-page navigation for long lists/grids (Previous / "Page X of Y" / Next).
 *  Renders nothing when there's a single page. Page numbers are 1-based. */
export function Pager({
  page,
  pageCount,
  onPageChange,
  label = "Pages",
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  label?: string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav className="pager" aria-label={label}>
      <Button
        variant="secondary"
        size="sm"
        leftIcon="chevron-left"
        disabled={page <= 1}
        onClick={() => onPageChange(Math.max(1, page - 1))}
      >
        Previous
      </Button>
      <span className="pager__status" aria-live="polite">
        Page {page} of {pageCount}
      </span>
      <Button
        variant="secondary"
        size="sm"
        rightIcon="chevron-right"
        disabled={page >= pageCount}
        onClick={() => onPageChange(Math.min(pageCount, page + 1))}
      >
        Next
      </Button>
    </nav>
  );
}

/* -------------------------------- StatCard ----------------------------- */

export function StatCard({
  label,
  value,
  icon,
  to,
}: {
  label: string;
  value: React.ReactNode;
  icon: IconName;
  to?: string;
}) {
  const inner = (
    <>
      <span className="stat-card__icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <span className="stat-card__body">
        <span className="stat-card__value tnum">{value}</span>
        <span className="stat-card__label">{label}</span>
      </span>
      {to ? <Icon name="arrow-right" size={16} className="stat-card__arrow" /> : null}
    </>
  );
  if (to) {
    return (
      <Link className="stat-card stat-card--link" to={to}>
        {inner}
      </Link>
    );
  }
  return <div className="stat-card">{inner}</div>;
}

/* ------------------------------- Timeline ------------------------------ */

const STEP_ICON: Record<string, IconName> = {
  success: "check-circle",
  running: "clock",
  danger: "x-circle",
  warning: "alert",
  info: "clock",
  neutral: "clock",
};

export interface TimelineStep {
  id: string;
  name: string;
  status: string;
  error?: string | null;
  detail?: string | null;
}

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="timeline">
      {steps.map((step) => {
        const meta = statusMeta(step.status);
        return (
          <li key={step.id} className={`timeline__step timeline__step--${meta.tone}`}>
            <span className="timeline__marker" aria-hidden="true">
              <Icon name={STEP_ICON[meta.tone] ?? "clock"} size={15} />
            </span>
            <div className="timeline__content">
              <div className="timeline__row">
                <span className="timeline__name">{step.name}</span>
                <span className="timeline__status">{meta.label}</span>
              </div>
              {step.detail ? <p className="timeline__detail">{step.detail}</p> : null}
              {step.error ? <p className="timeline__error">{step.error}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
