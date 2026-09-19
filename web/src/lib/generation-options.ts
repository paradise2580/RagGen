import type { IconName } from "../components/Icon";

export interface ServiceOption {
  value: string;
  label: string;
  description: string;
  icon: IconName;
}

export interface ModelOption {
  value: string;
  label: string;
  description: string;
}

/** Mirrors GenerationServiceType in the API/db schema. */
export const SERVICE_TYPES: readonly ServiceOption[] = [
  {
    value: "PRODUCT_VIDEO_AD",
    label: "Video ad",
    description: "A short product video built from your catalog images.",
    icon: "video",
  },
] as const;

// Display order: No model → Existing model → AI → Personalized. AI still has no
// generation pipeline yet, so the composer shows a "Coming soon" state when it's
// picked (see COMING_SOON_MODEL_TYPES). Personalized Model is live: it virtual
// try-ons the product onto the model pose photos the user uploads.
export const MODEL_TYPES: readonly ModelOption[] = [
  {
    value: "NO_MODEL",
    label: "No model",
    description: "Product only, no person in frame.",
  },
  {
    value: "EXISTING_MODEL_PHOTO",
    label: "Existing model photo",
    description: "Reuse an uploaded model image.",
  },
  {
    value: "AI_MODEL",
    label: "AI-generated model",
    description: "Generate a synthetic model.",
  },
  {
    value: "PERSONALIZED_MODEL",
    label: "Personalized model",
    description: "Try the product on model pose photos you upload.",
  },
] as const;

/** Model types with no generation pipeline yet — the composer blocks these with a
 * "Coming soon" overlay instead of letting a brief be submitted. AI_MODEL is now live
 * (it generates a synthetic clothed model, then virtual-try-ons the product onto it). */
export const COMING_SOON_MODEL_TYPES = new Set<string>([]);

/** AI Model = a generated model. The user picks Kling-style model settings; the
 * pipeline synthesizes a fully-clothed model from them, then try-ons the product. */
export const MODEL_TYPES_REQUIRING_AI_MODEL = new Set(["AI_MODEL"]);

export interface AiModelOption {
  value: string;
  label: string;
}
/** Mirrors the API's aiModel.gender enum (route.ts). */
export const AI_MODEL_GENDERS: readonly AiModelOption[] = [
  { value: "FEMALE", label: "Female" },
  { value: "MALE", label: "Male" },
] as const;
/** Mirrors the API's aiModel.age enum. */
export const AI_MODEL_AGES: readonly AiModelOption[] = [
  { value: "CHILD", label: "Children" },
  { value: "YOUTH", label: "Youth" },
  { value: "ELDERLY", label: "Elderly" },
] as const;
/** Mirrors the API's aiModel.skinTone enum. */
export const AI_MODEL_SKIN_TONES: readonly AiModelOption[] = [
  { value: "LIGHT", label: "Light" },
  { value: "FAIR", label: "Fair" },
  { value: "MEDIUM", label: "Medium" },
  { value: "DEEP", label: "Deep" },
] as const;

export const DEFAULT_AI_MODEL = {
  gender: "FEMALE",
  age: "YOUTH",
  skinTone: "LIGHT",
} as const;

/**
 * The user types their own brief for the video — it is the primary creative direction
 * and is passed verbatim to every LLM stage of the pipeline (see readInstructions in
 * lib/video-generator/pipeline.ts). This replaced a fixed catalogue of ad templates,
 * each of which mapped to server-picked motion presets; there is no canned motion any
 * more, so whatever the user does not say is left to the prompt model.
 *
 * Mirrors the API's `userInstructions` cap — keep the two in sync so the composer can
 * never submit a brief the server would reject.
 */
export const MAX_USER_INSTRUCTIONS = 2000;

/** Shown in the empty composer box: a concrete brief, so the format is obvious. */
export const USER_INSTRUCTIONS_PLACEHOLDER =
  "Describe the video you want — the motion, camera, setting, and mood. " +
  "e.g. “The model walks toward the camera in a sunlit street, then stops and turns to show the back of the jacket.”";

// "auto" lets the media model match the source image's aspect (no letterbox
// margins); the rest force a specific canvas.
export const ASPECT_RATIOS = ["auto", "9:16", "1:1", "16:9", "4:5"] as const;

// Output resolutions Kling's image2video supports. Higher = sharper logo/text
// detail (fidelity). Mirrors KLING_RESOLUTIONS in lib/video-generator/providers.ts
// and the API's `resolution` enum; 1080p is the default.
export const RESOLUTIONS = ["1080p", "720p"] as const;
export const DEFAULT_RESOLUTION = "1080p";

const RESOLUTION_HINT: Record<string, string> = {
  "1080p": "Sharpest",
  "720p": "Faster",
};

/** Dropdown label for a resolution value (e.g. "1080p · Sharpest"). */
export function resolutionLabel(value: string): string {
  const hint = RESOLUTION_HINT[value];
  return hint ? `${value} · ${hint}` : value;
}

// Model types that require a single uploaded model image via the AssetPicker.
// Empty today: "Product On Model" (EXISTING_MODEL_PHOTO) runs like a plain product
// brief, and PERSONALIZED_MODEL uses the multi-pose uploader (modelPoseAssetIds),
// not a single asset — see MODEL_TYPES_REQUIRING_POSES.
export const MODEL_TYPES_REQUIRING_ASSET = new Set<string>([]);

/** Model types that require one or more uploaded model-pose photos (Personalized
 * Model): each pose is virtual try-on'd with the product before the video render. */
export const MODEL_TYPES_REQUIRING_POSES = new Set(["PERSONALIZED_MODEL"]);

/**
 * Model types each service type actually supports. Mirrors `resolveWorkflowName` in
 * @repo/shared so the UI can only offer valid (service, model) pairs — picking an
 * unsupported combination is what the API rejects with "Unsupported combination".
 */
export const MODEL_TYPES_BY_SERVICE: Record<string, readonly string[]> = {
  PRODUCT_VIDEO_AD: ["NO_MODEL", "EXISTING_MODEL_PHOTO", "AI_MODEL", "PERSONALIZED_MODEL"],
};

/** Model options valid for a given service type, in display order. */
export function modelTypesForService(serviceType: string): ModelOption[] {
  const allowed = MODEL_TYPES_BY_SERVICE[serviceType] ?? ["NO_MODEL"];
  return MODEL_TYPES.filter((m) => allowed.includes(m.value));
}

/** Service types that support a given model type — used to explain disabled options. */
export function servicesSupportingModel(modelType: string): string[] {
  return Object.entries(MODEL_TYPES_BY_SERVICE)
    .filter(([, models]) => models.includes(modelType))
    .map(([service]) => service);
}

/** True when the model type is a valid pairing for the service type. */
export function isModelTypeValidForService(serviceType: string, modelType: string): boolean {
  return (MODEL_TYPES_BY_SERVICE[serviceType] ?? ["NO_MODEL"]).includes(modelType);
}

/** The model type to fall back to when the current one is invalid for a service. */
export function defaultModelTypeForService(serviceType: string): string {
  return MODEL_TYPES_BY_SERVICE[serviceType]?.[0] ?? "NO_MODEL";
}

export function serviceLabel(value: string | null | undefined): string {
  return SERVICE_TYPES.find((s) => s.value === value)?.label ?? value ?? "—";
}

export function modelLabel(value: string | null | undefined): string {
  return MODEL_TYPES.find((m) => m.value === value)?.label ?? value ?? "—";
}
