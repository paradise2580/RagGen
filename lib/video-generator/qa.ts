import { meterOpenAI, rethrowBudget } from "./rag/usage";
// lib/video-generator/qa.ts
//
// P5 (QA + auto-retry) — score the fidelity of a generated clip against its source and
// decide whether to ship it, re-roll it stricter, or flag it.
//
// The pipeline calls runFidelityQa() after Kling reports success. It:
//   1. samples representative frames from the clip (first / mid / last),
//   2. asks a vision model how faithfully the product — especially the logo/text — was
//      preserved vs. the source start frame, scoring 1–5 on a fixed rubric,
//   3. returns a verdict the pipeline turns into ship / retry / flag.
//
// Frame sampling needs ffmpeg, which isn't bundled in this runtime. So the sampler is
// PLUGGABLE: if VIDEO_FFMPEG_PATH points at an ffmpeg binary we extract real frames;
// otherwise sampling returns nothing and QA degrades to "unavailable" (the clip ships
// unscored, with a logged reason) rather than blocking the pipeline. Provision ffmpeg
// (e.g. a Lambda layer) and set VIDEO_FFMPEG_PATH to turn QA on in production.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadToS3 } from "@/lib/upload-to-s3";
import { providerMode } from "@/lib/video-generator/providers";

export interface FidelityScores {
  logo: number; // 1–5
  text: number;
  color: number;
  pattern: number;
  proportions: number;
  overall: number; // 1–5, model's holistic score
  notes?: string;
}

export interface QaVerdict {
  available: boolean; // false => could not sample frames (sampler not configured)
  reason?: string; // why unavailable / extra context
  scores?: FidelityScores;
  minScore?: number; // lowest of the rubric dimensions — what we gate on
  sampledFrameUrls?: string[];
}

/** QA gate threshold (min acceptable score on any rubric dimension, 1–5). */
export function qaThreshold(): number {
  const n = Number(process.env.VIDEO_QA_THRESHOLD);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 4;
}

/**
 * Max stricter re-rolls before we flag-and-ship.
 *
 * Defaults to **1**, not 2 (decision D1): every re-roll mints a NEW BILLED provider render
 * while the customer is charged once, so the default is the conservative end until shadow
 * data shows how often a re-roll actually rescues a clip. Raise it once
 * `npm run qa:report:video` shows minScore climbing across attempts.
 */
export function qaMaxRetries(): number {
  const n = Number(process.env.VIDEO_QA_MAX_RETRIES);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
}

/**
 * Severity below which a flagged (retries-exhausted) clip earns a goodwill refund —
 * decision D2. A clip that scores 3/5 is usable and shouldn't be free; a 1–2/5 clip is a
 * genuine failure we should eat.
 *
 * Default 3 ⇒ refund only when the worst rubric dimension is below 3 (i.e. 1 or 2).
 * - Set to `VIDEO_QA_THRESHOLD` (or higher) to restore "always refund a flagged clip".
 * - Set to 0 to never refund (flag internally only).
 */
export function qaRefundBelow(): number {
  const n = Number(process.env.VIDEO_QA_REFUND_BELOW);
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : 3;
}

/**
 * TEST SEAM — forces a synthetic verdict so the enforce-mode paths (stricter re-roll,
 * flag-and-refund) can be exercised without ffmpeg, without OpenAI, and without paying for
 * renders. Returns the score to report on every rubric dimension, or null when inactive.
 *
 * Double-guarded and impossible to trip in production: it requires BOTH `PROVIDER_MODE=mock`
 * (prod runs `auto`/`live`) AND an explicit `VIDEO_QA_MOCK_MIN_SCORE` in 1..5.
 *
 *   PROVIDER_MODE=mock VIDEO_QA_MOCK_MIN_SCORE=2 VIDEO_QA_MODE=enforce  → forces re-roll,
 *   then the flag path once retries are exhausted.
 */
export function qaMockMinScore(): number | null {
  if (providerMode() !== "mock") return null;
  const n = Number(process.env.VIDEO_QA_MOCK_MIN_SCORE);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
}

/** QA is only attempted when a frame sampler is configured (or the mock seam is armed). */
export function qaEnabled(): boolean {
  if (process.env.VIDEO_QA_ENABLED === "0") return false;
  return qaMockMinScore() !== null || !!process.env.VIDEO_FFMPEG_PATH;
}

export type QaMode = "shadow" | "enforce";

/**
 * How the pipeline ACTS on a verdict:
 *   - `shadow` (default) — score the clip and persist the verdict, but never change the
 *     outcome: no stricter re-roll, no flagging, no refund, no visible step. This is the
 *     rollout mode. The gate threshold below is an untuned placeholder, so enforcing it
 *     cold would either re-roll almost every job (each re-roll is a new PAID render) or
 *     gate nothing at all. Shadow gathers the score distribution that tunes it.
 *   - `enforce` — act on the verdict (re-roll stricter, then flag-and-ship).
 * Only ever returns `enforce` when explicitly asked for, so a partial rollout (ffmpeg
 * provisioned, mode not yet set) can't silently start gating and spending.
 */
export function qaMode(): QaMode {
  return process.env.VIDEO_QA_MODE === "enforce" ? "enforce" : "shadow";
}

// --- frame sampling ---------------------------------------------------------

