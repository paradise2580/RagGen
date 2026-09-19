// lib/video-generator/product-images.ts
//
// Source-image adapter for the generation studio.
//
// The pipeline needs INPUT product images. Those come straight from the ProductRecord
// (+ its storage/CDN URLs) rather than from a separate asset table, so any image
// attached to a product is immediately usable by the studio.
//
// ProductRecord.payload holds raw product data whose image shape differs per source
// (Shopify / BigCommerce / Adobe Commerce / manual), so the extraction below is
// deliberately tolerant. Kept server-side so the API routes can resolve images without
// shipping the logic to the client.
//
// The pipeline's Kling step accepts a plain URL, so external integration CDN URLs
// (e.g. Shopify) work as-is — no copy into our bucket is required.

/** Force https:// on protocol-relative or http URLs (integration CDNs are https). Loopback
 * URLs are left alone — they're this app's own local-storage fallback (see
 * lib/upload-to-s3.ts), which serves plain http:// and has no TLS listener to upgrade to. */
export function ensureHttps(url: string): string {
  const u = url.trim();
  if (!u) return u;
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(u)) return u;
  if (u.startsWith("//")) return `https:${u}`;
  if (u.startsWith("http://")) return `https://${u.slice("http://".length)}`;
  return u;
}

/**
 * P1 (input fidelity): rewrite a CDN URL to its highest-resolution original.
 *
 * Generative video can't recover detail that was never in the start frame, so a
 * CDN-resized thumbnail in → mushy logo/text out. Shopify (and Shopify-style) CDNs
 * encode a resize as a `_<w>x<h>` (optionally `@2x`/`_cropped`) suffix before the
 * extension and/or `width`/`height` query params; stripping both yields the
 * full-size master. Non-matching URLs are returned unchanged (safe no-op).
 */
export function maxResImageUrl(url: string): string {
  try {
    const u = new URL(url);
    // Drop resize query params (Shopify, imgix-style, generic CDNs).
    for (const p of ["width", "height", "w", "h", "size", "crop", "scale"]) {
      u.searchParams.delete(p);
    }
    // Strip a "_600x600" / "_600x" / "_x600" dimension suffix (with optional "@2x")
    // just before the extension: foo_600x600@2x.jpg -> foo.jpg. This numeric form is a
    // CDN resize marker and safe to strip on any host.
    u.pathname = u.pathname.replace(/_(?:\d+x\d*|x\d+)(@\d+x)?(\.[a-z0-9]+)$/i, "$2");
    // Shopify also uses named size keywords (_grande, _large, …); only strip these on
    // Shopify CDN hosts, since elsewhere they could be part of a real filename.
    if (/(^|\.)shopify\.com$|shopifycdn\.|myshopify\.com$/i.test(u.hostname)) {
      u.pathname = u.pathname.replace(
        /_(?:pico|icon|thumb|small|compact|medium|large|grande|original|master|\d+x\d+_crop_[a-z]+)(@\d+x)?(\.[a-z0-9]+)$/i,
        "$2",
      );
    }
    const out = u.toString();
    // URL() re-encoding can append a stray "?"; trim it.
    return out.endsWith("?") ? out.slice(0, -1) : out;
  } catch {
    return url;
  }
}

/**
 * Extract every product image URL from a ProductRecord payload, per platform.
 * Returns de-duplicated, https-normalized URLs in discovery order.
 */
export function extractProductImageUrls(
  payload: any,
  platform: string | null | undefined,
): string[] {
  if (!payload) return [];
  const prov = (platform || "").toLowerCase();
  const urls = new Set<string>();
  // P1: normalize every URL to its highest-resolution original before collecting,
  // so resized CDN variants don't slip in as low-detail start frames.
  const add = (u: unknown) => {
    if (typeof u === "string" && u.trim()) urls.add(maxResImageUrl(ensureHttps(u)));
  };

  try {
    // 0a) normalized array attached by the products route (string | object)
    if (Array.isArray(payload._images)) {
      for (const im of payload._images) {
        add(typeof im === "string" ? im : im?.url || im?.src || im?.image_url || im?.originalSrc);
      }
    }

    // 0b) manual products: images is a string[]
    if (Array.isArray(payload.images) && typeof payload.images[0] === "string") {
      for (const u of payload.images) add(u);
    }

    // 1) SHOPIFY (object/edge based)
    if (prov === "shopify") {
      let nodes: any[] = [];
      if (Array.isArray(payload.images)) nodes = payload.images;
      else if (payload.images?.edges) nodes = payload.images.edges.map((e: any) => e?.node).filter(Boolean);
      else if (Array.isArray(payload.media)) nodes = payload.media;
      else if (payload.media?.edges) nodes = payload.media.edges.map((e: any) => e?.node).filter(Boolean);

      for (const n of nodes) {
        [
          n?.src,
          n?.url,
          n?.originalSrc,
          n?.transformedSrc,
          n?.image?.src,
          n?.image?.url,
          n?.preview?.image?.url,
          n?.previewImage?.url,
        ].forEach(add);
      }
      [
        payload?.featured_image,
        payload?.featuredImage?.src,
        payload?.featuredImage?.url,
        payload?.variants?.[0]?.image?.src,
        payload?.variants?.[0]?.image?.url,
      ].forEach(add);
    }

    // 2) BIGCOMMERCE — prefer the largest variant (zoom) over standard/thumbnail (P1).
    if (prov === "bigcommerce" && Array.isArray(payload.images)) {
      for (const i of payload.images) {
        add(i?.url_zoom || i?.url_standard || i?.image_url || i?.url_thumbnail);
      }
    }

    // 3) ADOBE COMMERCE (Magento)
    if (prov === "adobe_commerce") {
      const base = payload.base_media_url || payload.media_base_url || payload.storeUrl || "";
      let origin = "";
      if (base) {
        try {
          origin = new URL(base).origin;
        } catch {
          origin = String(base);
        }
      }
      for (const m of payload.media_gallery_entries ?? []) {
        if (!m?.file) continue;
        const path = String(m.file).replace(/^\//, "");
        if (origin) add(`${origin}/media/${path}`);
      }
    }

    // 4) generic object-based fallback (other providers) — prefer the largest/original
    // variant over a thumbnail (P1).
    if (Array.isArray(payload.images) && typeof payload.images[0] === "object") {
      for (const im of payload.images) {
        add(
          im?.originalSrc ||
            im?.url_zoom ||
            im?.url_standard ||
            im?.src ||
            im?.url ||
            im?.image_url ||
            im?.url_thumbnail,
        );
      }
    }
  } catch {
    // fall through with whatever we collected
  }

  return Array.from(urls);
}

/** Minimal shape we depend on from a tenant ProductRecord. */
export interface ProductImageSource {
  id: string;
  platform?: string | null;
  payload: any;
}

/**
 * Resolve a product's images for the Video Generator picker/pipeline. The primary
 * image (first) is the default generation input frame.
 */
export function resolveProductImages(product: ProductImageSource): {
  productId: string;
  images: string[];
  primaryImage: string | null;
} {
  const images = extractProductImageUrls(product.payload, product.platform);
  return { productId: product.id, images, primaryImage: images[0] ?? null };
}
