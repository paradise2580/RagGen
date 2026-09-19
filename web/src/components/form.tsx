import React from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";
import "./form.css";

function useFieldId(provided?: string): string {
  const reactId = React.useId();
  return provided ?? `fld-${reactId}`;
}

/* ------------------------------ FormField ------------------------------ */

export interface FormFieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  children: React.ReactNode;
}

export function FormField({ label, htmlFor, hint, error, optional, children }: FormFieldProps) {
  const errorId = error && htmlFor ? `${htmlFor}-error` : undefined;
  return (
    <div className={`field${error ? " field--error" : ""}`}>
      <label className="field__label" htmlFor={htmlFor}>
        <span>{label}</span>
        {optional ? <span className="field__optional">Optional</span> : null}
      </label>
      {children}
      {error ? (
        <p className="field__error" id={errorId} role="alert">
          <Icon name="alert" size={14} />
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint">{hint}</p>
      ) : null}
    </div>
  );
}

/* -------------------------------- Input -------------------------------- */

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  leftIcon?: IconName;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, leftIcon, ...props },
  ref,
) {
  if (leftIcon) {
    return (
      <div className={`input-wrap${invalid ? " is-invalid" : ""}`}>
        <Icon name={leftIcon} size={16} className="input-wrap__icon" />
        <input
          ref={ref}
          className={["control", "control--has-icon", className].filter(Boolean).join(" ")}
          aria-invalid={invalid || undefined}
          {...props}
        />
      </div>
    );
  }
  return (
    <input
      ref={ref}
      className={["control", invalid ? "is-invalid" : "", className].filter(Boolean).join(" ")}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
});

/* --------------------------- PasswordInput ----------------------------- */

export const PasswordInput = React.forwardRef<HTMLInputElement, InputProps>(function PasswordInput(
  { className, invalid, ...props },
  ref,
) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className={`input-wrap input-wrap--trailing${invalid ? " is-invalid" : ""}`}>
      <input
        ref={ref}
        type={visible ? "text" : "password"}
        className={["control", "control--has-trailing", className].filter(Boolean).join(" ")}
        aria-invalid={invalid || undefined}
        {...props}
      />
      <button
        type="button"
        className="input-wrap__action"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
      >
        <Icon name={visible ? "x-circle" : "info"} size={16} />
      </button>
    </div>
  );
});

/* ------------------------------ Textarea ------------------------------- */

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, rows = 3, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={["control", "control--textarea", invalid ? "is-invalid" : "", className]
        .filter(Boolean)
        .join(" ")}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
});

/* -------------------------------- Select ------------------------------- */

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(function Select({ className, invalid, children, ...props }, ref) {
  return (
    <div className="select-wrap">
      <select
        ref={ref}
        className={["control", "control--select", invalid ? "is-invalid" : "", className]
          .filter(Boolean)
          .join(" ")}
        aria-invalid={invalid || undefined}
        {...props}
      >
        {children}
      </select>
      <Icon name="chevron-down" size={16} className="select-wrap__chevron" />
    </div>
  );
});

/* ------------------------------ SelectMenu ----------------------------- */

export interface SelectMenuOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Returns the next non-disabled option index walking in `dir` (wraps). */
function nextEnabledIndex(options: SelectMenuOption[], from: number, dir: 1 | -1): number {
  const n = options.length;
  if (n === 0) return -1;
  let i = from;
  for (let c = 0; c < n; c++) {
    i = (i + dir + n) % n;
    if (!options[i]?.disabled) return i;
  }
  return from;
}

/**
 * Themed single-select dropdown. Unlike the native {@link Select}, the option
 * list is fully styleable (it follows the app theme on every platform) and
 * keyboard accessible (Up/Down/Enter/Escape, click-outside to dismiss).
 */
