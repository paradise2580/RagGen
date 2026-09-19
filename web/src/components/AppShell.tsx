import { useQueryClient } from "@tanstack/react-query";
import React from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Icon, type IconName } from "./Icon";
import { BrandMark, BrandLockup } from "./Brand";
import { Button, IconButton } from "./primitives";
import "./app-shell.css";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
  /** Open in a new browser tab (used for studios). */
  newTab?: boolean;
  /** Render with the accent-gradient "primary action" treatment. */
  highlight?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: "overview", end: true },
  { to: "/brands", label: "Brand knowledge", icon: "shield" },
  { to: "/products", label: "Products", icon: "products" },
  { to: "/assets", label: "Video Library", icon: "assets" },
  { to: "/generate", label: "Create", icon: "plus", highlight: true },
  { to: "/generations", label: "Generations", icon: "generations" },
  { to: "/rag-usage", label: "AI usage & budget", icon: "overview" },
  { to: "/rag-evaluations", label: "RAG evaluations", icon: "shield" },
];

const COLLAPSE_KEY = "adstudio-sidebar-collapsed";

function userInitials(email?: string, name?: string | null): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return (email?.[0] ?? "?").toUpperCase();
}

/**
 * Ambient backdrop for the signed-in shell. Unlike the landing page's "electric" hero
 * (seen once, for seconds), this is on screen for entire work sessions — so it stays
 * slow, low-contrast, and fixed to the viewport (not the scroll position), the same
 * restraint a good screensaver uses. `pointer-events: none` and a negative z-index
 * keep it out of the way of everything else in the shell.
 */
function AmbientBackground() {
  return (
    <div className="app-ambient" aria-hidden="true">
      <span className="app-ambient__aura app-ambient__aura--1" />
      <span className="app-ambient__aura app-ambient__aura--2" />
      <span className="app-ambient__aura app-ambient__aura--3" />
      <span className="app-ambient__grid" />
    </div>
  );
}

function SidebarNav({
  items,
  ariaLabel,
  onNavigate,
}: {
  items: NavItem[];
  ariaLabel: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="sidebar__nav" aria-label={ariaLabel}>
      {items.map((item) =>
        item.newTab ? (
          <a
            key={item.to}
            href={item.to}
            target="_blank"
            rel="noopener noreferrer"
            className="sidebar__link"
            onClick={onNavigate}
          >
            <Icon name={item.icon} size={18} className="sidebar__link-icon" />
            <span className="sidebar__link-label">{item.label}</span>
          </a>
        ) : (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={`sidebar__link${item.highlight ? " sidebar__link--highlight" : ""}`}
            onClick={onNavigate}
          >
            <Icon name={item.icon} size={18} className="sidebar__link-icon" />
            <span className="sidebar__link-label">{item.label}</span>
          </NavLink>
        ),
      )}
    </nav>
  );
}

export function AppLayout() {
  const { user, workspaces, activeWorkspaceId, selectWorkspace, logout } = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return window.localStorage.getItem(COLLAPSE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, String(collapsed));
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  // Close the mobile drawer on route change.
  React.useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className={`app-shell${collapsed ? " app-shell--collapsed" : ""}`}>
      <AmbientBackground />
      <aside className="sidebar" data-mobile-open={mobileOpen}>
        <div className="sidebar__top">
          {/* RagGen logo — the full lockup when expanded, the bare mark when
              collapsed, since the wordmark is illegible at 72px of sidebar.

              A hard navigation (plain <a>, outside the SPA basename) returns to the
              dashboard. */}
          <a className="sidebar__brand" href="/video-generator/dashboard" aria-label="RagGen dashboard">
            {collapsed ? <BrandMark size={26} /> : <BrandLockup size={26} />}
          </a>
          <IconButton
            icon="sidebar"
            label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            variant="ghost"
            size="sm"
            className="sidebar__collapse"
            onClick={() => setCollapsed((v) => !v)}
          />
        </div>

        <div className="sidebar__nav-area">
          <SidebarNav
            items={NAV_ITEMS}
            ariaLabel="Primary"
            onNavigate={() => setMobileOpen(false)}
          />
        </div>
      </aside>

      {mobileOpen ? (
        <div className="sidebar__scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      ) : null}

      <div className="main-column">
        <header className="topbar">
          <div className="topbar__start">
            <IconButton
              icon="menu"
              label="Open navigation"
              variant="subtle"
              className="topbar__menu"
              onClick={() => setMobileOpen(true)}
            />
          </div>

          <div className="topbar__end">
            {workspaces.length > 1 && <select className="control" aria-label="Workspace" value={activeWorkspaceId || ""} onChange={e=>{selectWorkspace(e.target.value);queryClient.clear();window.location.assign("/video-generator/brands");}}>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>}
            <Button type="button" variant="secondary" size="sm" onClick={()=>void logout()}>Sign out</Button>
            <div className="user-trigger user-trigger--static">
              <span className="user-avatar" aria-hidden="true">
                {userInitials(user?.email, user?.displayName)}
              </span>
              <span className="user-trigger__email">{user?.email}</span>
            </div>
          </div>
        </header>

        <main className="content" id="main-content">
          <div className="content__inner">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * Top-navbar shell for the Home hub and its sibling pages (Pricing, Admin).
 *
 * Unlike {@link AppLayout}, this has no left sidebar — navigation lives in a
 * horizontal bar. Studios are reached from the "Studios" dropdown; selecting
 * one routes into the sidebar shell (`AppLayout`). Admin lives here (super
 * admins only) instead of the studio sidebar.
 */
export function HomeLayout() {
  const { user, isSuperAdmin } = useAuth();

  return (
    <div className="home-shell">
      <AmbientBackground />
      <header className="topnav">
        <div className="topnav__start">
          <Link className="topnav__brand" to="/dashboard" aria-label="RagGen dashboard">
            <BrandLockup size={26} />
          </Link>

          <nav className="topnav__links" aria-label="Primary">
            <NavLink to="/dashboard" end className="topnav__link">
              <Icon name="overview" size={16} />
              <span>Dashboard</span>
            </NavLink>
            <NavLink to="/generate" className="topnav__link">
              <Icon name="plus" size={16} />
              <span>Create</span>
            </NavLink>
            <NavLink to="/pricing" className="topnav__link">
              <Icon name="info" size={16} />
              <span>Pricing</span>
            </NavLink>
            {isSuperAdmin ? (
              <NavLink to="/admin" end className="topnav__link">
                <Icon name="shield" size={16} />
                <span>Admin</span>
              </NavLink>
            ) : null}
          </nav>
        </div>

        <div className="topnav__end">
          <div className="user-trigger user-trigger--static">
            <span className="user-avatar" aria-hidden="true">
              {userInitials(user?.email, user?.displayName)}
            </span>
            <span className="user-trigger__email">{user?.email}</span>
          </div>
        </div>
      </header>

      <main className="content" id="main-content">
        <div className="content__inner">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
