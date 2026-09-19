import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { Navigate, RouterProvider, createBrowserRouter } from "react-router-dom";
import { AdminRoute, AuthProvider, ProtectedRoute } from "./lib/auth";
import { LoginPage, RegisterPage } from "./pages/auth";
import { LandingPage } from "./pages/landing";
import { ThemeProvider } from "./lib/theme";
import { AppLayout, HomeLayout } from "./components/AppShell";
import { ToastProvider, Spinner } from "./components";
import { ErrorBoundary, isChunkLoadError } from "./components/ErrorBoundary";
import "./styles/tokens.css";
import "./styles/base.css";

const RagOperationsPage = lazyNamed(() => import("./pages/rag-operations"), "RagOperationsPage");
const RagEvaluationsPage = lazyNamed(() => import("./pages/rag-operations"), "RagEvaluationsPage");
const BrandsPage = lazyNamed(() => import("./pages/brands"), "BrandsPage");
const DashboardPage = lazyNamed(() => import("./pages/dashboard"), "DashboardPage");
const PricingPage = lazyNamed(() => import("./pages/pricing"), "PricingPage");
const ProductsPage = lazyNamed(() => import("./pages/products"), "ProductsPage");
const ProductDetailPage = lazyNamed(() => import("./pages/products"), "ProductDetailPage");
const AssetsPage = lazyNamed(() => import("./pages/assets"), "AssetsPage");
const GeneratePage = lazyNamed(() => import("./pages/generate"), "GeneratePage");
const GenerationsPage = lazyNamed(() => import("./pages/generations"), "GenerationsPage");
const GenerationDetailPage = lazyNamed(() => import("./pages/generations"), "GenerationDetailPage");
const AdminOverviewPage = lazyNamed(() => import("./pages/admin"), "AdminOverviewPage");
const AdminUsersPage = lazyNamed(() => import("./pages/admin"), "AdminUsersPage");
const AdminUserDetailPage = lazyNamed(() => import("./pages/admin"), "AdminUserDetailPage");
const AdminGenerationsPage = lazyNamed(() => import("./pages/admin"), "AdminGenerationsPage");
const AdminProvidersPage = lazyNamed(() => import("./pages/admin"), "AdminProvidersPage");
const AdminPromptEnginePage = lazyNamed(
  () => import("./pages/prompt-engine"),
  "AdminPromptEnginePage",
);

/** Lazy-loads a named export as a default-exporting module. On a transient chunk-fetch
 * failure it retries the import once (after a short delay) before surfacing the error to
 * the ErrorBoundary, which reloads for a truly stale chunk. */
function lazyNamed<M, K extends keyof M>(
  loader: () => Promise<M>,
  name: K,
): React.LazyExoticComponent<React.ComponentType<unknown>> {
  return React.lazy(async () => {
    try {
      const mod = await loader();
      return { default: mod[name] as React.ComponentType<unknown> };
    } catch (err) {
      if (!isChunkLoadError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 400));
      const mod = await loader();
      return { default: mod[name] as React.ComponentType<unknown> };
    }
  });
}

function RouteFallback() {
  return (
    <div className="centered-screen">
      <Spinner label="Loading page" />
    </div>
  );
}

function Suspended({ children }: { children: React.ReactNode }) {
  // Per-route boundary: a render error (or stale-chunk import) in one page shows a
  // recoverable error state rather than blanking the whole app shell.
  return (
    <ErrorBoundary>
      <React.Suspense fallback={<RouteFallback />}>{children}</React.Suspense>
    </ErrorBoundary>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  {
    // Public landing page. Redirects signed-in visitors straight to /dashboard itself.
    path: "/",
    element: <LandingPage />,
  },
  { path: "login", element: <LoginPage /> },
  { path: "register", element: <RegisterPage /> },
  {
    // Top-navbar shell: the sibling pages (Pricing, Admin) render here with no
    // left sidebar.
    element: (
      <ProtectedRoute>
        <HomeLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        path: "pricing",
        element: (
          <Suspended>
            <PricingPage />
          </Suspended>
        ),
      },
      {
        path: "admin",
        element: (
          <AdminRoute>
            <Suspended>
              <AdminOverviewPage />
            </Suspended>
          </AdminRoute>
        ),
      },
      {
        path: "admin/users",
        element: (
          <AdminRoute>
            <Suspended>
              <AdminUsersPage />
            </Suspended>
          </AdminRoute>
        ),
      },
      {
        path: "admin/users/:userId",
        element: (
          <AdminRoute>
            <Suspended>
              <AdminUserDetailPage />
            </Suspended>
          </AdminRoute>
        ),
      },
      {
        path: "admin/generations",
        element: (
          <AdminRoute>
            <Suspended>
              <AdminGenerationsPage />
            </Suspended>
          </AdminRoute>
        ),
      },
      {
        path: "admin/providers",
        element: (
          <AdminRoute>
            <Suspended>
              <AdminProvidersPage />
            </Suspended>
          </AdminRoute>
        ),
      },
      {
        path: "admin/prompt-engine",
        element: (
          <AdminRoute>
            <Suspended>
              <AdminPromptEnginePage />
            </Suspended>
          </AdminRoute>
        ),
      },
    ],
  },
  {
    // Sidebar shell: the Commerce Catalogue working surface. All the
    // services (Products, Assets, Generations, …) render here with the
    // left sidebar nav.
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        path: "dashboard",
        element: (
          <Suspended>
            <DashboardPage />
          </Suspended>
        ),
      },
      {
        path: "rag-usage", element: <Suspended><RagOperationsPage /></Suspended>,
      },
      { path: "rag-evaluations", element: <Suspended><RagEvaluationsPage /></Suspended> },
      {
        path: "brands",
        element: <Suspended><BrandsPage /></Suspended>,
      },
      {
        path: "products",
        element: (
          <Suspended>
            <ProductsPage />
          </Suspended>
        ),
      },
      {
        path: "products/:productId",
        element: (
          <Suspended>
            <ProductDetailPage />
          </Suspended>
        ),
      },
      {
        path: "assets",
        element: (
          <Suspended>
            <AssetsPage />
          </Suspended>
        ),
      },
      {
        path: "generate",
        element: (
          <Suspended>
            <GeneratePage />
          </Suspended>
        ),
      },
      {
        path: "generations",
        element: (
          <Suspended>
            <GenerationsPage />
          </Suspended>
        ),
      },
      {
        path: "generations/:generationId",
        element: (
          <Suspended>
            <GenerationDetailPage />
          </Suspended>
        ),
      },
    ],
  },
  { path: "*", element: <Navigate to="/dashboard" replace /> },
],
  // Served full-page by the Next.js app under /video-generator (Vite base + Next rewrite).
  { basename: "/video-generator" },
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <a className="skip-link" href="#main-content">
                Skip to content
              </a>
              <RouterProvider router={router} />
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