export function SelectMenu({
  options,
  value,
  onChange,
  placeholder = "Select…",
  id,
  invalid,
  disabled,
  "aria-label": ariaLabel,
}: {
  options: SelectMenuOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  // The open list is portaled to <body> so it can never be clipped by a scrolling
  // ancestor (e.g. a modal body with overflow:auto). It's positioned with fixed
  // coordinates measured from the trigger.
  const [menuRect, setMenuRect] = React.useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const listId = React.useId();
  const selected = options.find((o) => o.value === value) ?? null;

  const updatePosition = React.useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const margin = 6;
    const maxListHeight = 260;
    const spaceBelow = window.innerHeight - rect.bottom;
    // Flip above the trigger when there isn't room below but there is above.
    if (spaceBelow < maxListHeight + margin && rect.top > spaceBelow) {
      setMenuRect({
        left: rect.left,
        width: rect.width,
        bottom: window.innerHeight - rect.top + margin,
      });
    } else {
      setMenuRect({ left: rect.left, width: rect.width, top: rect.bottom + margin });
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    // Keep the list anchored to the trigger while scrolling/resizing.
    const onReposition = () => updatePosition();
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open, updatePosition]);

  // Keep the highlighted option scrolled into view during keyboard navigation.
  React.useEffect(() => {
    if (!open || activeIndex < 0) return;
    document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, listId]);

  const openMenu = () => {
    if (disabled) return;
    setActiveIndex(options.findIndex((o) => o.value === value));
    updatePosition();
    setOpen(true);
  };

  const choose = (option: SelectMenuOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => nextEnabledIndex(options, i, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => nextEnabledIndex(options, i, -1));
        break;
      case "Enter":
      case " ": {
        event.preventDefault();
        const option = options[activeIndex];
        if (option) choose(option);
        break;
      }
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div className={`select-menu${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        className={`control control--select-menu${invalid ? " is-invalid" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className={`select-menu__value${selected ? "" : " select-menu__value--placeholder"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <Icon name="chevron-down" size={16} className="select-menu__chevron" />
      </button>
      {open && menuRect
        ? createPortal(
            <ul
              ref={listRef}
              className="select-menu__list select-menu__list--portal"
              role="listbox"
              id={listId}
              aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
              style={{
                left: menuRect.left,
                width: menuRect.width,
                right: "auto",
                top: menuRect.top ?? "auto",
                bottom: menuRect.bottom ?? "auto",
              }}
            >
              {options.map((option, index) => {
                const isSelected = option.value === value;
                return (
                  <li
                    key={option.value || `opt-${index}`}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    className={[
                      "select-menu__option",
                      index === activeIndex ? "is-active" : "",
                      isSelected ? "is-selected" : "",
                      option.disabled ? "is-disabled" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(option)}
                  >
                    <Icon
                      name="check"
                      size={14}
                      className="select-menu__check"
                      aria-hidden="true"
                    />
                    <span className="select-menu__option-label">{option.label}</span>
                  </li>
                );
              })}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}

/* ------------------------------ Checkbox ------------------------------- */

export function Checkbox({
  label,
  id,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  const fieldId = useFieldId(id);
  return (
    <label className="checkbox" htmlFor={fieldId}>
      <input type="checkbox" id={fieldId} {...props} />
      <span className="checkbox__box" aria-hidden="true">
        <Icon name="check" size={13} />
      </span>
      <span className="checkbox__label">{label}</span>
    </label>
  );
}

/* --------------------------- RadioCardGroup ---------------------------- */

export interface RadioCardOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: IconName;
  disabled?: boolean;
}

export function RadioCardGroup<T extends string>({
  name,
  value,
  options,
  onChange,
  columns = 1,
  legend,
}: {
  name: string;
  value: T;
  options: ReadonlyArray<RadioCardOption<T>>;
  onChange: (value: T) => void;
  columns?: 1 | 2 | 3;
  legend?: string;
}) {
  return (
    <fieldset
      className="radio-cards"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {legend ? <legend className="visually-hidden">{legend}</legend> : null}
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            className={`radio-card${checked ? " is-checked" : ""}${
              option.disabled ? " is-disabled" : ""
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span className="radio-card__indicator" aria-hidden="true">
              <Icon name="check" size={12} />
            </span>
            <span className="radio-card__body">
              <span className="radio-card__title">
                {option.icon ? <Icon name={option.icon} size={16} /> : null}
                {option.label}
              </span>
              {option.description ? (
                <span className="radio-card__desc">{option.description}</span>
              ) : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