function runFfmpeg(args: string[]): Promise<void> {
  const bin = process.env.VIDEO_FFMPEG_PATH!;
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (d) => (stderr += String(d)));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`)),
    );
  });
}

/**
 * Extract first / mid / last frames from a clip and upload them as JPEGs.
 * Returns [] (with a reason) when no sampler is configured or extraction fails.
 */
export async function sampleVideoFrames(opts: {
  videoUrl: string;
  durationSeconds: number;
  tenantId?: string;
}): Promise<{ frameUrls: string[]; reason?: string }> {
  if (!process.env.VIDEO_FFMPEG_PATH) {
    return { frameUrls: [], reason: "no frame sampler (set VIDEO_FFMPEG_PATH)" };
  }
  let dir: string | null = null;
  try {
    const resp = await fetch(opts.videoUrl);
    if (!resp.ok) return { frameUrls: [], reason: `download ${resp.status}` };
    const bytes = Buffer.from(await resp.arrayBuffer());
    dir = await mkdtemp(join(tmpdir(), "vg-qa-"));
    const inPath = join(dir, "in.mp4");
    await writeFile(inPath, bytes);

    const dur = opts.durationSeconds > 0 ? opts.durationSeconds : 5;
    // first (just after start), middle, last (just before end)
    const stamps = [0.1, dur / 2, Math.max(0.2, dur - 0.2)];
    const frameUrls: string[] = [];
    for (let i = 0; i < stamps.length; i++) {
      const outPath = join(dir, `f${i}.jpg`);
      await runFfmpeg([
        "-y",
        "-ss",
        stamps[i].toFixed(2),
        "-i",
        inPath,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        outPath,
      ]);
      const jpg = await readFile(outPath);
      const { cdnUrl } = await uploadToS3({
        tenantId: opts.tenantId,
        type: "image",
        content: jpg,
        contentType: "image/jpeg",
        extension: "jpg",
      });
      frameUrls.push(cdnUrl);
    }
    return { frameUrls };
  } catch (err: any) {
    return { frameUrls: [], reason: `extract failed: ${err?.message || err}` };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// --- vision scoring ---------------------------------------------------------

/**
 * Score how faithfully the sampled frames preserve the product vs. the source frame.
 * Reused by the offline bake-off (P7). Returns null on any error so callers can skip.
 */
export async function scoreFidelity(opts: {
  sourceFrameUrl: string;
  sampledFrameUrls: string[];
  brandText?: string;
}): Promise<FidelityScores | null> {
  if (!process.env.OPENAI_API_KEY || opts.sampledFrameUrls.length === 0) return null;
  try {
    const { default: OpenAI } = await import("openai");
    const client = meterOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 90000 }));
    const model = process.env.OPENAI_DESCRIBE_MODEL || "gpt-5.4-mini";
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a strict QA reviewer for product video ads. The FIRST image is the source " +
            "product (ground truth). The remaining images are frames sampled from a generated " +
            "video. Score how faithfully the generated frames preserve the source product on a " +
            "1–5 scale (5 = indistinguishable, 1 = badly altered) for each: logo, text, color, " +
            "pattern, proportions. Then give an `overall` 1–5. Be harsh about logo/text drift, " +
            'invented marks, and garbled lettering. Reply ONLY with JSON: { "logo": n, "text": n, ' +
            '"color": n, "pattern": n, "proportions": n, "overall": n, "notes": string }.',
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: opts.brandText
                ? `The source logo/text should read exactly: "${opts.brandText}". Source first, then generated frames:`
                : "Source first, then generated frames:",
            },
            { type: "image_url" as const, image_url: { url: opts.sourceFrameUrl } },
            ...opts.sampledFrameUrls.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ] as any,
        },
      ],
      response_format: { type: "json_object" },
    });
    const p = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
    const num = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : 3;
    };
    return {
      logo: num(p.logo),
      text: num(p.text),
      color: num(p.color),
      pattern: num(p.pattern),
      proportions: num(p.proportions),
      overall: num(p.overall),
      notes: typeof p.notes === "string" ? p.notes : undefined,
    };
  } catch (err) {
    rethrowBudget(err);
    console.warn("[video-generator] scoreFidelity failed:", err);
    return null;
  }
}

/** Lowest rubric dimension — the value the QA gate compares to the threshold. */
export function minRubricScore(s: FidelityScores): number {
  return Math.min(s.logo, s.text, s.color, s.pattern, s.proportions);
}

/**
 * Full QA pass: sample frames, score them, and report a verdict. The pipeline turns the
 * verdict into ship / retry / flag.
 */
export async function runFidelityQa(opts: {
  sourceFrameUrl: string;
  videoUrl: string;
  durationSeconds: number;
  brandText?: string;
  tenantId?: string;
}): Promise<QaVerdict> {
  const mock = qaMockMinScore();
  if (mock !== null) {
    const scores: FidelityScores = {
      logo: mock,
      text: mock,
      color: mock,
      pattern: mock,
      proportions: mock,
      overall: mock,
      notes: `mock verdict (VIDEO_QA_MOCK_MIN_SCORE=${mock})`,
    };
    return { available: true, scores, minScore: mock, sampledFrameUrls: ["mock://frame-0"] };
  }

  const { frameUrls, reason } = await sampleVideoFrames({
    videoUrl: opts.videoUrl,
    durationSeconds: opts.durationSeconds,
    tenantId: opts.tenantId,
  });
  if (frameUrls.length === 0) return { available: false, reason };

  const scores = await scoreFidelity({
    sourceFrameUrl: opts.sourceFrameUrl,
    sampledFrameUrls: frameUrls,
    brandText: opts.brandText,
  });
  if (!scores) return { available: false, reason: "scorer unavailable", sampledFrameUrls: frameUrls };

  return {
    available: true,
    scores,
    minScore: minRubricScore(scores),
    sampledFrameUrls: frameUrls,
  };
}
