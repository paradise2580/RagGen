import type { IconName } from "../components/Icon";

/**
 * Video Generator is a single-studio app: the Commerce Catalogue. This module
 * is the source of truth for the studio's display copy and the capability cards
 * shown on the dashboard. (The multi-studio picker, the home-hub studio grid,
 * and per-tab "active studio" session state were removed in the spinoff.)
 */
export interface PlatformService {
  id: string;
  name: string;
  description: string;
  route: string;
  icon: IconName;
  enabled: boolean;
}

/** A single capability inside the studio. */
export interface StudioFeature {
  id: string;
  name: string;
  description: string;
  icon: IconName;
  /**
   * "available" features open the working generation wizard, optionally
   * preselecting a generation service type. "coming-soon" features render an
   * empty state — they are intentionally deferred, never a dead button.
   */
  status: "available" | "coming-soon";
  /** Existing GenerationServiceType used to deep-link the wizard. */
  serviceType?: string;
  /**
   * The model setting (GenerationModelType) this card represents. When set, the
   * dashboard only previews generations made with THIS model type — so cards
   * that share a serviceType (e.g. Product Only vs Product videos) show distinct,
   * on-topic previews instead of both grabbing the latest of the service.
   */
  modelType?: string;
}

export interface StudioDefinition extends PlatformService {
  /** One-line lead shown under the studio title. */
  tagline: string;
  /** Heading shown on the Create (generate) composer. */
  composerHeading: string;
  /** Subtitle shown under that heading. */
  composerSubtitle: string;
  /** Bullet highlights describing the studio. */
  highlights: string[];
  features: StudioFeature[];
}

/** The one and only studio this app ships. */
export const COMMERCE_CATALOGUE: StudioDefinition = {
  id: "commerce-catalogue",
  name: "Commerce Catalogue",
  description:
    "Studio-grade product imagery, on-model shots, and product videos for your catalogue.",
  tagline: "Turn product photos into catalogue-ready creative.",
  composerHeading: "What catalogue creative do you want?",
  composerSubtitle:
    "Describe the product shot, choose a format, and generate catalogue-ready visuals.",
  route: "/generate",
  icon: "products",
  enabled: true,
  highlights: ["Product-only videos", "Product videos", "Catalogue-ready assets"],
  features: [
    {
      id: "product-only",
      name: "Product Only",
      description: "Product-only videos with no person in frame.",
      icon: "products",
      status: "available",
      serviceType: "PRODUCT_VIDEO_AD",
      modelType: "NO_MODEL",
    },
    {
      id: "product-videos",
      name: "Product videos",
      description: "Short product videos built from your catalogue images.",
      icon: "video",
      status: "available",
      serviceType: "PRODUCT_VIDEO_AD",
      modelType: "EXISTING_MODEL_PHOTO",
    },
  ],
};

/** The studio's available capabilities (those that open the generation wizard). */
export const COMMERCE_FEATURES: StudioFeature[] = COMMERCE_CATALOGUE.features.filter(
  (f) => f.status === "available",
);
