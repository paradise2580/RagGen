import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import {
  useAdminGenerations,
  useAdminOverview,
  useAdminProviders,
  useAdminUser,
  useAdminUsers,
} from "../lib/queries";
import { ACTIVE_GENERATION_STATUSES } from "../lib/status";
import { serviceLabel, modelLabel } from "../lib/generation-options";
import { formatDate, formatRelative, humanizeEnum } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataToolbar,
  EmptyState,
  ErrorState,
  FormField,
  Icon,
  Input,
  Modal,
  PasswordInput,
  PageHeader,
  ProgressBar,
  SelectMenu,
  Skeleton,
  StatCard,
  StatusBadge,
  useToast,
} from "../components";
import "./pages.css";
import "./admin.css";

const STATUS_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "RUNNING", label: "Running" },
  { value: "QUEUED", label: "Queued" },
  { value: "SUCCEEDED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
  { value: "CANCELED", label: "Cancelled" },
];

const PLATFORM_ROLE_OPTIONS = [
  { value: "USER", label: "User" },
  { value: "SUPER_ADMIN", label: "SuperAdmin" },
];

const ACCOUNT_STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "DISABLED", label: "Disabled" },
];

function RoleBadge({ role }: { role: string }) {
  return role === "SUPER_ADMIN" ? (
    <Badge tone="accent">
      <Icon name="shield" size={12} />
      SuperAdmin
    </Badge>
  ) : (
    <Badge>User</Badge>
  );
}

function UserStatusBadge({ status }: { status: string }) {
  return <Badge tone={status === "ACTIVE" ? "success" : "danger"}>{humanizeEnum(status)}</Badge>;
}

/* ============================ Overview ================================= */

