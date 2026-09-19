import React from "react";

/**
 * Toast context + hook live in their own component-free module so their
 * identity stays stable across React Fast Refresh. Keeping the context object
 * out of the file that exports <ToastProvider> prevents HMR from minting a new
 * context on edit (which would leave already-mounted providers and freshly
 * rendered consumers pointing at different context objects).
 */

export type ToastTone = "info" | "success" | "error";

export interface ToastInput {
  tone: ToastTone;
  title: string;
  description?: string;
}

export interface ToastContextValue {
  notify: (toast: ToastInput) => void;
}

export const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const value = React.useContext(ToastContext);
  if (!value) throw new Error("useToast must be used within a ToastProvider.");
  return value;
}
