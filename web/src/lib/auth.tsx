import React from "react";
import { Navigate } from "react-router-dom";
import {
  API_BASE_URL,
  setAccessToken,
  setActiveWorkspaceId,
  setRefreshHandler,
  type AuthSession,
  type UserSummary,
  type WorkspaceSummary,
} from "./api";

const ACTIVE_WORKSPACE_KEY = "active-workspace-id";

// RagGen has its own email/password auth (see /api/video-generator/auth/[action] and
// lib/rag-auth.ts). The SPA is served same-origin at /video-generator; it bootstraps its
// session from GET /api/video-generator/session, which reads the "raggen-session" cookie set
// by /auth/login and /auth/register.

interface AuthState {
  status: "loading" | "authenticated" | "anonymous";
  user: UserSummary | null;
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    displayName?: string;
    workspaceName?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  selectWorkspace: (workspaceId: string) => void;
  activeWorkspace: WorkspaceSummary | null;
  isSuperAdmin: boolean;
  /** Re-runs the session bootstrap (used by the gate's retry). */
  reauthenticate: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

function readStoredWorkspace(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AuthState>({
    status: "loading",
    user: null,
    workspaces: [],
    activeWorkspaceId: null,
  });

  const applySession = React.useCallback((session: AuthSession) => {
    const stored = readStoredWorkspace();
    const activeWorkspaceId =
      stored && session.workspaces.some((w) => w.id === stored)
        ? stored
        : session.defaultWorkspaceId;
    setAccessToken(session.accessToken);
    setActiveWorkspaceId(activeWorkspaceId);
    try {
      window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, activeWorkspaceId);
    } catch {
      /* ignore storage failures */
    }
    setState({
      status: "authenticated",
      user: session.user,
      workspaces: session.workspaces,
      activeWorkspaceId,
    });
  }, []);

  const clearSession = React.useCallback(() => {
    setAccessToken(null);
    setActiveWorkspaceId(null);
    setState({ status: "anonymous", user: null, workspaces: [], activeWorkspaceId: null });
  }, []);

  // Bootstrap from the session cookie. A 401 means there is no active session, so the
  // route gate falls through to the sign-in page.
  const bootstrap = React.useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/video-generator/session`, {
        method: "GET",
        credentials: "include",
        // Never serve a cached identity — always reflect the live session.
        cache: "no-store",
      });
      if (res.ok) {
        applySession((await res.json()) as AuthSession);
        return true;
      }
    } catch {
      /* fall through */
    }
    return false;
  }, [applySession]);

  // The API client's 401 handler re-checks the session once before failing.
  React.useEffect(() => {
    setRefreshHandler(bootstrap);
    return () => setRefreshHandler(null);
  }, [bootstrap]);

  React.useEffect(() => {
    let cancelled = false;
    void bootstrap().then((ok) => {
      if (!cancelled && !ok) clearSession();
    });
    return () => {
      cancelled = true;
    };
  }, [bootstrap, clearSession]);

  // Re-sync identity whenever the tab regains focus/visibility. The SPA is a
  // long-lived single page; if the user signs in as someone else in another tab,
  // returning here must reflect the CURRENT session — not the user this tab first
  // booted with.
  React.useEffect(() => {
    const resync = () => {
      if (document.visibilityState === "visible") void bootstrap();
    };
    window.addEventListener("focus", resync);
    document.addEventListener("visibilitychange", resync);
    return () => {
      window.removeEventListener("focus", resync);
      document.removeEventListener("visibilitychange", resync);
    };
  }, [bootstrap]);

  const login = React.useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API_BASE_URL}/api/video-generator/auth/login`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    if (!res.ok) throw new Error((await res.json()).message || "Sign-in failed");
    if (!await bootstrap()) throw new Error("No workspace membership is available for this account.");
  }, [bootstrap]);
  const register = React.useCallback(async (input: {
    email: string;
    password: string;
    displayName?: string;
    workspaceName?: string;
  }) => {
    const res = await fetch(`${API_BASE_URL}/api/video-generator/auth/register`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    if (!res.ok) throw new Error((await res.json()).message || "Sign-up failed");
    if (!await bootstrap()) throw new Error("No workspace membership is available for this account.");
  }, [bootstrap]);

  const logout = React.useCallback(async () => {
    await fetch(`${API_BASE_URL}/api/video-generator/auth/logout`, { method: "POST", credentials: "include" });
    clearSession();
    try {
      window.location.assign("/video-generator/login");
    } catch {
      /* ignore */
    }
  }, [clearSession]);

  const reauthenticate = React.useCallback(async () => {
    setState((prev) => ({ ...prev, status: "loading" }));
    const ok = await bootstrap();
    if (!ok) clearSession();
  }, [bootstrap, clearSession]);

  const selectWorkspace = React.useCallback((workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
    try {
      window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);
    } catch {
      /* ignore */
    }
    setState((prev) => ({ ...prev, activeWorkspaceId: workspaceId }));
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      register,
      logout,
      selectWorkspace,
      activeWorkspace: state.workspaces.find((w) => w.id === state.activeWorkspaceId) ?? null,
      isSuperAdmin: state.user?.platformRole === "SUPER_ADMIN",
      reauthenticate,
    }),
    [state, login, register, logout, selectWorkspace, reauthenticate],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = React.useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }
  return value;
}

function LoadingScreen() {
  return (
    <div className="centered-screen">
      <span
        className="spinner"
        role="status"
        aria-label="Loading"
        style={{ width: 28, height: 28 }}
      />
    </div>
  );
}

/** Gates protected routes. No session → the login page. */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  if (status === "loading") return <LoadingScreen />;
  if (status === "anonymous") return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Gates SuperAdmin-only governance routes; non-admins are redirected to the app. */
export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { status, isSuperAdmin } = useAuth();
  if (status === "loading") return <LoadingScreen />;
  if (status === "anonymous") return <Navigate to="/login" replace />;
  if (!isSuperAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
