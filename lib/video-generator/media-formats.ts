// What the downstream providers can actually read, and the key extension that goes with
// each. Kept here rather than duplicated per route because an upload that this file
// accepts must survive every provider hop: OpenAI vision (describeImages,
// selectKeyframes, planModelAngles) and Kling image2video both reject formats outside
// this set.
//
// The list is the INTERSECTION of what those providers accept, not what browsers can
// display. AVIF is the case that motivated this file: browsers render it, the upload
// route happily stored it (falling through extFromMime() to a `.bin` key), and then
// OpenAI 400'd with "unsupported image … ['png','jpeg','gif','webp']" — twice, both
// times swallowed as a soft degradation — before Kling hard-failed the render with
// "Image type is not supported". Rejecting at upload turns a late, credit-spending
// render failure into an immediate, actionable message. HEIC (iPhone's default) fails
// the same way and is excluded for the same reason.
//
// This is a validation list, not a conversion step: transcoding server-side would mean a
// hard sharp/ffmpeg dependency, and neither repo assumes one is present (see the QA/logo
// stages, inert without VIDEO_FFMPEG_PATH).

/** Image mimes every provider hop accepts. */
export const SUPPORTED_IMAGE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

/** Video mimes accepted for uploads (source footage / brand assets, not generator output). */
export const SUPPORTED_VIDEO_MIMES = ["video/mp4", "video/quicktime"] as const;

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

/** Normalise `image/jpeg; charset=…` / casing / `image/jpg` to a bare canonical mime. */
export function normalizeMime(mime: string): string {
  const bare = mime.split(";")[0]?.trim().toLowerCase() || "";
  return bare === "image/jpg" ? "image/jpeg" : bare;
}

/**
 * Key extension for a supported mime. Unsupported input can't reach here — callers
 * validate first — so there is no "bin" fallback to hide a bad upload behind.
 */
export function extFromMime(mime: string): string {
  return EXT_BY_MIME[normalizeMime(mime)] ?? "bin";
}

/**
 * null when the upload is fine, otherwise a message naming what to send instead. Kept as
 * a returned string (not a throw) so each route pairs it with its own error helper.
 */
export function unsupportedMediaMessage(mime: string): string | null {
  const m = normalizeMime(mime);
  if ((SUPPORTED_IMAGE_MIMES as readonly string[]).includes(m)) return null;
  if ((SUPPORTED_VIDEO_MIMES as readonly string[]).includes(m)) return null;
  if (m.startsWith("image/")) {
    return `${m} images can't be used for generation — the image and video providers only accept PNG, JPEG, WebP or GIF. Convert this photo (JPEG is the safe choice) and upload it again.`;
  }
  if (m.startsWith("video/")) {
    return `${m} video can't be used — upload MP4 or MOV.`;
  }
  return "Only image or video uploads are allowed";
}
