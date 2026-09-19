/** Shared, locale-aware formatting helpers (no fabricated data). */

const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFmt.format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFmt.format(date);
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function formatRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < hour) return rtf.format(Math.round(diffMs / minute), "minute");
  if (abs < day) return rtf.format(Math.round(diffMs / hour), "hour");
  if (abs < 30 * day) return rtf.format(Math.round(diffMs / day), "day");
  return formatDate(value);
}

/** Elapsed duration between two timestamps (or now), as m:ss / h:mm:ss. */
export function formatElapsed(start: string | null | undefined, end?: string | null): string {
  if (!start) return "—";
  const startMs = new Date(start).getTime();
  if (Number.isNaN(startMs)) return "—";
  const endMs = end ? new Date(end).getTime() : Date.now();
  const totalSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Converts an UPPER_SNAKE enum value into Title Case for display. */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Friendly, film-studio–themed labels for the raw pipeline stage names, so the
// user watches an engaging story unfold instead of engineering jargon. A short
// caption gives each step a sense of what's happening. Keys are the backend
// GenerationStep names (see lib/video-generator/pipeline.ts setStep calls).
export const PIPELINE_STEP_META: Record<string, { label: string; caption: string }> = {
  validate: { label: "Reviewing your product", caption: "Making sure your photos are camera-ready" },
  model_gen: { label: "Casting your model", caption: "Generating your AI model wearing the product" },
  tryon: { label: "Fitting your model", caption: "Trying your product on each model pose" },
  prompt: { label: "Directing the shoot", caption: "Writing the creative direction for your video" },
  model_prep: { label: "Setting the scene", caption: "Framing the perfect opening shot" },
  render: { label: "Rolling the cameras", caption: "Bringing your product to life, frame by frame" },
  // Only ever shown in QA enforce mode / with compositing configured — in shadow mode and
  // when either is inert the backend deliberately emits no step row for them.
  qa: { label: "Quality check", caption: "Reviewing the footage for brand accuracy" },
  composite: { label: "Brand polish", caption: "Locking your logo in pixel-perfect" },
  store: { label: "Final cut", caption: "Polishing and saving your finished video" },
};

/** Engaging display label for a pipeline stage name (falls back to Title Case). */
export function pipelineStepLabel(name: string | null | undefined): string {
  if (!name) return "Preparing…";
  return PIPELINE_STEP_META[name]?.label ?? humanizeEnum(name);
}

/** Short caption for a pipeline stage name, or null if none. */
export function pipelineStepCaption(name: string | null | undefined): string | null {
  return (name && PIPELINE_STEP_META[name]?.caption) || null;
}
