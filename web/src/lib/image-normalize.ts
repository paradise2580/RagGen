// Client-side upload normalisation.
//
// The provider chain (OpenAI vision for describeImages/selectKeyframes/planModelAngles,
// then Kling image2video) only reads PNG/JPEG/WebP/GIF — see
// lib/video-generator/media-formats.ts, which is the server's enforcement of the same
// list. An AVIF photo therefore cannot be uploaded as-is: it stores fine, then OpenAI
// 400s (twice, both swallowed as soft degradations) and Kling hard-fails the render with
// "Image type is not supported".
//
// The browser, however, decodes AVIF natively — that is why such a photo previews
// perfectly in the picker while being useless to the pipeline. So AVIF is accepted at the
// dropzone and re-encoded HERE, before it ever leaves the page. The server keeps
// rejecting AVIF: by the time a request is made the conversion has already happened, so a
// 415 from the API now means this step was bypassed, not that a user picked a bad file.
//
// Target format is JPEG, deliberately, not WebP: JPEG is the one format both OpenAI and
// Kling unambiguously accept. WebP is on the server's allow-list because OpenAI names it,
// but Kling's support for it is not something this repo has verified, and the start frame
// is the one input a render cannot survive losing.

/** Formats that already survive every provider hop — uploaded untouched. */
const PROVIDER_SAFE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/**
 * Formats the browser can decode but providers can't read, so they are re-encoded.
 * HEIC is deliberately absent: Chrome/Edge on Windows cannot decode it, so there is no
 * conversion to attempt and the server's 415 message is the honest outcome.
 */
const CONVERTIBLE = new Set(["image/avif"]);

const JPEG_QUALITY = 0.92;

function bareType(file: File): string {
  return (file.type || "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * Re-encode a browser-decodable-but-provider-hostile image to JPEG. Anything already
 * provider-safe is returned as the same File object (no re-encode, no quality loss), and
 * anything unrecognised is passed through untouched so the server's own message owns the
 * error rather than this file inventing a second one.
 */
export async function normalizeImageForUpload(file: File): Promise<File> {
  const type = bareType(file);
  if (PROVIDER_SAFE.has(type)) return file;
  if (!CONVERTIBLE.has(type)) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      `${file.name} couldn't be read by the browser. Save it as JPEG or PNG and try again.`,
    );
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(`${file.name} couldn't be converted in this browser.`);
    // AVIF carries an alpha channel and JPEG cannot. Matte to white first so a packshot
    // on a transparent background lands on white rather than black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Full native resolution, never downscaled: generative video can't recover detail the
    // start frame never had (same reasoning as maxResImageUrl in product-images.ts).
    ctx.drawImage(bitmap, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) throw new Error(`${file.name} couldn't be converted for upload.`);

    const name = `${file.name.replace(/\.avif$/i, "")}.jpg`;
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } finally {
    bitmap.close?.();
  }
}
