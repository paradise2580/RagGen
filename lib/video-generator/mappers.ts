// lib/video-generator/mappers.ts
//
// Shape database rows into the exact JSON the studio SPA expects. Two notable mappings:
//
//  - Products are ProductRecords. We expose the product's image URLs (resolved from
//    payload) as `imageAssetIds`. The SPA treats
//    these as opaque ids for selection and passes them back as productImageAssetIds;
//    the generation pipeline is URL-aware (an "asset id" that starts with http IS the
//    image URL). Real uploaded assets (e.g. a model photo) use cuid ids resolved from
//    the GenerationAsset table.
//  - Generated media lives in the GenerationAsset table (video_generator_assets).

import { resolveProductImages } from "@/lib/video-generator/product-images";
import { normalizePublicUrl } from "@/lib/video-generator/storage";

type AnyRecord = Record<string, any>;

function deriveProductName(pr: AnyRecord): string {
  if (pr.title && String(pr.title).trim()) return String(pr.title);
  const p = pr.payload || {};
  return (
    p.title || p.name || p.product_title || p.handle || p.externalHandle || "Untitled product"
  );
}

function deriveDescription(pr: AnyRecord): string | null {
  const enriched = pr.enriched_data || pr.enriched_draft;
  if (enriched && typeof enriched === "object") {
    const d = enriched.description || enriched.body_html || enriched.longDescription;
    if (typeof d === "string" && d.trim()) return d;
  }
  const p = pr.payload || {};
  const d = p.description || p.body_html || p.bodyHtml;
  return typeof d === "string" && d.trim() ? d : null;
}

/** Map a tenant ProductRecord to the Video Generator SPA Product shape. */
export function mapProductRecord(pr: AnyRecord) {
  const { images, primaryImage } = resolveProductImages({
    id: pr.id,
    platform: pr.platform,
    payload: pr.payload,
  });
  return {
    id: pr.id as string,
    name: deriveProductName(pr),
    description: deriveDescription(pr),
    productUrl: (pr.payload?.url || pr.payload?.onlineStoreUrl || null) as string | null,
    brand: (pr.payload?.vendor || pr.payload?.brand || null) as string | null,
    category: (pr.payload?.product_type || pr.payload?.category || null) as string | null,
    sku: (pr.skuAny || null) as string | null,
    tags: Array.isArray(pr.payload?.tags) ? pr.payload.tags : [],
    status: "ACTIVE" as const,
    // image URLs double as the selectable "asset ids" (see file header)
    imageAssetIds: images,
    thumbnailUrl: primaryImage,
    createdAt: (pr.ingestedAt ?? pr.createdAt ?? new Date()).toISOString?.() ?? null,
    updatedAt: (pr.updatedAt ?? new Date()).toISOString?.() ?? null,
  };
}

/** Map a GenerationAsset row to the SPA Asset shape. `cdnUrl` may be overridden. */
export function mapGenerationAsset(asset: AnyRecord, cdnUrl?: string | null) {
  return {
    id: asset.id as string,
    type: asset.type as string,
    source: asset.source as string,
    status: asset.status as string,
    productId: (asset.productId as string | null) ?? null,
    mime: asset.mime ?? null,
    size: asset.size ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
    duration: asset.duration ?? null,
    cdnUrl: normalizePublicUrl(cdnUrl !== undefined ? cdnUrl : (asset.cdnUrl ?? null)),
    createdAt: asset.createdAt?.toISOString?.() ?? null,
    updatedAt: asset.updatedAt?.toISOString?.() ?? null,
  };
}

