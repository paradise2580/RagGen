import React from "react";
import { ErrorState } from "./feedback";
import { Spinner } from "./primitives";

const RELOAD_KEY = "vg:last-chunk-reload";
// Don't reload more than once inside this window, so a genuinely-broken chunk can't
// spin the page in an endless reload loop — after one attempt we show a real error.
const RELOAD_COOLDOWN_MS = 15_000;

/**
 * True when an error is a failed dynamic `import()` of a code-split chunk. This is
 * common right after a redeploy: the loaded index.html references old hash-named
 * chunks that no longer exist, and (because the app is served with an SPA fallback
 * that returns index.html for unknown paths) the stale chunk URL yields HTML instead
 * of JS — the browser refuses to execute it as a module and the import rejects.
 */
export function isChunkLoadError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")) || "";
  const name = err instanceof Error ? err.name : "";
  return (
    name === "ChunkLoadError" ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Loading chunk \S+ failed/i.test(msg) ||
    /expected a JavaScript(?:-or-Wasm)? module|MIME type|text\/html/i.test(msg)
  );
}

/**
 * Reload once to pick up the current build's index.html + chunks, guarded against an
 * infinite loop. Returns true if a reload was actually triggered.
 */
export function reloadForStaleChunkOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Number.isFinite(last) && Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage may be unavailable (private mode / sandboxed iframe). Fall through
    // and reload once anyway; a hard failure will surface as the error UI on the retry.
  }
  window.location.reload();
  return true;
}

interface State {
  error: Error | null;
  reloading: boolean;
}

/**
 * App-wide error boundary. Without one, ANY uncaught render error (or a failed
 * lazy-chunk import) unmounts the whole React tree and leaves a blank white screen.
 * This catches those: a stale-chunk error auto-reloads once to recover; anything else
 * renders a real error state the user can retry, instead of a white void.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  override state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error) {
    if (isChunkLoadError(error) && reloadForStaleChunkOnce()) {
      this.setState({ reloading: true });
      return;
    }
    // eslint-disable-next-line no-console
    console.error("[video-generator] uncaught UI error:", error);
  }

  override render() {
    if (this.state.reloading) {
      return (
        <div className="centered-screen">
          <Spinner label="Reloading" />
        </div>
      );
    }
    if (this.state.error) {
      return (
        <div className="centered-screen">
          <ErrorState
            title="Something went wrong"
            description="This page hit an unexpected error. Reloading usually fixes it."
            retryLabel="Reload"
            onRetry={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
