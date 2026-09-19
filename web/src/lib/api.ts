/**
 * Browser API client for the studio.
 *
 * - Same-origin: the SPA is served at /video-generator and talks to the Next.js routes
 *   under /api/video-generator/* — so API_BASE_URL is empty by default and every
 *   short "/api/..." path is transparently remapped to "/api/video-generator/...".
 * - Auth is the app's own SESSION COOKIE (credentials: "include"); there is no bearer
 *   token. The active workspace id (from /api/video-generator/session) is sent via
 *   `x-workspace-id`.
 */

import { normalizeImageForUpload } from "./image-normalize";

export const API_BASE_URL = readStringEnv(import.meta.env.VITE_API_BASE_URL, "");

function readStringEnv(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** Remap the SPA's short "/api/..." paths onto the "/api/video-generator/..." namespace. */
function toApiPath(path: string): string {
  return path.startsWith("/api/") ? `/api/video-generator${path.slice(4)}` : path;
}

let accessToken: string | null = null;
let activeWorkspaceId: string | null = null;
let refreshHandler: (() => Promise<boolean>) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setActiveWorkspaceId(id: string | null): void {
  activeWorkspaceId = id;
}

export function setRefreshHandler(handler: (() => Promise<boolean>) | null): void {
  refreshHandler = handler;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function buildHeaders(hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  if (hasBody) headers["Content-Type"] = "application/json";
  // No Authorization bearer — the session cookie authenticates the request.
  if (activeWorkspaceId) headers["x-workspace-id"] = activeWorkspaceId;
  return headers;
}

async function parseError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(data.message)) return data.message.join(", ");
    if (typeof data.message === "string") return data.message;
  } catch {
    /* fall through */
  }
  return `Request failed with status ${response.status}.`;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  allowRetry = true,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${toApiPath(path)}`, {
    method,
    credentials: "include",
    headers: buildHeaders(body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && allowRetry && refreshHandler) {
    const refreshed = await refreshHandler();
    if (refreshed) {
      return request<T>(method, path, body, false);
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, await parseError(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function workspaceHeaders(): Record<string,string> { return activeWorkspaceId ? { "x-workspace-id": activeWorkspaceId } : {}; }

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

/**
 * Same-origin proxy upload: POST the file to our own API, which writes it to storage
 * server-side and returns the READY asset. Replaces the old presign → direct
 * browser-PUT-to-S3 → confirm flow, which the browser can't do because the bucket
 * has no CORS rule for a cross-origin PUT (the preflight 403s). Talking only to our
 * own origin avoids CORS entirely.
 */
export async function uploadAsset(file: File): Promise<ConfirmUploadResponse> {
  // AVIF decodes in the browser but is unreadable to OpenAI and Kling, so it is
  // re-encoded to JPEG here rather than being stored and failing at render time. Every
  // upload site funnels through this function, which is why the conversion lives here and
  // not in a component. See lib/image-normalize.ts.
  const prepared = await normalizeImageForUpload(file);

  const form = new FormData();
  form.append("file", prepared);
  form.append("type", "PRODUCT_IMAGE");

  // Raw fetch (not `request()`): multipart needs the browser to set its own
  // Content-Type boundary, and we still send the session cookie + workspace header.
  const headers: Record<string, string> = {};
  if (activeWorkspaceId) headers["x-workspace-id"] = activeWorkspaceId;

  const response = await fetch(`${API_BASE_URL}/api/video-generator/assets/upload`, {
    method: "POST",
    credentials: "include",
    headers,
    body: form,
  });
  if (!response.ok) {
    throw new ApiError(response.status, await parseError(response));
  }
  return (await response.json()) as ConfirmUploadResponse;
}

export interface BatchUploadResult {
  assets: Asset[];
  warnings: string[];
  failures: { fileName: string; message: string }[];
}

/** Uploads many files concurrently, collecting partial successes and failures. */
export async function uploadAssets(files: File[]): Promise<BatchUploadResult> {
  const settled = await Promise.allSettled(files.map((file) => uploadAsset(file)));
  const assets: Asset[] = [];
  const warnings: string[] = [];
  const failures: { fileName: string; message: string }[] = [];

  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      assets.push(outcome.value.asset);
      warnings.push(...outcome.value.warnings);
    } else {
      const reason: unknown = outcome.reason;
      failures.push({
        fileName: files[index]?.name ?? "image",
        message: reason instanceof Error ? reason.message : "Upload failed.",
      });
    }
  });

  return { assets, warnings, failures };
}

// ----- Shared response shapes -----

export type PlatformRole = "USER" | "SUPER_ADMIN";

export interface UserSummary {
  id: string;
  email: string;
  displayName?: string | null;
  status: string;
  platformRole: PlatformRole;
  createdAt: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
}

export interface AuthSession {
  accessToken: string;
  accessTokenExpiresInSeconds: number;
  user: UserSummary;
  workspaces: WorkspaceSummary[];
  defaultWorkspaceId: string;
}

export interface Product {
  id: string;
  name: string;
  description?: string | null;
  productUrl?: string | null;
  brand?: string | null;
  category?: string | null;
  sku?: string | null;
  tags: string[];
  status: string;
  imageAssetIds: string[];
  thumbnailUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Body for POST /api/products/create. `images` are public image URLs, in priority order:
 * the first becomes the product's primary generation frame. Uploading a device file to
 * get such a URL is what uploadAssets() is for — pass the resulting `asset.cdnUrl`.
 */
export interface CreateProductInput {
  name: string;
  brand?: string;
  category?: string;
  description?: string;
  images: string[];
}

export interface Asset {
  id: string;
  type: string;
  source: string;
  status: string;
  productId?: string | null;
  mime?: string | null;
  width?: number | null;
  height?: number | null;
  cdnUrl?: string | null;
  createdAt: string;
}

export interface CreateUploadUrlResponse {
  assetId: string;
  uploadUrl: string;
  key: string;
  bucket: string;
  expiresInSeconds: number;
}

export interface ConfirmUploadResponse {
  asset: Asset;
  warnings: string[];
}

export interface GenerationStep {
  id: string;
  name: string;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
}

export interface GenerationJob {
  id: string;
  serviceType: string;
  modelType?: string | null;
  status: string;
  progress: number;
  error?: string | null;
  productName?: string | null;
  generationNumber?: number | null;
  outputAssetIds: string[];
  /** Personalized Model: per-pose virtual-try-on frames the video is built from
   * (public URLs). Empty for non-try-on jobs. */
  tryonImageUrls?: string[];
  /** Same frames with their user-entered angle label (front, back, …). */
  tryonImages?: { url: string; angle: string | null }[];
  steps: GenerationStep[];
  createdAt: string;
  updatedAt: string;
}

export interface PromptTemplatePreview {
  profileKey: string;
  label: string;
  format: "video";
  subjectMode: string;
  describeMode: "product" | "model" | "both";
  defaultSceneCount: number;
  minSceneCount: number;
  maxSceneCount: number;
  /** Composed Stage-2 prompt-model system prompt (base + format addendum). */
  systemInstructions: string;
  /** Stage-1 vision describe system prompt. */
  describeSystem: string;
  /** Kling output contract the prompt model must satisfy. */
  klingContract: string;
  /** Provenance of the active config: DB version, or null when using defaults. */
  configVersion: number | null;
  configSource: "db" | "default";
}

export interface DownloadUrlResponse {
  url: string;
  expiresInSeconds: number;
}

// ----- Admin & Governance (SuperAdmin only) -----

export interface AdminUser {
  id: string;
  email: string;
  displayName?: string | null;
  status: string;
  platformRole: PlatformRole;
  createdAt: string;
  workspaceCount: number;
  generationCount: number;
}

export interface AdminUserWorkspace {
  id: string;
  name: string;
  slug: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  memberCount: number;
}

export interface AdminUserDetail {
  user: UserSummary & { emailVerifiedAt?: string | null };
  workspaces: AdminUserWorkspace[];
  stats: {
    productCount: number;
    generationCount: number;
    activeGenerationCount: number;
    assetCount: number;
  };
  recentGenerations: GenerationJob[];
}

export interface AdminGeneration extends GenerationJob {
  userId: string | null;
  userEmail: string | null;
  workspaceId: string;
  workspaceName: string;
}

export interface AdminWorkspace {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string | null;
  memberCount: number;
  generationCount: number;
  productCount: number;
  createdAt: string;
}

export interface AdminOverview {
  totalUsers: number;
  superAdminCount: number;
  disabledUsers: number;
  totalWorkspaces: number;
  totalProducts: number;
  totalGenerations: number;
  activeGenerations: number;
  generationsByStatus: Record<string, number>;
  recentUsers: AdminUser[];
}

export interface ProviderConfig {
  id: string;
  key: string;
  label: string;
  category: string;
  enabled: boolean;
  description?: string | null;
  capabilities: string[];
  models: string[];
  usage: { total: number; succeeded: number; failed: number };
  createdAt: string;
  updatedAt: string;
}

// ----- Prompt-engine config governance (SuperAdmin only) -----

export interface ActivePromptEngineConfig {
  /** DB version, or null when falling back to the package defaults. */
  version: number | null;
  source: "db" | "default";
  /** The full PromptEngineConfig blob (validated server-side on save). */
  config: Record<string, unknown>;
}

export interface PromptEngineConfigVersion {
  version: number;
  isActive: boolean;
  note: string | null;
  createdById: string | null;
  createdAt: string;
}

// ----- Prompt-quality evals (SuperAdmin only) -----

export type EvalRunStatus = "RUNNING" | "SUCCEEDED" | "FAILED";

export interface EvalCase {
  id: string;
  key: string;
  title: string;
  enabled: boolean;
  format: "video";
  profileKey: string;
  expectedTraits: string[];
  forbiddenTraits: string[];
}

export interface EvalRunSummary {
  id: string;
  status: EvalRunStatus;
  configVersion: number | null;
  configSource: string;
  totalCases: number;
  passedCases: number;
  averageScore: number | null;
  error: string | null;
  createdById: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface EvalResult {
  id: string;
  caseKey: string;
  caseTitle: string;
  passed: boolean;
  score: number;
  missingExpected: string[];
  presentForbidden: string[];
}

export interface EvalRunDetail extends EvalRunSummary {
  results: EvalResult[];
}
