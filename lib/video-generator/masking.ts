// lib/video-generator/masking.ts
//
// P4 (region locking) — render a Kling "static mask" that pins the logo region.
//
// Kling's image2video accepts a static_mask: a black/white image the same size as the
// start frame, where the WHITE area is held static (no motion) while the rest animates.
// Pinning the logo region is the cheapest model-native way to stop the brand mark from
// being repainted frame to frame (root cause #4).
//
// We have no image-detector model and no sharp, but `canvas` (node-canvas) is available,
// so we synthesize the mask in-process: vision returns a normalized logo bounding box
// (providers.detectLogoRegion), and we draw a white, slightly-feathered rounded rect over
// it on a black canvas sized to the source image, then upload the PNG to S3 and hand
// Kling its URL.
//
// Everything here fails soft: any error returns null and the caller renders without a
// mask (the other fidelity controls — full-res input, cfg, prompt, QA — still apply).

import { uploadToS3 } from "@/lib/upload-to-s3";
import { detectLogoRegion } from "@/lib/video-generator/providers";

// Margin added around the detected box (fraction of the box size) so the whole mark,
// including anti-aliased edges, stays inside the static region.
const MASK_PADDING = 0.12;

/** Reject internal/link-local hosts before a server-side fetch (SSRF guard). */
function isBlockedHost(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return true;
    const host = u.hostname;
    return (
      /^(localhost|0\.0\.0\.0|127\.|10\.|169\.254\.|192\.168\.|::1$|\[?::1\]?)/i.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.endsWith(".internal") ||
      host.endsWith(".local")
    );
  } catch {
    return true;
  }
}

/** Fetch the source image bytes (used to size the mask to the exact input). */
async function fetchImageBytes(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith("data:")) {
      const b64 = url.slice(url.indexOf(",") + 1);
      return Buffer.from(b64, "base64");
    }
    // SSRF guard: never fetch an internal/link-local URL server-side.
    if (isBlockedHost(url)) return null;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Build a static mask pinning the logo region of `startFrameUrl`.
 * Returns the uploaded mask's public URL, or null if no lockable logo was found or
 * mask synthesis was unavailable.
 */
export async function buildLogoStaticMask(opts: {
  startFrameUrl: string;
  tenantId?: string;
}): Promise<{ maskUrl: string; label?: string } | null> {
  // 1) Where is the logo?
  const region = await detectLogoRegion(opts.startFrameUrl);
  if (!region.present || !region.bbox) return null;

  // 2) We need the source dimensions so the mask lines up pixel-for-pixel.
  const bytes = await fetchImageBytes(opts.startFrameUrl);
  if (!bytes) return null;

  let createCanvas: any;
  let loadImage: any;
  try {
    ({ createCanvas, loadImage } = await import("canvas"));
  } catch (err) {
    console.warn("[video-generator] canvas unavailable, skipping static mask:", err);
    return null;
  }

  try {
    const img = await loadImage(bytes);
    const W = img.width;
    const H = img.height;
    if (!W || !H) return null;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    // Black everywhere = "animate"; white = "hold static".
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, H);

    let [bx, by, bw, bh] = region.bbox;
    // Apply padding, then clamp to the canvas.
    const px = bw * MASK_PADDING;
    const py = bh * MASK_PADDING;
    bx = Math.max(0, bx - px);
    by = Math.max(0, by - py);
    bw = Math.min(1 - bx, bw + 2 * px);
    bh = Math.min(1 - by, bh + 2 * py);

    const rx = Math.round(bx * W);
    const ry = Math.round(by * H);
    const rw = Math.round(bw * W);
    const rh = Math.round(bh * H);

    ctx.fillStyle = "#ffffff";
    const radius = Math.min(rw, rh) * 0.12;
    roundRect(ctx, rx, ry, rw, rh, radius);
    ctx.fill();

    const png = canvas.toBuffer("image/png");
    const { cdnUrl } = await uploadToS3({
      tenantId: opts.tenantId,
      type: "image",
      content: png,
      contentType: "image/png",
      extension: "png",
    });
    return { maskUrl: cdnUrl, label: region.label };
  } catch (err) {
    console.warn("[video-generator] static mask synthesis failed:", err);
    return null;
  }
}

function roundRect(
  ctx: any,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