export function AdminOverviewPage() {
  const { data, isLoading, isError, refetch } = useAdminOverview();

  return (
    <div className="route-view">
      <PageHeader
        title="Platform overview"
        subtitle="Governance across every user, workspace, and generation on the platform."
      />

      {isError ? (
        <ErrorState
          description="Could not load platform overview."
          onRetry={() => void refetch()}
        />
      ) : isLoading || !data ? (
        <div className="grid-cards grid-stats">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} style={{ height: 76 }} />
          ))}
        </div>
      ) : (
        <div className="stack">
          <div className="grid-cards grid-stats">
            <StatCard label="Users" value={data.totalUsers} icon="user" to="/admin/users" />
            <StatCard label="SuperAdmins" value={data.superAdminCount} icon="shield" />
            <StatCard label="Workspaces" value={data.totalWorkspaces} icon="workspace" />
            <StatCard label="Products" value={data.totalProducts} icon="products" />
            <StatCard
              label="Generations"
              value={data.totalGenerations}
              icon="generations"
              to="/admin/generations"
            />
            <StatCard label="Active now" value={data.activeGenerations} icon="create" />
          </div>

          <Card padding="lg">
            <h2 className="card-title">Governance</h2>
            <div className="row-list">
              <Link className="row-link" to="/admin/prompt-engine">
                <span className="row-link__main">
                  <span className="row-link__title">Prompt engine</span>
                  <span className="row-link__sub">
                    Live config, pipeline health, and prompt-quality evals
                  </span>
                </span>
                <Icon name="chevron-right" size={16} className="row-link__chevron" />
              </Link>
              <Link className="row-link" to="/admin/providers">
                <span className="row-link__main">
                  <span className="row-link__title">Providers</span>
                  <span className="row-link__sub">
                    LLM and genAI tool catalog with usage and enablement
                  </span>
                </span>
                <Icon name="chevron-right" size={16} className="row-link__chevron" />
              </Link>
            </div>
          </Card>

          <Card padding="lg">
            <h2 className="card-title">Generations by status</h2>
            <div className="admin-chips">
              {Object.entries(data.generationsByStatus).map(([status, count]) => (
                <span key={status} className="admin-chip">
                  <StatusBadge status={status} />
                  <strong className="tnum">{count}</strong>
                </span>
              ))}
            </div>
          </Card>

          <Card padding="lg">
            <h2 className="card-title">Newest users</h2>
            {data.recentUsers.length === 0 ? (
              <EmptyState compact icon="user" title="No users yet" />
            ) : (
              <div className="row-list">
                {data.recentUsers.map((u) => (
                  <Link key={u.id} className="row-link" to={`/admin/users/${u.id}`}>
                    <span className="row-link__main">
                      <span className="row-link__title">{u.displayName || u.email}</span>
                      <span className="row-link__sub">{u.email}</span>
                    </span>
                    <RoleBadge role={u.platformRole} />
                    <span className="row-link__sub tnum">{formatRelative(u.createdAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

/* ============================== Users ================================== */

interface CreateUserForm {
  email: string;
  password: string;
  displayName: string;
  platformRole: string;
}

const EMPTY_CREATE_FORM: CreateUserForm = {
  email: "",
  password: "",
  displayName: "",
  platformRole: "USER",
};

/** SuperAdmin-only dialog to provision a new platform account. */
function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [form, setForm] = React.useState<CreateUserForm>(EMPTY_CREATE_FORM);

  const createUser = useMutation({
    mutationFn: (body: CreateUserForm) =>
      api.post("/api/admin/users", {
        email: body.email.trim(),
        password: body.password,
        platformRole: body.platformRole,
        ...(body.displayName.trim() ? { displayName: body.displayName.trim() } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
      notify({ tone: "success", title: "User created" });
      setForm(EMPTY_CREATE_FORM);
      onClose();
    },
    onError: (err) =>
      notify({
        tone: "error",
        title: "Could not create user",
        description: err instanceof Error ? err.message : undefined,
      }),
  });

  const set = <K extends keyof CreateUserForm>(key: K, value: CreateUserForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const canSubmit = form.email.trim().length > 3 && form.password.length >= 8;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create user"
      description="Provisions an account with its own workspace. They can sign in immediately."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={createUser.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => createUser.mutate(form)}
            disabled={!canSubmit || createUser.isPending}
          >
            {createUser.isPending ? "Creating…" : "Create user"}
          </Button>
        </>
      }
    >
      <form
        className="stack stack--sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !createUser.isPending) createUser.mutate(form);
        }}
      >
        <FormField label="Email" htmlFor="create-user-email">
          <Input
            id="create-user-email"
            type="email"
            autoComplete="off"
            placeholder="person@company.com"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </FormField>
        <FormField
          label="Temporary password"
          htmlFor="create-user-password"
          hint="At least 8 characters."
        >
          <PasswordInput
            id="create-user-password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
          />
        </FormField>
        <FormField label="Display name" htmlFor="create-user-name" optional>
          <Input
            id="create-user-name"
            placeholder="Jane Doe"
            value={form.displayName}
            onChange={(e) => set("displayName", e.target.value)}
          />
        </FormField>
        <FormField label="Platform role" htmlFor="create-user-role">
          <SelectMenu
            id="create-user-role"
            value={form.platformRole}
            onChange={(value) => set("platformRole", value)}
            options={PLATFORM_ROLE_OPTIONS}
          />
        </FormField>
      </form>
    </Modal>
  );
}

export function AdminUsersPage() {
  const { data, isLoading, isError, refetch } = useAdminUsers();
  const [search, setSearch] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);

  const users = data ?? [];
  const term = search.trim().toLowerCase();
  const filtered = term
    ? users.filter(
        (u) =>
          u.email.toLowerCase().includes(term) ||
          (u.displayName ?? "").toLowerCase().includes(term),
      )
    : users;

  return (
    <div className="route-view">
      <PageHeader
        title="Users"
        subtitle="Every account on the platform. Open a user to view their dashboard and manage access."
        actions={
          <Button variant="primary" size="sm" leftIcon="plus" onClick={() => setCreateOpen(true)}>
            New user
          </Button>
        }
      />

      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} />

      <DataToolbar>
        <div style={{ width: 280 }}>
          <Input
            leftIcon="search"
            placeholder="Search by email or name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search users"
          />
        </div>
      </DataToolbar>

      {isError ? (
        <ErrorState description="Could not load users." onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="row-list">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} style={{ height: 60 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState compact icon="search" title="No users match this search" />
      ) : (
        <div className="row-list">
          {filtered.map((u) => (
            <Link key={u.id} className="row-link" to={`/admin/users/${u.id}`}>
              <span className="user-avatar" aria-hidden="true">
                {(u.displayName?.[0] ?? u.email[0] ?? "?").toUpperCase()}
              </span>
              <span className="row-link__main">
                <span className="row-link__title">{u.displayName || u.email}</span>
                <span className="row-link__sub">{u.email}</span>
              </span>
              <span className="admin-meta-col">
                <span className="row-link__sub tnum">{u.workspaceCount} workspaces</span>
                <span className="row-link__sub tnum">{u.generationCount} generations</span>
              </span>
              <RoleBadge role={u.platformRole} />
              <UserStatusBadge status={u.status} />
              <Icon name="chevron-right" size={16} className="row-link__chevron" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================== User detail =============================== */

export function AdminUserDetailPage() {
  const params = useParams();
  const userId = params.userId ?? "";
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const { data, isLoading, isError, refetch } = useAdminUser(userId);

  const updateUser = useMutation({
    mutationFn: (body: { status?: string; platformRole?: string }) =>
      api.patch(`/api/admin/users/${userId}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
      notify({ tone: "success", title: "User updated" });
    },
    onError: (err) =>
      notify({
        tone: "error",
        title: "Update failed",
        description: err instanceof Error ? err.message : undefined,
      }),
  });

  if (isError) {
    return (
      <div className="route-view">
        <ErrorState title="Could not load this user" onRetry={() => void refetch()} />
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="route-view stack">
        <Skeleton style={{ height: 36, width: 240 }} />
        <Skeleton style={{ height: 90 }} />
        <Skeleton style={{ height: 200 }} />
      </div>
    );
  }

  const { user, workspaces, stats, recentGenerations } = data;

  return (
    <div className="route-view">
      <PageHeader
        title={user.displayName || user.email}
        breadcrumbs={[{ label: "Users", to: "/admin/users" }, { label: user.email }]}
        subtitle={user.email}
        actions={
          <Link
            className="row-link__sub"
            to={`/admin/generations?user=${user.id}`}
            style={{ alignSelf: "center" }}
          >
            View all generations →
          </Link>
        }
      />

      <div className="stack">
        <Card padding="lg">
          <div className="admin-access">
            <div className="admin-access__field">
              <label className="field__label" htmlFor="user-role">
                Platform role
              </label>
              <SelectMenu
                id="user-role"
                value={user.platformRole}
                disabled={updateUser.isPending}
                onChange={(value) => updateUser.mutate({ platformRole: value })}
                options={PLATFORM_ROLE_OPTIONS}
              />
            </div>
            <div className="admin-access__field">
              <label className="field__label" htmlFor="user-status">
                Account status
              </label>
              <SelectMenu
                id="user-status"
                value={user.status}
                disabled={updateUser.isPending}
                onChange={(value) => updateUser.mutate({ status: value })}
                options={ACCOUNT_STATUS_OPTIONS}
              />
            </div>
            <div className="admin-access__meta">
              <span className="row-link__sub">Joined {formatDate(user.createdAt)}</span>
            </div>
          </div>
        </Card>

        <div className="grid-cards grid-stats">
          <StatCard label="Generations" value={stats.generationCount} icon="generations" />
          <StatCard label="Active" value={stats.activeGenerationCount} icon="create" />
          <StatCard label="Products" value={stats.productCount} icon="products" />
          <StatCard label="Assets" value={stats.assetCount} icon="assets" />
        </div>

        <Card padding="lg">
          <h2 className="card-title">Workspaces</h2>
          {workspaces.length === 0 ? (
            <EmptyState compact icon="workspace" title="No workspaces" />
          ) : (
            <div className="row-list">
              {workspaces.map((w) => (
                <div key={w.id} className="row-link" style={{ cursor: "default" }}>
                  <span className="row-link__main">
                    <span className="row-link__title">{w.name}</span>
                    <span className="row-link__sub">{w.memberCount} members</span>
                  </span>
                  <Badge tone={w.role === "OWNER" ? "accent" : undefined}>
                    {humanizeEnum(w.role)}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card padding="lg">
          <h2 className="card-title">Recent generations</h2>
          {recentGenerations.length === 0 ? (
            <EmptyState compact icon="generations" title="No generations yet" />
          ) : (
            <div className="row-list">
              {recentGenerations.map((g) => {
                const active = ACTIVE_GENERATION_STATUSES.has(g.status);
                return (
                  <div key={g.id} className="row-link" style={{ cursor: "default" }}>
                    <span className="row-link__main">
                      <span className="row-link__title">{serviceLabel(g.serviceType)}</span>
                      <span className="row-link__sub">
                        {modelLabel(g.modelType)} · {formatRelative(g.createdAt)}
                      </span>
                    </span>
                    {active ? (
                      <span style={{ width: 120 }}>
                        <ProgressBar value={g.progress} showLabel />
                      </span>
                    ) : null}
                    <StatusBadge status={g.status} pulse={active} />
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ===================== Generations (user-wise) ========================= */

export function AdminGenerationsPage() {
  const [userId, setUserId] = React.useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("user") ?? "";
  });
  const [status, setStatus] = React.useState("");
  const { data: users } = useAdminUsers();
  const { data, isLoading, isError, refetch, isFetching } = useAdminGenerations({
    userId: userId || undefined,
    status: status || undefined,
  });

  const generations = data ?? [];

  return (
    <div className="route-view">
      <PageHeader
        title="Generations"
        subtitle="Every generation across the platform, filterable by user."
      />

      <DataToolbar
        end={
          isFetching && !isLoading ? (
            <span className="row-link__sub" aria-live="polite">
              Refreshing…
            </span>
          ) : null
        }
      >
        <div style={{ width: 240 }}>
          <SelectMenu
            value={userId}
            onChange={(value) => setUserId(value)}
            aria-label="Filter by user"
            options={[
              { value: "", label: "All users" },
              ...(users ?? []).map((u) => ({ value: u.id, label: u.email })),
            ]}
          />
        </div>
        <div style={{ width: 180 }}>
          <SelectMenu
            value={status}
            onChange={(value) => setStatus(value)}
            aria-label="Filter by status"
            options={STATUS_FILTERS}
          />
        </div>
      </DataToolbar>

      {isError ? (
        <ErrorState description="Could not load generations." onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="row-list">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ height: 64 }} />
          ))}
        </div>
      ) : generations.length === 0 ? (
        <EmptyState compact icon="generations" title="No generations match these filters" />
      ) : (
        <div className="row-list">
          {generations.map((g) => {
            const active = ACTIVE_GENERATION_STATUSES.has(g.status);
            return (
              <div key={g.id} className="row-link" style={{ cursor: "default" }}>
                <span className="row-link__main">
                  <span className="row-link__title">{serviceLabel(g.serviceType)}</span>
                  <span className="row-link__sub">
                    {g.userEmail ?? "Unknown user"} · {g.workspaceName} ·{" "}
                    {formatRelative(g.createdAt)}
                  </span>
                </span>
                {active ? (
                  <span style={{ width: 140 }}>
                    <ProgressBar value={g.progress} showLabel />
                  </span>
                ) : null}
                {g.userId ? (
                  <Link className="row-link__sub" to={`/admin/users/${g.userId}`}>
                    View user →
                  </Link>
                ) : null}
                <StatusBadge status={g.status} pulse={active} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================= Providers =============================== */

export function AdminProvidersPage() {
  const { data, isLoading, isError, refetch } = useAdminProviders();
  const queryClient = useQueryClient();
  const { notify } = useToast();

  const updateProvider = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/api/admin/providers/${id}`, { enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "providers"] });
    },
    onError: (err) =>
      notify({
        tone: "error",
        title: "Could not update provider",
        description: err instanceof Error ? err.message : undefined,
      }),
  });

  return (
    <div className="route-view">
      <PageHeader
        title="Providers"
        subtitle="Governance catalog of the LLMs and genAI tools available to the platform."
      />

      {isError ? (
        <ErrorState description="Could not load providers." onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="grid-cards grid-providers">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ height: 200 }} />
          ))}
        </div>
      ) : (
        <div className="grid-cards grid-providers">
          {data.map((p) => (
            <Card key={p.id} padding="lg" className={p.enabled ? "" : "provider-card--off"}>
              <div className="provider-card__head">
                <div>
                  <h3 className="provider-card__name">{p.label}</h3>
                  <Badge>{p.category}</Badge>
                </div>
                <Checkbox
                  checked={p.enabled}
                  disabled={updateProvider.isPending}
                  onChange={(e) => updateProvider.mutate({ id: p.id, enabled: e.target.checked })}
                  label={p.enabled ? "Enabled" : "Disabled"}
                />
              </div>

              {p.description ? <p className="provider-card__desc">{p.description}</p> : null}

              {p.capabilities.length > 0 ? (
                <div className="provider-card__caps">
                  {p.capabilities.map((cap) => (
                    <span key={cap} className="provider-cap">
                      {cap}
                    </span>
                  ))}
                </div>
              ) : null}

              {p.models.length > 0 ? (
                <p className="provider-card__models">
                  <span className="provider-card__models-label">Models</span>
                  {p.models.join(", ")}
                </p>
              ) : null}

              <dl className="provider-usage">
                <div>
                  <dt>Requests</dt>
                  <dd className="tnum">{p.usage.total}</dd>
                </div>
                <div>
                  <dt>Succeeded</dt>
                  <dd className="tnum">{p.usage.succeeded}</dd>
                </div>
                <div>
                  <dt>Failed</dt>
                  <dd className="tnum">{p.usage.failed}</dd>
                </div>
              </dl>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
