// lib/video-generator/local-mock-video.ts
//
// In mock provider mode (no Kling/OpenAI/Anthropic credentials), the pipeline would
// otherwise ship a tiny hardcoded placeholder clip (see MOCK_MP4_BASE64 in providers.ts) —
// fine for exercising credits/steps/storage, but not something worth showing anyone.
//
// When VIDEO_FFMPEG_PATH is set, this renders an actual short Ken-Burns (slow zoom) video
// from the REAL product photo instead: free, local, no provider call. Ken Burns is the
// honest ceiling for a mock stage — it's real motion over the real image, not a synthesized
// AI render, and the pipeline still ends up billing/labeling it exactly like any other mock
// job. If ffmpeg isn't configured or anything goes wrong, the caller falls back to the
// static placeholder — this must never turn a working mock job into a failed one.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";

export function localMockVideoAvailable(): boolean {
  return !!process.env.VIDEO_FFMPEG_PATH;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (d) => (stderr += String(d)));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`)),
    );
  });
}

/** Resolve an image URL to bytes — reads straight off disk for our own local-storage
 * uploads (see lib/upload-to-s3.ts), fetches otherwise (S3, data: URLs, external CDNs). */
async function resolveImageBytes(imageUrl: string): Promise<Buffer> {
  if (imageUrl.startsWith("data:")) {
    const b64 = imageUrl.slice(imageUrl.indexOf(",") + 1);
    return Buffer.from(b64, "base64");
  }
  try {
    const u = new URL(imageUrl);
    const marker = "/uploads/";
    const idx = u.pathname.indexOf(marker);
    if (idx !== -1) {
      const rel = u.pathname.slice(idx + marker.length);
      const diskPath = path.join(process.cwd(), "public", "uploads", decodeURIComponent(rel));
      return await readFile(diskPath);
    }
  } catch {
    /* fall through to fetch */
  }
  const resp = await fetch(imageUrl);
  if (!resp.ok) throw new Error(`Failed to fetch source image: ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

/**
 * Render a slow-zoom video from a single product photo. Square 1080x1080 output so any
 * source aspect ratio (portrait/landscape product shot) works without letterboxing.
 */
export async function renderKenBurnsVideo(
  imageUrl: string,
  durationSeconds = 4,
): Promise<Buffer> {
  const ffmpeg = process.env.VIDEO_FFMPEG_PATH;
  if (!ffmpeg) throw new Error("VIDEO_FFMPEG_PATH is not set");

  const imageBytes = await resolveImageBytes(imageUrl);
  const dir = await mkdtemp(join(tmpdir(), "raggen-mockvid-"));
  const inPath = join(dir, "in.img");
  const outPath = join(dir, "out.mp4");
  const fps = 25;
  const frames = Math.max(fps * durationSeconds, fps * 2);

  try {
    await writeFile(inPath, imageBytes);
    const vf =
      "scale=2160:2160:force_original_aspect_ratio=increase," +
      "crop=2160:2160," +
      `zoompan=z='min(zoom+0.0025,1.35)':d=${frames}:s=1080x1080:fps=${fps}:` +
      "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'";
    await run(ffmpeg, [
      "-y",
      "-loop",
      "1",
      "-i",
      inPath,
      "-vf",
      vf,
      "-t",
      String(durationSeconds),
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-movflags",
      "+faststart",
      outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
