import React from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  BrandMark,
  Button,
  FormField,
  Icon,
  InlineMessage,
  Input,
  PasswordInput,
} from "../components";
import "./public.css";

function useAuthError(): [string | null, (error: unknown) => void, () => void] {
  const [error, setError] = React.useState<string | null>(null);
  const handle = React.useCallback((err: unknown) => {
    if (err instanceof ApiError) {
      setError(err.message);
      return;
    }
    if (err instanceof TypeError && err.message === "Failed to fetch") {
      setError("Cannot reach the API. Check that it is running and allows this web origin.");
      return;
    }
    if (err instanceof Error) {
      setError(err.message);
      return;
    }
    setError("Something went wrong. Please try again.");
  }, []);
  const clear = React.useCallback(() => setError(null), []);
  return [error, handle, clear];
}

const ASIDE_QUOTES = [
  "Product assets in. Campaign-ready creative out.",
  "Your next best-seller is one prompt away.",
  "Built for teams who move at the speed of launch.",
];

function AuthAside() {
  const items = [
    { icon: "products" as const, label: "Bring your own product catalog and assets" },
    { icon: "create" as const, label: "Configure briefs with a live prompt-plan preview" },
    { icon: "generations" as const, label: "Track durable generations end to end" },
  ];
  return (
    <aside className="auth__aside" aria-hidden="true">
      <span className="hero__aura hero__aura--1" style={{ top: "-10%", left: "-6%" }} />
      <span className="hero__aura hero__aura--2" style={{ top: "40%", right: "-14%" }} />
      <div className="auth__aside-content">
        <p className="auth__aside-quote">
          <span className="auth__aside-quote-cycle">
            {ASIDE_QUOTES.map((line, index) => (
              <span key={line} style={{ animationDelay: `${index * 4}s` }}>
                {line}
              </span>
            ))}
          </span>
        </p>
        <div className="auth__aside-list">
          {items.map((item) => (
            <div className="auth__aside-item" key={item.label}>
              <span className="icon-chip">
                <Icon name={item.icon} size={15} />
              </span>
              {item.label}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function AuthBrand() {
  return (
    <Link className="public-brand auth__form-head" to="/">
      <BrandMark size={28} />
      RagGen
    </Link>
  );
}

export function LoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, handleError, clearError] = useAuthError();

  if (status === "authenticated") return <Navigate to="/dashboard" replace />;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    clearError();
    setSubmitting(true);
    try {
      await login(email, password);
      void navigate("/dashboard");
    } catch (err) {
      handleError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth__form-col">
        <AuthBrand />
        <div className="auth__form-wrap">
          <div className="auth-card">
            <h1 className="auth-card__title">Welcome back</h1>
            <p className="auth-card__sub">Log in to your RagGen workspace.</p>
            <form className="auth-form" onSubmit={(e) => void onSubmit(e)} noValidate>
              <FormField label="Email" htmlFor="email">
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  leftIcon="user"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </FormField>
              <FormField label="Password" htmlFor="password">
                <PasswordInput
                  id="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </FormField>
              {error ? <InlineMessage tone="error">{error}</InlineMessage> : null}
              <Button type="submit" size="lg" block loading={submitting}>
                Log in
              </Button>
            </form>
            <p className="auth-alt">
              No account? <Link to="/register">Create one</Link>
            </p>
          </div>
        </div>
      </div>
      <AuthAside />
    </div>
  );
}

export function RegisterPage() {
  const { register, status } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [workspaceName, setWorkspaceName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, handleError, clearError] = useAuthError();

  const passwordTooShort = password.length > 0 && password.length < 8;

  if (status === "authenticated") return <Navigate to="/dashboard" replace />;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) return;
    clearError();
    setSubmitting(true);
    try {
      await register({
        email,
        password,
        displayName: displayName || undefined,
        workspaceName: workspaceName || undefined,
      });
      void navigate("/dashboard");
    } catch (err) {
      handleError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth__form-col">
        <AuthBrand />
        <div className="auth__form-wrap">
          <div className="auth-card">
            <h1 className="auth-card__title">Create your account</h1>
            <p className="auth-card__sub">Start generating product ads in minutes.</p>
            <form className="auth-form" onSubmit={(e) => void onSubmit(e)} noValidate>
              <FormField label="Name" htmlFor="displayName" optional>
                <Input
                  id="displayName"
                  type="text"
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </FormField>
              <FormField label="Email" htmlFor="email">
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  leftIcon="user"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </FormField>
              <FormField
                label="Password"
                htmlFor="password"
                hint="At least 8 characters."
                error={passwordTooShort ? "Use at least 8 characters." : null}
              >
                <PasswordInput
                  id="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  invalid={passwordTooShort}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </FormField>
              <FormField label="Workspace name" htmlFor="workspaceName" optional>
                <Input
                  id="workspaceName"
                  type="text"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                />
              </FormField>
              {error ? <InlineMessage tone="error">{error}</InlineMessage> : null}
              <Button
                type="submit"
                size="lg"
                block
                loading={submitting}
                disabled={passwordTooShort}
              >
                Create account
              </Button>
            </form>
            <p className="auth-alt">
              Already have an account? <Link to="/login">Log in</Link>
            </p>
          </div>
        </div>
      </div>
      <AuthAside />
    </div>
  );
}