// User-safe generation error text. Any stored error that isn't on this allow-list
// — raw exceptions (S3/IAM, DB, provider internals), legacy pre-abstraction rows,
// stack traces — is coerced to GENERIC_ERROR so the end user never sees technical
// detail. This is the single choke point: even a future raw fail() string can't
// leak through the API. Keep GENERIC_ERROR in sync with USER_FACING_ERROR in
// lib/video-generator/pipeline.ts.
const GENERIC_ERROR = "Something went wrong while generating your video. Please try again.";
const SAFE_ERROR_MESSAGES = new Set<string>([
  GENERIC_ERROR,
  "No valid product images available for generation.",
  "Provider reported success but returned no output.",
  "The video service couldn't complete this generation. Please try again.",
  "Generation timed out waiting for the provider.",
  // Personalized Model (virtual try-on) curated failures.
  "No valid model pose images available for generation.",
  "Missing product or model pose images for try-on.",
  "Couldn't pair your product photos with the model poses. Please try again.",
  "No try-on pairs to generate.",
  "Virtual try-on didn't produce any usable images. Please try again.",
]);

/** Coerce a stored error to a user-safe string (or null when there's no error). */
function safeError(msg: unknown): string | null {
  if (msg == null) return null;
  const s = String(msg);
  return SAFE_ERROR_MESSAGES.has(s) ? s : GENERIC_ERROR;
}

export function mapGenerationStep(step: AnyRecord) {
  return {
    id: step.id as string,
    name: step.name as string,
    status: step.status as string,
    startedAt: step.startedAt?.toISOString?.() ?? null,
    completedAt: step.completedAt?.toISOString?.() ?? null,
    error: safeError(step.error),
  };
}

/** Map a GenerationJob (+steps) to the SPA GenerationJob shape. */
export function mapGenerationJob(
  job: AnyRecord,
  extra: { productName?: string | null; generationNumber?: number | null } = {},
) {
  const steps = Array.isArray(job.steps)
    ? [...job.steps]
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        )
        .map(mapGenerationStep)
    : [];
  // Personalized Model: the stored per-pose virtual-try-on frames the video is built
  // from. Surfaced so the detail page can show them (trust/debugging). Read from the
  // pipeline working state; empty for non-try-on jobs.
  const tryonTasks = (job.inputJson as any)?._state?.tryonTasks;
  const tryonImages: { url: string; angle: string | null }[] = Array.isArray(tryonTasks)
    ? tryonTasks
        .map((t: any) => ({
          url: normalizePublicUrl(t?.storedUrl),
          angle: typeof t?.angle === "string" && t.angle.trim() ? t.angle.trim() : null,
        }))
        .filter((im: { url: string | null }): im is { url: string; angle: string | null } => !!im.url)
    : [];
  // Kept for back-compat; tryonImages (with angle) is the richer field.
  const tryonImageUrls = tryonImages.map((im) => im.url);
  // Fidelity QA (P5) summary, for internal/support visibility only. Deliberately NARROW:
  // whether the clip was flagged and the single gating score — never the per-dimension
  // rubric, the model's notes, or the sampled frame URLs. The UI must not show a customer a
  // "your video scored 2/5" readout; this exists so support can explain a flag or a refund.
  // Absent (null) for every job when QA is inert, which is the current default.
  const qa = (job.inputJson as any)?._qa;
  const qaSummary =
    qa && typeof qa === "object"
      ? {
          flagged: qa.flagged === true,
          minScore: typeof qa.latest?.minScore === "number" ? qa.latest.minScore : null,
          threshold: typeof qa.threshold === "number" ? qa.threshold : null,
          attempts: Array.isArray(qa.history) ? qa.history.length : 0,
        }
      : null;
  return {
    id: job.id as string,
    serviceType: job.serviceType as string,
    modelType: (job.modelType ?? null) as string | null,
    status: job.status as string,
    progress: job.progress ?? 0,
    error: safeError(job.error),
    productName: extra.productName ?? null,
    generationNumber: extra.generationNumber ?? null,
    outputAssetIds: Array.isArray(job.outputAssetIds) ? job.outputAssetIds : [],
    tryonImageUrls,
    tryonImages,
    qa: qaSummary,
    steps,
    createdAt: job.createdAt?.toISOString?.() ?? null,
    updatedAt: job.updatedAt?.toISOString?.() ?? null,
  };
}
