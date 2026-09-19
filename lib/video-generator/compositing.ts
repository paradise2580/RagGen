// lib/video-generator/compositing.ts
//
// P6 (deterministic guarantee) — composite the REAL logo crop back onto the generated
// clip so the brand mark is pixel-exact rather than re-synthesized.
//
// This is the only approach that fully guarantees the logo, but it is heavy: it needs to
// split the clip into frames, track where the logo region moved on each frame, warp the
// source logo crop onto that location, and re-encode. Tracking/warping needs OpenCV and
// frame I/O needs ffmpeg — neither is bundled in this runtime.
//
// So this module is FLAG-GATED and degrades to a pass-through:
//   - enabled only when VIDEO_COMPOSITE_LOGO=1,
//   - requires VIDEO_FFMPEG_PATH (frame extract/encode) AND VIDEO_COMPOSITOR_CMD
//     (an external compositor binary/script that does the track+warp+overlay),
//   - if either is missing it returns { composited:false } and the pipeline ships the
//     original clip unchanged, logging why.
//
// The compositor contract is intentionally external (a Python/OpenCV worker is the right
// tool) so this file stays a thin, honest orchestrator instead of a fake in-JS tracker.
// VIDEO_COMPOSITOR_CMD is invoked as:
//     <cmd> --in <clip.mp4> --logo <logo.png> --bbox x,y,w,h --out <out.mp4>
// where bbox is the normalized logo region in the FIRST frame (0..1). It must write the
// composited clip to --out and exit 0.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadToS3 } from "@/lib/upload-to-s3";
import { detectLogoRegion } from "@/lib/video-generator/providers";

export function compositingEnabled(): boolean {
  return (
    process.env.VIDEO_COMPOSITE_LOGO === "1" &&
    !!process.env.VIDEO_FFMPEG_PATH &&
    !!process.env.VIDEO_COMPOSITOR_CMD
  );
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (d) => (stderr += String(d)));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-400)}`)),
    );
  });
}

async function fetchBytes(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith("data:")) return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch {
    return null;
  }
}

/** Crop the logo region out of the source frame using ffmpeg (so the overlay is the
 * real pixels, not a re-render). Returns the crop file path. */
async function cropLogo(
  ffmpeg: string,
  sourcePath: string,
  bbox: [number, number, number, number],
  outPath: string,
): Promise<void> {
  const [x, y, w, h] = bbox;
  // ffmpeg crop filter works in pixels; iw/ih resolve at filter time so we stay
  // resolution-independent by expressing the normalized box against iw/ih.
  const crop = `crop=iw*${w}:ih*${h}:iw*${x}:ih*${y}`;
  await run(ffmpeg, ["-y", "-i", sourcePath, "-vf", crop, "-frames:v", "1", outPath]);
}

/**
 * Composite the real logo crop onto the generated clip.
 * Returns { composited:false } (pass-through) when disabled or anything is missing.
 */
export async function compositeLogo(opts: {
  videoUrl: string;
  sourceFrameUrl: string;
  tenantId?: string;
}): Promise<{ composited: boolean; cdnUrl?: string; reason?: string }> {
  if (!compositingEnabled()) {
    return { composited: false, reason: "disabled (set VIDEO_COMPOSITE_LOGO=1 + ffmpeg + compositor)" };
  }
  const region = await detectLogoRegion(opts.sourceFrameUrl);
  if (!region.present || !region.bbox) {
    return { composited: false, reason: "no logo region detected" };
  }

  const ffmpeg = process.env.VIDEO_FFMPEG_PATH!;
  const compositor = process.env.VIDEO_COMPOSITOR_CMD!;
  let dir: string | null = null;
  try {
    const [clip, source] = await Promise.all([
      fetchBytes(opts.videoUrl),
      fetchBytes(opts.sourceFrameUrl),
    ]);
    if (!clip || !source) return { composited: false, reason: "download failed" };

    dir = await mkdtemp(join(tmpdir(), "vg-comp-"));
    const clipPath = join(dir, "clip.mp4");
    const srcPath = join(dir, "src.png");
    const logoPath = join(dir, "logo.png");
    const outPath = join(dir, "out.mp4");
    await writeFile(clipPath, clip);
    await writeFile(srcPath, source);

    await cropLogo(ffmpeg, srcPath, region.bbox, logoPath);

    const [x, y, w, h] = region.bbox;
    await run(compositor, [
      "--in",
      clipPath,
      "--logo",
      logoPath,
      "--bbox",
      [x, y, w, h].map((n) => n.toFixed(4)).join(","),
      "--out",
      outPath,
    ]);

    const composited = await readFile(outPath);
    const { cdnUrl } = await uploadToS3({
      tenantId: opts.tenantId,
      type: "video",
      content: composited,
      contentType: "video/mp4",
      extension: "mp4",
    });
    console.info(
      "[video-generator] logo composited",
      JSON.stringify({ label: region.label, bbox: region.bbox }),
    );
    return { composited: true, cdnUrl };
  } catch (err: any) {
    // Never block delivery on a compositing failure — fall back to the original clip.
    console.warn("[video-generator] compositeLogo failed, shipping original:", err?.message || err);
    return { composited: false, reason: `composite failed: ${err?.message || err}` };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
