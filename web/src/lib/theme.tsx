import React from "react";

/* The app is light-only. The Theme type and context API are retained (the type
   still allows "dark") so existing consumers keep compiling, but the theme is
   always "light" and toggle/setter are no-ops.

   tokens.css defines a single :root token set, so data-theme is informational —
   useful when debugging, and for a host page that keys off it — but no selector
   in the stylesheet depends on it. */
type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function applyTheme(): void {
  document.documentElement.dataset.theme = "light";
  /* Keeps UA-rendered chrome (form controls, the overscroll gutter) light even
     before/if stylesheets are slow — otherwise a viewer whose OS is in dark mode
     gets a dark first paint the app then contradicts. */
  document.documentElement.style.colorScheme = "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    applyTheme();
  }, []);

  const noop = React.useCallback(() => {}, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme: "light", toggleTheme: noop, setTheme: noop }),
    [noop],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = React.useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within a ThemeProvider.");
  return value;
}
