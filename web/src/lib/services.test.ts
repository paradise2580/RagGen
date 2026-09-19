import { describe, expect, it } from "vitest";
import { COMMERCE_CATALOGUE, COMMERCE_FEATURES } from "./services";

describe("commerce catalogue studio", () => {
  it("is the single commerce studio with a working route", () => {
    expect(COMMERCE_CATALOGUE.id).toBe("commerce-catalogue");
    expect(COMMERCE_CATALOGUE.route).toBe("/generate");
    expect(COMMERCE_CATALOGUE.enabled).toBe(true);
  });

  it("carries the PlatformService shape", () => {
    expect(typeof COMMERCE_CATALOGUE.name).toBe("string");
    expect(typeof COMMERCE_CATALOGUE.description).toBe("string");
    expect(typeof COMMERCE_CATALOGUE.icon).toBe("string");
    expect(COMMERCE_CATALOGUE.composerHeading.length).toBeGreaterThan(0);
    expect(COMMERCE_CATALOGUE.composerSubtitle.length).toBeGreaterThan(0);
  });

  it("only references the supported commerce service types", () => {
    const commerceTypes = new Set(["PRODUCT_ON_MODEL_AD", "PRODUCT_VIDEO_AD"]);
    for (const feature of COMMERCE_CATALOGUE.features) {
      if (feature.serviceType) {
        expect(commerceTypes.has(feature.serviceType)).toBe(true);
      }
    }
  });

  it("keeps every feature well-formed (available features deep-link to a service type)", () => {
    expect(COMMERCE_CATALOGUE.features.length).toBeGreaterThan(0);
    for (const feature of COMMERCE_CATALOGUE.features) {
      expect(["available", "coming-soon"]).toContain(feature.status);
      if (feature.status === "available") {
        expect(typeof feature.serviceType).toBe("string");
        expect((feature.serviceType ?? "").length).toBeGreaterThan(0);
      }
    }
  });

  it("exposes only available features via COMMERCE_FEATURES", () => {
    expect(COMMERCE_FEATURES.length).toBeGreaterThan(0);
    expect(COMMERCE_FEATURES.every((f) => f.status === "available")).toBe(true);
  });
});
