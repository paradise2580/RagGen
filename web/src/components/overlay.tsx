import React from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { Button, IconButton } from "./primitives";
import "./overlay.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/** Locks body scroll, traps focus, restores focus, and closes on Escape. */
function useOverlayBehavior(
  open: boolean,
  onClose: () => void,
  ref: React.RefObject<HTMLElement | null>,
) {
  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const node = ref.current;
    const focusable = node?.querySelectorAll<HTMLElement>(FOCUSABLE);
    focusable?.[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose, ref]);
}

/* -------------------------------- Modal -------------------------------- */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: ModalProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const descId = React.useId();
  useOverlayBehavior(open, onClose, ref);

  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={onClose}>
      <div
        ref={ref}
        className={`modal modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <h2 id={titleId} className="modal__title">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="modal__desc">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </header>
        {children ? <div className="modal__body">{children}</div> : null}
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------------------- ConfirmDialog ---------------------------- */

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

/* -------------------------------- Drawer ------------------------------- */

export function Drawer({
  open,
  onClose,
  title,
  children,
  side = "right",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  side?: "left" | "right";
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  useOverlayBehavior(open, onClose, ref);

  if (!open) return null;
  return createPortal(
    <div className="overlay overlay--drawer" onMouseDown={onClose}>
      <div
        ref={ref}
        className={`drawer drawer--${side}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="drawer__header">
          <h2 id={titleId} className="modal__title">
            {title}
          </h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </header>
        <div className="drawer__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/* ----------------------------- MediaViewer ----------------------------- */

/**
 * Full-bleed lightbox for previewing a single image or video over the page.
 * Reuses the overlay backdrop + focus trap / Escape / scroll-lock behavior,
 * but lets the media size itself to the viewport instead of a fixed modal box.
 */
export function MediaViewer({
  open,
  onClose,
  kind,
  src,
  alt,
  title,
  subtitle,
  onDownload,
}: {
  open: boolean;
  onClose: () => void;
  kind: "image" | "video";
  src?: string | null;
  alt: string;
  title?: string;
  subtitle?: string;
  onDownload?: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  useOverlayBehavior(open, onClose, ref);

  if (!open) return null;
  return createPortal(
    <div className="overlay overlay--lightbox" onMouseDown={onClose}>
      <div
        ref={ref}
        className="lightbox"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="lightbox__bar">
          <div className="lightbox__meta">
            {title ? (
              <strong id={titleId} className="lightbox__title">
                {title}
              </strong>
            ) : (
              <span id={titleId} className="sr-only">
                {alt}
              </span>
            )}
            {subtitle ? <span className="lightbox__sub">{subtitle}</span> : null}
          </div>
          <div className="lightbox__tools">
            {onDownload ? (
              <IconButton icon="download" label="Download" onClick={onDownload} />
            ) : null}
            <IconButton icon="x" label="Close" onClick={onClose} />
          </div>
        </header>
        <div className="lightbox__stage">
          {!src ? (
            <div className="media-placeholder" aria-hidden="true">
              <Icon name={kind === "video" ? "video" : "image"} size={32} />
            </div>
          ) : kind === "video" ? (
            <video
              className="lightbox__media"
              src={src}
              controls
              autoPlay
              playsInline
              preload="metadata"
            />
          ) : (
            <img className="lightbox__media" src={src} alt={alt} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ----------------------------- DropdownMenu ---------------------------- */

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: Parameters<typeof Icon>[0]["name"];
  destructive?: boolean;
  /** Marks the item as the current selection (highlighted + trailing check). */
  selected?: boolean;
}

export function DropdownMenu({
  trigger,
  items,
  align = "end",
  label,
}: {
  trigger: (props: {
    open: boolean;
    toggle: () => void;
    ref: React.Ref<HTMLButtonElement>;
  }) => React.ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  label: string;
}) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={containerRef}>
      {trigger({ open, toggle: () => setOpen((v) => !v), ref: triggerRef })}
      {open ? (
        <div className={`menu__list menu__list--${align}`} role="menu" aria-label={label}>
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitemradio"
              aria-checked={item.selected || undefined}
              type="button"
              className={`menu__item${item.destructive ? " menu__item--danger" : ""}${
                item.selected ? " is-selected" : ""
              }`}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon ? <Icon name={item.icon} size={16} /> : null}
              {item.label}
              {item.selected ? <Icon name="check" size={15} className="menu__item-check" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
