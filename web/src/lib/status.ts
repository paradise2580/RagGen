import { humanizeEnum } from "./format";

/** Visual tone families used by StatusBadge / timeline / progress. */
export type StatusTone = "neutral" | "info" | "running" | "success" | "warning" | "danger";

interface StatusMeta {
  tone: StatusTone;
  label: string;
}

/**
 * Maps backend enum values (GenerationStatus, GenerationStepStatus,
 * AssetStatus, ProductStatus) onto a single visual vocabulary. Status is never
 * communicated by color alone — every consumer also renders a label/icon.
 */
const STATUS_MAP: Record<string, StatusMeta> = {
  // Generation / step
  DRAFT: { tone: "neutral", label: "Draft" },
  QUEUED: { tone: "info", label: "Queued" },
  PENDING: { tone: "neutral", label: "Pending" },
  RUNNING: { tone: "running", label: "Running" },
  SUCCEEDED: { tone: "success", label: "Completed" },
  FAILED: { tone: "danger", label: "Failed" },
  CANCELED: { tone: "warning", label: "Cancelled" },
  SKIPPED: { tone: "neutral", label: "Skipped" },
  // Asset
  READY: { tone: "success", label: "Ready" },
  ARCHIVED: { tone: "neutral", label: "Archived" },
  // Product
  ACTIVE: { tone: "success", label: "Active" },
};

export function statusMeta(value: string | null | undefined): StatusMeta {
  if (!value) return { tone: "neutral", label: "—" };
  return STATUS_MAP[value] ?? { tone: "neutral", label: humanizeEnum(value) };
}

export const ACTIVE_GENERATION_STATUSES = new Set(["QUEUED", "RUNNING"]);
