import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./auth";
import {
  api,
  type ActivePromptEngineConfig,
  type AdminGeneration,
  type AdminOverview,
  type AdminUser,
  type AdminUserDetail,
  type AdminWorkspace,
  type Asset,
  type EvalCase,
  type EvalRunDetail,
  type EvalRunSummary,
  type GenerationJob,
  type Product,
  type PromptEngineConfigVersion,
  type ProviderConfig,
} from "./api";

/** Query key prefix that scopes cached data to the active workspace. */
export function useWorkspaceKey(): string {
  return useAuth().activeWorkspaceId ?? "none";
}

export function useProducts() {
  const ws = useWorkspaceKey();
  return useQuery({
    queryKey: ["products", ws],
    queryFn: () => api.get<Product[]>("/api/products"),
  });
}

export function useAssets() {
  const ws = useWorkspaceKey();
  return useQuery({
    queryKey: ["assets", ws],
    queryFn: () => api.get<Asset[]>("/api/assets"),
  });
}

export function useGenerations() {
  const ws = useWorkspaceKey();
  return useQuery({
    queryKey: ["generations", ws],
    queryFn: () => api.get<GenerationJob[]>("/api/generations"),
  });
}

// ----- Admin & Governance (SuperAdmin only) -----

export function useAdminOverview() {
  return useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api.get<AdminOverview>("/api/admin/overview"),
  });
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.get<AdminUser[]>("/api/admin/users"),
  });
}

export function useAdminUser(userId: string | undefined) {
  return useQuery({
    queryKey: ["admin", "users", userId],
    queryFn: () => api.get<AdminUserDetail>(`/api/admin/users/${userId}`),
    enabled: Boolean(userId),
  });
}

export function useAdminGenerations(filters: { userId?: string; status?: string }) {
  const params = new URLSearchParams();
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.status) params.set("status", filters.status);
  const query = params.toString();
  return useQuery({
    queryKey: ["admin", "generations", filters.userId ?? "all", filters.status ?? "all"],
    queryFn: () => api.get<AdminGeneration[]>(`/api/admin/generations${query ? `?${query}` : ""}`),
  });
}

export function useAdminWorkspaces() {
  return useQuery({
    queryKey: ["admin", "workspaces"],
    queryFn: () => api.get<AdminWorkspace[]>("/api/admin/workspaces"),
  });
}

export function useAdminProviders() {
  return useQuery({
    queryKey: ["admin", "providers"],
    queryFn: () => api.get<ProviderConfig[]>("/api/admin/providers"),
  });
}

// ----- Prompt engine: config + evals (SuperAdmin only) -----

export function usePromptEngineConfig() {
  return useQuery({
    queryKey: ["admin", "prompt-config"],
    queryFn: () => api.get<ActivePromptEngineConfig>("/api/admin/prompt-config"),
  });
}

export function usePromptEngineVersions() {
  return useQuery({
    queryKey: ["admin", "prompt-config", "versions"],
    queryFn: () => api.get<PromptEngineConfigVersion[]>("/api/admin/prompt-config/versions"),
  });
}

export function useEvalCases() {
  return useQuery({
    queryKey: ["admin", "evals", "cases"],
    queryFn: () => api.get<EvalCase[]>("/api/admin/evals/cases"),
  });
}

export function useEvalRuns() {
  return useQuery({
    queryKey: ["admin", "evals", "runs"],
    queryFn: () => api.get<EvalRunSummary[]>("/api/admin/evals/runs"),
  });
}

export function useEvalRun(id: string | undefined) {
  return useQuery({
    queryKey: ["admin", "evals", "runs", id],
    queryFn: () => api.get<EvalRunDetail>(`/api/admin/evals/runs/${id}`),
    enabled: Boolean(id),
  });
}
