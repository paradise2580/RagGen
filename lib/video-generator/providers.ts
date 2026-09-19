import { meterOpenAI, metered, rethrowBudget } from "./rag/usage";
import { cachedVision } from "./rag/vision";
// lib/video-generator/providers.ts
//
// AI-provider gateway: OpenAI (describe images) -> Anthropic (plan/prompt) -> Kling
// (image2video), as plain functions.
//
// PROVIDER_MODE resolution:
//   "mock"  → never call a provider (placeholder output) — default dev experience
//   "live"  → require the relevant credentials, throw if missing
//   "auto"  → use the real provider when its key/creds exist, else fall back to mock
//
// Kling auth uses the current single API-key scheme: KLING_API_KEY is presented
// directly as a Bearer token ("Authorization: Bearer <KLING_API_KEY>") against
// KLING_API_BASE. Kling's newer API replaced the legacy AccessKey/SecretKey + HS256
// JWT pair with one API key (the legacy pair no longer supports new models), so a
// single key is all that's required.

// 1x1 transparent PNG — mock image placeholder bytes.
const TRANSPARENT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// Mock *video* placeholder — a real 2s H.264 (Constrained Baseline, 180x320 9:16,
// yuv420p, faststart) MP4, not the PNG above. The store stage marks any output whose
// URL ends `.mp4` as GENERATED_VIDEO, so handing it PNG bytes produced a `.mp4` object
// with `Content-Type: image/png` inside it: the SPA's <video> had nothing to decode and
// showed a black 0:00 frame, and a downloaded copy failed to open (Windows 0xC00D36C4).
// Mock mode exists to exercise the real flow offline, so its video output has to be a
// decodable video. Generated with ffmpeg and validated by a full decode pass
// (`ffmpeg -v error -i … -f null -` clean); crf 40 at 8fps keeps it ~2KB inline.
// Inlined rather than shipped as a file so no runtime fs read or bundler asset path is
// involved — same reasoning as the PNG above.
const MOCK_MP4_BASE64 =
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAANmbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAA" +
  "AAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAA" +
  "ApB0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAA" +
  "AAAAAAAAAAAAAABAAAAAALQAAAFAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAAAAABAAAAAAIIbWRpYQAAACBtZGhk" +
  "AAAAAAAAAAAAAAAAAABAAAAAgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABs21p" +
  "bmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAXNzdGJsAAAAu3N0c2QA" +
  "AAAAAAAAAQAAAKthdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAALQBQABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDIgbGli" +
  "eDI2NAAAAAAAAAAAAAAAGP//AAAAMWF2Y0MBQsAe/+EAGWdCwB7ZAwKefwEQAAADABAAAAMBAPFi5IABAAVoy4DksgAAABBwYXNw" +
  "AAAAAQAAAAEAAAAUYnRydAAAAAAAABEcAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAQAAAIAAAAABRzdHNzAAAAAAAAAAEAAAABAAAA" +
  "HHN0c2MAAAAAAAAAAQAAAAEAAAAQAAAAAQAAAFRzdHN6AAAAAAAAAAAAAAAQAAADeAAAABAAAAAOAAAADgAAAA4AAAAOAAAADgAA" +
  "AA4AAAAOAAAADgAAAA4AAAAOAAAADgAAAA0AAAANAAAACwAAABRzdGNvAAAAAAAAAAEAAAOWAAAAYnVkdGEAAABabWV0YQAAAAAA" +
  "AAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2Mi4xMi4x" +
  "MDIAAAAIZnJlZQAABE9tZGF0AAACcAYF//9s3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMyAwNDgwY2IwIC0g" +
  "SC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQu" +
  "aHRtbCAtIG9wdGlvbnM6IGNhYmFjPTAgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MToweDExMSBtZT1oZXggc3VibWU9" +
  "NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhk" +
  "Y3Q9MCBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEwIGxvb2th" +
  "aGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9" +
  "MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTE2IGtleWludF9taW49MSBzY2VuZWN1dD00" +
  "MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTE2IHJjPWNyZiBtYnRyZWU9MSBjcmY9NDAuMCBxY29tcD0wLjYwIHFwbWlu" +
  "PTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAQBliIQEPEYoAAhvxwABAOjmTk5OTk5OTk5O" +
  "Tk66666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666666" +
  "66/gP/4aDkCB2qu32JLuIIURKWEsL3nRtY+cP9AsEwn2lxjmNXKq5NCaCYb11111111//+AMKhzgj3jYSv///YIfCX45MO111111" +
  "112tra1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111" +
  "11111114AAAADEGaOAh4HQ7xh3gcYAAAAApBmlQCHgdDvA+wAAAACkGaYBDwOh3gfYAAAAAKQZqAEPA6HeB9gAAAAApBmqAQ8Dod" +
  "4H2AAAAACkGawBDwOh3gfYAAAAAKQZrgEPA6HeB9gAAAAApBmwAQ8Dod4H2AAAAACkGbIBDwOh3gfYAAAAAKQZtAEPA6HeB9gAAA" +
  "AApBm2AQ8Dod4H2AAAAACkGbgBDwOh3gfYAAAAAJQZugP8Dod4H2AAAACUGbwD/A6HeB9gAAAAdBm+A7wHjA";

export type ProviderMode = "auto" | "mock" | "live";

export function providerMode(): ProviderMode {
  const m = (process.env.PROVIDER_MODE || "auto").toLowerCase();
  return m === "mock" || m === "live" ? m : "auto";
}

const hasOpenAI = () => !!process.env.OPENAI_API_KEY;
const hasAnthropic = () => !!process.env.ANTHROPIC_API_KEY;
const hasKling = () => !!process.env.KLING_API_KEY;

/** Decide whether a given provider should run live for this request. */
function useLive(available: boolean, provider: string): boolean {
  const mode = providerMode();
  if (mode === "mock") return false;
  if (mode === "live") {
    if (!available) throw new Error(`PROVIDER_MODE=live but ${provider} credentials are missing`);
    return true;
  }
  return available; // auto
}

// ---------------------------------------------------------------------------
// Transient-error retry
// ---------------------------------------------------------------------------
//
// Provider APIs (OpenAI, Anthropic) intermittently return rate-limit (429),
// overloaded/5xx, or network errors. Those are retryable: without a retry a
// single blip on an un-guarded call (describeImages / generatePromptText) throws
// all the way up and PERMANENTLY fails an in-flight generation — even one whose
// expensive image steps already succeeded. This backs off and retries a few times
// before giving up, so a momentary provider hiccup no longer kills the job.
function isTransientProviderError(err: any): boolean {
  const status = Number(err?.status ?? err?.statusCode ?? err?.response?.status);
  if (status === 408 || status === 409 || status === 429 || (status >= 500 && status <= 599)) {
    return true;
  }
  const name = String(err?.name ?? "");
  if (/APIConnection(Timeout)?Error|AbortError|FetchError/i.test(name)) return true;
  const msg = String(err?.message ?? err?.cause?.message ?? err ?? "");
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|socket hang up|network|timeout|fetch failed|overloaded|rate.?limit|temporarily/i.test(
    msg,
  );
}

async function withProviderRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 800;
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
    rethrowBudget(err);
      lastErr = err;
      if (attempt === retries || !isTransientProviderError(err)) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(
        `[video-generator] ${label} transient error (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms:`,
        (err as any)?.status ?? "",
        (err as any)?.message ?? err,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Stage 1 — describe images (OpenAI vision)
// ---------------------------------------------------------------------------

export interface ImageDescription {
  productType: string;
  productDescription: string;
  modelDescription?: string;
  combinedDescription: string;
  modelPresent: boolean | null;
  // P3 (fidelity): a verbatim transcription of the brand marks on the product —
  // exact logo wording, any printed text, and their colors/placement. The prompt
  // model is told to repeat this so Kling is steered to preserve (not repaint) the
  // logo/text rather than left to invent it from a vague "the product" reference.
  brandText?: string;
  raw?: unknown;
}

export async function describeImages(opts: Parameters<typeof describeImagesUncached>[0]): Promise<ImageDescription> {
  return cachedVision(opts, describeImagesUncached);
}

async function describeImagesUncached(opts: {
  mode: "product" | "model" | "both";
  imageUrls: string[];
  instructions?: string;
}): Promise<ImageDescription> {
  if (!useLive(hasOpenAI(), "OpenAI")) {
    return {
      productType: "product",
      productDescription: `Mock description derived from ${opts.imageUrls.length} image(s).`,
      modelDescription: opts.mode === "product" ? undefined : "Mock model description.",
      combinedDescription: "Mock combined scene description: clean studio, soft lighting.",
      modelPresent: opts.mode === "product" ? false : true,
      brandText: "",
      raw: { mock: true },
    };
  }

  const { default: OpenAI } = await import("openai");
  const client = meterOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 90000 }));
  const model = process.env.OPENAI_DESCRIBE_MODEL || "gpt-5.4-mini";
  const focus =
    opts.mode === "both" ? "the product and any model/person" : `the ${opts.mode}`;

  // A safe, generic description used when the vision call ultimately fails (after
  // retries). Degrading to this keeps the pipeline alive — the prompt stage still
  // renders a reasonable video — instead of hard-failing an in-flight generation on
  // a transient provider blip. Mirrors the mock shape above.
  const fallbackDescription = (): ImageDescription => ({
    productType: "product",
    productDescription: "",
    modelDescription: opts.mode === "product" ? undefined : "",
    combinedDescription: "",
    modelPresent: opts.mode === "product" ? false : null,
    brandText: "",
    raw: { fallback: true },
  });

  let completion: any;
  try {
    completion = await withProviderRetry("describeImages", () =>
      client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a meticulous product and fashion visual analyst. Reply ONLY with JSON: " +
              '{ "productType": string, "productDescription": string, "modelDescription": string|null, ' +
              '"combinedDescription": string, "modelPresent": boolean, "brandText": string }. ' +
              "brandText: transcribe EXACTLY every brand mark on the product — the literal text of any " +
              "logo or wordmark (character for character), any other printed text, plus their colors and " +
              'placement (e.g. "ASICS wordmark in white, lower-left chest; spiral logo in gold"). If there ' +
              'is no visible text or logo, return "". Do not paraphrase or guess wording you cannot read.',
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Describe ${focus} in these reference images. Transcribe any logo/brand text verbatim. ${opts.instructions ?? ""}`.trim(),
              },
              ...opts.imageUrls.map((url) => ({
                type: "image_url" as const,
                image_url: { url },
              })),
            ] as any,
          },
        ],
        response_format: { type: "json_object" },
      }),
    );
  } catch (err) {
    rethrowBudget(err);
    // Retries exhausted (or a non-transient error). Don't kill the generation over
    // the scene description — degrade to a generic one and let the render proceed.
    console.error(
      "[video-generator] describeImages failed after retries; degrading to a generic description:",
      (err as any)?.status ?? "",
      (err as any)?.message ?? err,
    );
    return fallbackDescription();
  }

  const text = completion.choices?.[0]?.message?.content || "{}";
  let parsed: any = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }
  return {
    productType: parsed.productType || "product",
    productDescription: parsed.productDescription || "",
    modelDescription: parsed.modelDescription || undefined,
    combinedDescription: parsed.combinedDescription || parsed.productDescription || "",
    modelPresent: typeof parsed.modelPresent === "boolean" ? parsed.modelPresent : null,
    brandText: typeof parsed.brandText === "string" ? parsed.brandText : "",
    raw: parsed,
  };
}

// ---------------------------------------------------------------------------
// Stage 1b — pick the best start frame (OpenAI vision) [P1: input fidelity]
// ---------------------------------------------------------------------------
//
// Root cause #3: the start frame was chosen blindly as productImages[0]. Kling
// re-synthesizes the logo/text region from the FIRST frame, so the sharpest,
// most front-on shot with the logo clearly visible gives the best fidelity.
// Returns an index into `imageUrls`; falls back to 0 on any error or when the
// model can't decide (so this is always safe to call).
export async function pickBestStartFrame(opts: {
  imageUrls: string[];
  productType?: string;
}): Promise<number> {
  const urls = opts.imageUrls ?? [];
  if (urls.length <= 1) return 0;
  if (!useLive(hasOpenAI(), "OpenAI")) return 0;

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
            "You select the single best start frame for an image-to-video product ad. " +
            "Prefer the image that is sharpest, most front-on, fills the frame, and shows the " +
            "brand logo/text most clearly and undistorted (it will be animated, so detail here " +
            'matters most). Reply ONLY with JSON: { "index": number } — a 0-based index into the list.',
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Pick the best start frame for a ${opts.productType || "product"} video. Images in order, index 0..${urls.length - 1}:`,
            },
            ...urls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
          ] as any,
        },
      ],
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
    const idx = Number(parsed.index);
    return Number.isInteger(idx) && idx >= 0 && idx < urls.length ? idx : 0;
  } catch (err) {
    rethrowBudget(err);
    console.warn("[video-generator] pickBestStartFrame failed, using frame 0:", err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Stage 1b' — choose the start (and optional end) keyframe (OpenAI vision)
// ---------------------------------------------------------------------------
//
// GPT sees the product images AND the user's description of the desired video, then
// decides which image the clip should start on and (optionally) end on. This replaces
// blind start = productImages[0]: because the engine can only animate content visible
// in the chosen frame(s) and INTERPOLATES start -> end, the keyframes must match the
// requested motion. Example: "turn around" => start = a front view, end = the back view
// (so the revealed back, including its text, comes from a REAL frame instead of being
// hallucinated). GPT — not Claude — makes this call since it actually sees the images.
//
// Engine constraint reflected in the prompt: image2video REQUIRES a start frame; the
// end frame (image_tail) is optional. So "showcase the back" => start = back, end = null;
// "turn around to the back" => start = front, end = back.
//
// Always safe: any failure resolves to { startIndex: 0, endIndex: null }.
export interface KeyframeSelection {
  startIndex: number;
  endIndex: number | null;
  startView?: string;
  endView?: string | null;
  motion?: string;
  reasoning?: string;
}

export async function selectKeyframes(opts: {
  imageUrls: string[];
  userInstructions?: string;
  productType?: string;
}): Promise<KeyframeSelection> {
  const urls = opts.imageUrls ?? [];
  if (urls.length <= 1) return { startIndex: 0, endIndex: null };
  if (!useLive(hasOpenAI(), "OpenAI")) return { startIndex: 0, endIndex: null };

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
            "You select the keyframes for an image-to-video product ad. The engine animates FROM " +
            "a start frame and, if an end frame is given, INTERPOLATES from the start frame to the " +
            "end frame. It can ONLY show product sides/details that appear in the chosen frame(s) — " +
            "it cannot invent an unseen side, so any side the video should reveal MUST be one of the " +
            "images. The engine REQUIRES a start frame; the end frame is OPTIONAL.\n" +
            "Given the indexed product images and the user's description of the desired video, choose:\n" +
            "- startIndex: the image the clip starts on (required).\n" +
            "- endIndex: the image the clip should end on, or null if a single viewpoint is enough.\n" +
            "Rules: If the user asks to turn/rotate/flip or reveal another side (e.g. 'turn around' " +
            "=> the BACK), set endIndex to the image showing that side and startIndex to the opposite/" +
            "front view. If the user wants to focus on one side (e.g. 'show the back'), set startIndex " +
            "to that side and endIndex null. Never choose an end frame for a side that isn't in the " +
            "images. Prefer the cleanest, most front-on, full-product shots over crops unless a crop " +
            "is clearly the right focus.\n" +
            'Reply ONLY with JSON: { "startIndex": number, "endIndex": number|null, "startView": ' +
            'string, "endView": string|null, "motion": string, "reasoning": string }. startView/endView ' +
            "describe what each chosen frame shows; motion is the camera/subject motion that suits those " +
            "frames (e.g. '180° turn from front to back', or 'gentle push-in, no turn').",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `Desired video (user's words): "${opts.userInstructions || "(none given)"}".\n` +
                `Product type: ${opts.productType || "product"}.\n` +
                `Images in index order (0..${urls.length - 1}):`,
            },
            ...urls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
          ] as any,
        },
      ],
      response_format: { type: "json_object" },
    });
    const p = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
    const inRange = (n: any) => Number.isInteger(n) && n >= 0 && n < urls.length;
    const startIndex = inRange(p.startIndex) ? p.startIndex : 0;
    let endIndex: number | null = inRange(p.endIndex) ? p.endIndex : null;
    if (endIndex === startIndex) endIndex = null; // a tail equal to the start is a no-op
    return {
      startIndex,
      endIndex,
      startView: typeof p.startView === "string" ? p.startView : undefined,
      endView: typeof p.endView === "string" ? p.endView : null,
      motion: typeof p.motion === "string" ? p.motion : undefined,
      reasoning: typeof p.reasoning === "string" ? p.reasoning : undefined,
    };
  } catch (err) {
    rethrowBudget(err);
    console.warn("[video-generator] selectKeyframes failed, using frame 0:", err);
    return { startIndex: 0, endIndex: null };
  }
}

// ---------------------------------------------------------------------------
// Stage 0b (Personalized Model) — pair product photos with model poses (OpenAI vision)
// ---------------------------------------------------------------------------
//
// Before virtual try-on, GPT matches GARMENT product photos to MODEL pose photos by
// ORIENTATION: the garment's front with a front-facing pose, its back with a back pose,
// etc. — so a shirt front is never wrapped onto a model's back (and vice versa). Model
// poses carry a user-entered angle label; the garment's shown side is inferred from the
// image. Returns up to `maxPairs` pairs, each using a DISTINCT pose. This is what caps
// the flow to a small number of try-on generations regardless of how many photos were
// uploaded. Always safe: any failure resolves to a best-effort index-aligned fallback.
export interface TryOnPair {
  productIndex: number;
  poseIndex: number;
  reason?: string;
}

export async function selectTryOnPairs(opts: {
  products: { url: string; angle?: string }[];
  poses: { url: string; angle?: string }[];
  maxPairs?: number;
}): Promise<TryOnPair[]> {
  const products = opts.products ?? [];
  const poses = opts.poses ?? [];
  if (products.length === 0 || poses.length === 0) return [];
  const maxPairs = Math.max(1, Math.min(opts.maxPairs ?? 2, poses.length));

  // Best-effort fallback (also the mock path): pair the first `maxPairs` poses each with
  // the product at the same index (clamped to the last product).
  const fallback = (): TryOnPair[] =>
    poses
      .slice(0, maxPairs)
      .map((_, i) => ({ productIndex: Math.min(i, products.length - 1), poseIndex: i }));

  if (!useLive(hasOpenAI(), "OpenAI")) return fallback();

  try {
    const { default: OpenAI } = await import("openai");
    const client = meterOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 90000 }));
    const model = process.env.OPENAI_DESCRIBE_MODEL || "gpt-5.4-mini";
    const productAngleList = products.map((p, i) => `${i}=${p.angle || "unlabeled"}`).join(", ");
    const poseAngleList = poses.map((p, i) => `${i}=${p.angle || "unlabeled"}`).join(", ");
    const content: any[] = [
      {
        type: "text",
        text:
          `Prepare virtual try-on: choose up to ${maxPairs} (product photo, model pose) pairs, each using a DIFFERENT model pose. ` +
          `Match the garment's shown side to the model's orientation — the garment FRONT with a front-facing pose, its BACK with a back pose, a side with a side pose — so the garment is never applied reversed or to the wrong side. ` +
          `Use BOTH the product and pose angle labels below (and what each photo shows) to decide. If a side has no compatible counterpart, omit it rather than forcing a mismatch.\n` +
          `PRODUCT photos follow, indexed 0..${products.length - 1} (angle labels: ${productAngleList}):`,
      },
      ...products.map((p) => ({ type: "image_url" as const, image_url: { url: p.url } })),
      {
        type: "text",
        text: `MODEL poses follow, indexed 0..${poses.length - 1} (angle labels: ${poseAngleList}):`,
      },
      ...poses.map((p) => ({ type: "image_url" as const, image_url: { url: p.url } })),
      {
        type: "text",
        text:
          'Reply ONLY with JSON: { "pairs": [ { "productIndex": number, "poseIndex": number, "reason": string } ] }.',
      },
    ];
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a meticulous fashion visual analyst pairing garment product photos with model pose photos for virtual try-on. Use the model angle labels and what each garment photo shows to match orientation, and never pair mismatched sides.",
        },
        { role: "user", content: content as any },
      ],
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
    const raw = Array.isArray(parsed.pairs) ? parsed.pairs : [];
    const seenPoses = new Set<number>();
    const pairs: TryOnPair[] = [];
    for (const r of raw) {
      const pi = Number(r.productIndex);
      const qi = Number(r.poseIndex);
      if (!Number.isInteger(pi) || pi < 0 || pi >= products.length) continue;
      if (!Number.isInteger(qi) || qi < 0 || qi >= poses.length) continue;
      if (seenPoses.has(qi)) continue; // one try-on per pose
      seenPoses.add(qi);
      pairs.push({
        productIndex: pi,
        poseIndex: qi,
        reason: typeof r.reason === "string" ? r.reason : undefined,
      });
      if (pairs.length >= maxPairs) break;
    }
    return pairs.length ? pairs : fallback();
  } catch (err) {
    rethrowBudget(err);
    console.warn("[video-generator] selectTryOnPairs failed, using fallback:", err);
    return fallback();
  }
}

// ---------------------------------------------------------------------------
// Stage 1c — detect the logo/brand-mark region (OpenAI vision) [P4: region lock]
// ---------------------------------------------------------------------------
//
// Returns a normalized bounding box (0..1, origin top-left) of the dominant
// logo/brand mark so a static mask can be rendered over it. `present:false` means
// no lockable mark was found (caller should skip masking). Safe to call: any error
// resolves to { present:false }.
export interface LogoRegion {
  present: boolean;
  // normalized [x, y, w, h] within the image, 0..1
  bbox?: [number, number, number, number];
  label?: string;
}

export async function detectLogoRegion(imageUrl: string): Promise<LogoRegion> {
  if (!useLive(hasOpenAI(), "OpenAI")) return { present: false };
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
            "You locate the single most prominent brand logo / wordmark on a product. " +
            'Reply ONLY with JSON: { "present": boolean, "label": string, "bbox": [x, y, w, h] } ' +
            "where x,y,w,h are fractions of the image (0..1), origin top-left, tightly enclosing " +
            'the mark with a small margin. If there is no clear logo/text, return { "present": false }.',
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Find the main logo/brand mark and give its bounding box." },
            { type: "image_url" as const, image_url: { url: imageUrl } },
          ] as any,
        },
      ],
      response_format: { type: "json_object" },
    });
    const p = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
    const b = Array.isArray(p.bbox) ? p.bbox.map(Number) : null;
    const valid =
      b &&
      b.length === 4 &&
      b.every((n: number) => Number.isFinite(n) && n >= 0 && n <= 1) &&
      b[2] > 0 &&
      b[3] > 0;
    if (!p.present || !valid) return { present: false };
    return { present: true, bbox: b as [number, number, number, number], label: p.label };
  } catch (err) {
    rethrowBudget(err);
    console.warn("[video-generator] detectLogoRegion failed:", err);
    return { present: false };
  }
}

// ---------------------------------------------------------------------------
// P7 — provider abstraction + Runway provider (offline bake-off only)
// ---------------------------------------------------------------------------
//
// The production pipeline writes ProviderRequest rows keyed to ProviderName, whose
// enum is {OPENAI, ANTHROPIC, KLING, AWS, INTERNAL} — adding RUNWAY would need a
// database migration. So alternative providers live behind this interface and are
// exercised only against the eval set — never the live workspace path.
export interface VideoProvider {
  name: string;
  isConfigured(): boolean;
  createTask(opts: CreateVideoOpts): Promise<{ externalTaskId: string; raw?: unknown }>;
  pollStatus(externalTaskId: string): Promise<ProviderTaskStatus>;
}

export const klingProvider: VideoProvider = {
  name: "kling",
  isConfigured: () => hasKling(),
  createTask: klingCreateVideoTask,
  pollStatus: klingVideoStatus,
};

// Runway Gen-3/4 image-to-video. Real API shape (developer.runwayml.com); gated on
// RUNWAY_API_KEY so it's inert unless explicitly configured for a bake-off.
export const runwayProvider: VideoProvider = {
  name: "runway",
  isConfigured: () => !!process.env.RUNWAY_API_KEY,
  async createTask(opts) {
    const key = process.env.RUNWAY_API_KEY;
    if (!key) throw new Error("Missing RUNWAY_API_KEY");
    const base = process.env.RUNWAY_API_BASE || "https://api.dev.runwayml.com";
    return metered("RUNWAY", process.env.RUNWAY_VIDEO_MODEL || "gen4_turbo", "video", async () => {
    const resp = await fetch(`${base}/v1/image_to_video`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Runway-Version": process.env.RUNWAY_API_VERSION || "2024-11-06",
      },
      body: JSON.stringify({
        model: process.env.RUNWAY_VIDEO_MODEL || "gen4_turbo",
        promptImage: opts.imageUrl,
        promptText: opts.prompt.slice(0, 1000),
        duration: (opts.durationSeconds ?? 5) >= 8 ? 10 : 5,
        ratio: opts.aspectRatio && opts.aspectRatio !== "auto" ? opts.aspectRatio : "9:16",
        ...(typeof opts.seed === "number" ? { seed: opts.seed } : {}),
      }),
    });
    const json: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !json?.id) {
      throw new Error(json?.error || `Runway image_to_video create failed (${resp.status})`);
    }
    return { externalTaskId: json.id, raw: json };
    }, { maxInput: 0, maxOutput: 0, units: (opts.durationSeconds ?? 5) >= 8 ? 10 : 5 });
  },
  async pollStatus(externalTaskId) {
    const key = process.env.RUNWAY_API_KEY;
    if (!key) throw new Error("Missing RUNWAY_API_KEY");
    const base = process.env.RUNWAY_API_BASE || "https://api.dev.runwayml.com";
    const resp = await fetch(`${base}/v1/tasks/${encodeURIComponent(externalTaskId)}`, {
      headers: {
        Authorization: `Bearer ${key}`,
        "X-Runway-Version": process.env.RUNWAY_API_VERSION || "2024-11-06",
      },
    });
    const json: any = await resp.json().catch(() => ({}));
    const s = String(json?.status || "").toUpperCase();
    let state: ProviderTaskState = "pending";
    if (s === "SUCCEEDED") state = "succeeded";
    else if (["FAILED", "CANCELLED"].includes(s)) state = "failed";
    else if (["RUNNING", "THROTTLED"].includes(s)) state = "running";
    return {
      externalTaskId,
      state,
      outputUrls: Array.isArray(json?.output) ? json.output.filter(Boolean) : [],
      error: state === "failed" ? json?.failure || "Runway task failed" : undefined,
      raw: json,
    };
  },
};

// ---------------------------------------------------------------------------
// Stage 2 — plan/prompt (Anthropic)
// ---------------------------------------------------------------------------

export async function generatePromptText(opts: {
  model?: string;
  onUsage?: (usage: import("./rag/cache").PromptUsage) => void;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  if (!useLive(hasAnthropic(), "Anthropic")) {
    // Deterministic mock prompt.
    return JSON.stringify({
      finalPrompt:
        "High-quality product video ad: slow dolly-in on the product, soft studio lighting, " +
        "subtle motion, premium e-commerce look.",
      negativePrompt: "distorted product, deformed shape, text artifacts, watermark, low quality",
    });
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 90000 });
  const model = opts.model || process.env.ANTHROPIC_PROMPT_MODEL || "claude-opus-4-8";

  // Deterministic fallback prompt (same shape parsePromptOutput expects) used when the
  // Anthropic call ultimately fails. Degrading to this keeps the generation alive with
  // a sensible, fidelity-safe prompt instead of hard-failing on a transient blip.
  const fallbackPrompt = () =>
    JSON.stringify({
      finalPrompt:
        "High-quality product video ad: slow, subtle camera motion on the product, soft studio " +
        "lighting, premium e-commerce look. Keep the product and any model exactly as shown.",
      negativePrompt:
        "distorted product, deformed shape, altered logo, garbled text, watermark, low quality",
    });

  let resp: any;
  try {
    resp = await withProviderRetry("generatePromptText", () =>
      metered("ANTHROPIC", model, "prompt", () => client.messages.create({
        model,
        max_tokens: opts.maxTokens ?? 4096,
        system: process.env.RAG_PREFIX_CACHE === "1" ? [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }] : opts.system,
        messages: [{ role: "user", content: opts.user }],
      } as any), { maxInput: Math.max(32768, opts.system.length + opts.user.length), maxOutput: opts.maxTokens ?? 4096 }),
    );
  } catch (err) {
    rethrowBudget(err);
    console.error(
      "[video-generator] generatePromptText failed after retries; degrading to a generic prompt:",
      (err as any)?.status ?? "",
      (err as any)?.message ?? err,
    );
    return fallbackPrompt();
  }

  if (resp?.usage) opts.onUsage?.({ inputTokens: resp.usage.input_tokens || 0, outputTokens: resp.usage.output_tokens || 0, cacheReadTokens: resp.usage.cache_read_input_tokens || 0, cacheWriteTokens: resp.usage.cache_creation_input_tokens || 0 });
  const text = ((resp as any).content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  return text || "{}";
}

// ---------------------------------------------------------------------------
// Stage 3 — image2video (Kling)
// ---------------------------------------------------------------------------

function klingToken(): string {
  const apiKey = (process.env.KLING_API_KEY || "").trim();
  if (!apiKey) throw new Error("Missing KLING_API_KEY");
  return apiKey;
}

function klingBase(): string {
  return process.env.KLING_API_BASE || "https://api-singapore.klingai.com";
}

export interface CreateVideoOpts {
  prompt: string;
  negativePrompt?: string;
  imageUrl: string; // start frame (public URL or data URL)
  imageUrlEnd?: string; // optional tail frame
  durationSeconds?: number;
  aspectRatio?: string; // "16:9" | "9:16" | "1:1" | "4:5" | "auto"
  resolution?: string; // "720p" | "1080p" — output resolution (P2: fidelity)
  // P5 (QA auto-retry): a stricter re-render raises cfg, varies the seed, and tightens
  // the prompt so a low-fidelity result is re-rolled rather than shipped.
  cfgScale?: number;
  seed?: number;
  // P4 (region locking): a black/white mask URL whose white area Kling holds STATIC
  // (no motion) — used to pin the logo region so it isn't repainted frame to frame.
  staticMaskUrl?: string;
}

/** Kling's supported image2video output resolutions. Single source of truth so the
 * UI selector, the request validator, and the request body stay in sync. */
export const KLING_RESOLUTIONS = ["1080p", "720p"] as const;
export type KlingResolution = (typeof KLING_RESOLUTIONS)[number];

/** Resolve the output resolution for a render: per-request override → env default →
 * 1080p. P2: previously NO resolution was sent and Kling defaulted to its lowest tier,
 * which is a primary cause of mushy logo/text detail. */
function resolveResolution(requested?: string): KlingResolution {
  const pick = (requested || process.env.KLING_RESOLUTION || "1080p").toLowerCase();
  return (KLING_RESOLUTIONS as readonly string[]).includes(pick)
    ? (pick as KlingResolution)
    : "1080p";
}

export async function klingCreateVideoTask(
  opts: CreateVideoOpts,
): Promise<{ externalTaskId: string; raw?: unknown }> {
  if (!useLive(hasKling(), "Kling")) {
    // Deterministic mock task id (the status poll resolves it immediately).
    return { externalTaskId: `mock-video-${Buffer.from(opts.imageUrl).toString("base64url").slice(0, 16)}`, raw: { mock: true } };
  }

  // SSRF guard: refuse to hand internal/link-local URLs to the provider. Frames may
  // legitimately be data: URLs (inline) — those are not host fetches, so skip them.
  const guardUrl = (u?: string) => {
    if (u && !u.startsWith("data:")) assertPublicUrl(u);
  };
  guardUrl(opts.imageUrl);
  guardUrl(opts.imageUrlEnd);
  guardUrl(opts.staticMaskUrl);

  const duration = (opts.durationSeconds ?? 5) >= 8 ? "10" : "5";
  const resolution = resolveResolution(opts.resolution);
  const body: Record<string, any> = {
    model_name: process.env.KLING_VIDEO_MODEL || "kling-v3",
    mode: process.env.KLING_MODE || "pro",
    duration,
    image: opts.imageUrl,
    prompt: opts.prompt.slice(0, 2500),
    // Higher cfg_scale = stronger adherence / lower flexibility, so Kling follows the
    // "keep the product exactly, subtle motion" prompt more strictly (better logo/text
    // fidelity). Tunable via KLING_CFG_SCALE; default raised from 0.5 -> 0.8. A QA
    // retry can pass a higher per-request cfgScale (P5).
    cfg_scale: opts.cfgScale ?? (Number(process.env.KLING_CFG_SCALE) || 0.8),
    // P2: request a high output resolution explicitly (defaults low otherwise).
    resolution,
  };
  if (opts.negativePrompt) body.negative_prompt = opts.negativePrompt.slice(0, 2500);
  if (opts.imageUrlEnd) body.image_tail = opts.imageUrlEnd;
  if (typeof opts.seed === "number" && Number.isFinite(opts.seed)) body.seed = opts.seed;
  // P4: pin the logo region. Kling rejects masks alongside a tail frame, so only send
  // it for single-frame renders.
  if (opts.staticMaskUrl && !opts.imageUrlEnd) body.static_mask = opts.staticMaskUrl;
  if (!opts.imageUrlEnd && opts.aspectRatio && opts.aspectRatio !== "auto") {
    body.aspect_ratio = opts.aspectRatio;
  }

  // P0 (instrumentation): one structured line capturing every fidelity-relevant render
  // param + the start frame, so a generation's quality can be traced to its exact inputs
  // against the eval rubric. Prompt is truncated; the full text lives on PromptVersion.
  console.info(
    "[video-generator] kling.image2video.create",
    JSON.stringify({
      model_name: body.model_name,
      mode: body.mode,
      duration: body.duration,
      resolution: body.resolution,
      cfg_scale: body.cfg_scale,
      seed: body.seed ?? null,
      staticMask: !!body.static_mask,
      aspect_ratio: body.aspect_ratio ?? "auto",
      hasEndFrame: !!opts.imageUrlEnd,
      startFrameUrl: opts.imageUrl.startsWith("data:") ? "<data-url>" : opts.imageUrl,
      promptPreview: opts.prompt.slice(0, 240),
      negativePreview: (opts.negativePrompt ?? "").slice(0, 240),
    }),
  );

  return metered("KLING", body.model_name, "video", async () => {
  const resp = await fetch(`${klingBase()}/v1/videos/image2video`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${klingToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json: any = await resp.json().catch(() => ({}));
  if (!resp.ok || json?.code !== 0 || !json?.data?.task_id) {
    throw new Error(json?.message || `Kling image2video create failed (${resp.status})`);
  }
  return { externalTaskId: json.data.task_id, raw: json.data };
  }, { maxInput: 0, maxOutput: 0, units: Number(duration) });
}

export type ProviderTaskState = "pending" | "running" | "succeeded" | "failed";

export interface ProviderTaskStatus {
  externalTaskId: string;
  state: ProviderTaskState;
  outputUrls: string[];
  error?: string;
  raw?: unknown;
}

export async function klingVideoStatus(externalTaskId: string): Promise<ProviderTaskStatus> {
  if (externalTaskId.startsWith("mock-")) {
    return {
      externalTaskId,
      state: "succeeded",
      outputUrls: [`https://mock.local/${externalTaskId}.mp4`],
      raw: { mock: true },
    };
  }

  const resp = await fetch(`${klingBase()}/v1/videos/image2video/${encodeURIComponent(externalTaskId)}`, {
    headers: { Authorization: `Bearer ${klingToken()}`, "Content-Type": "application/json" },
  });
  const json: any = await resp.json().catch(() => ({}));
  const status = String(json?.data?.task_status || "").toLowerCase();
  let state: ProviderTaskState = "pending";
  if (["succeed", "succeeded", "completed"].includes(status)) state = "succeeded";
  else if (["failed", "error"].includes(status)) state = "failed";
  else if (["processing", "generating", "running"].includes(status)) state = "running";

  const videos = json?.data?.task_result?.videos || [];
  return {
    externalTaskId,
    state,
    outputUrls: videos.map((v: any) => v?.url).filter(Boolean),
    error: state === "failed" ? json?.data?.task_status_msg || "Kling task failed" : undefined,
    raw: json?.data,
  };
}

// ---------------------------------------------------------------------------
// Stage 0 (Personalized Model) — try-on via GPT-5.5 image generation
// ---------------------------------------------------------------------------
//
// The Personalized Model try-on uses an OpenAI image model (default gpt-5.5,
// overridable via OPENAI_TRYON_MODEL): given the model pose photo + the garment photo
// + their angle labels, generate a photorealistic image of that model wearing that
// exact garment, preserving the print/logo/text/colors. This is the ONLY try-on
// provider — there is no fallback.
//
// Returns the generated image bytes, or null if generation failed (the task is then
// marked failed). Mock-aware: without a live OpenAI key it returns placeholder bytes
// so the path is still exercised offline.
export interface TryOnGenResult {
  bytes: Buffer;
  mime: string;
}

function buildTryOnPrompt(opts: {
  poseAngle?: string;
  garmentAngle?: string;
  productDescription?: string;
}): string {
  return [
    "You are given two images. Image 1 is a photo of a person/model. Image 2 is a product garment.",
    "Generate ONE photorealistic image of the EXACT SAME model from image 1 now WEARING the exact garment from image 2. The ONLY thing that may differ between image 1 and your output is the clothing — nothing else about the person or the scene may change.",
    "STRICT MODEL FIDELITY — the person must remain IDENTICAL to image 1. Preserve exactly, with no alteration whatsoever: their identity and face (facial features, expression, jawline, eyes, nose, lips), skin tone and complexion, hair (style, length, colour), age, and gender; and their entire physique — height, overall body structure and build, body proportions, weight, shoulder width, limb length and thickness, hands and fingers, and their pose and stance. Do NOT slim, reshape, lengthen, enlarge, beautify, retouch, idealize, or otherwise modify the body or the face in any way. Do NOT change the camera framing, crop, background, or lighting. The model before and after wearing the garment must be recognisably the same person with the same body.",
    "Reproduce from image 2 EXACTLY: the garment's design, graphics, prints, logos, text, colors, patterns, fabric and proportions — do not alter, redraw, move, mirror, restyle, or invent any mark; copy them faithfully.",
    opts.poseAngle ? `The model is viewed from the ${opts.poseAngle}.` : "",
    opts.garmentAngle
      ? `The garment photo shows its ${opts.garmentAngle}; apply that side of the garment to the matching side of the model.`
      : "",
    opts.productDescription ? `Product context: ${opts.productDescription}.` : "",
    "Fit the garment naturally onto the unchanged body with correct drape and perspective; adapt only the garment to the body, never the body to the garment. Output only the final composed image.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Pull the generated image (base64) out of a Responses API result, tolerant to shape. */
function extractGeneratedImageB64(resp: any): string | null {
  const out = resp?.output || resp?.data || [];
  for (const item of Array.isArray(out) ? out : []) {
    if (item?.type === "image_generation_call" && typeof item.result === "string") return item.result;
    if (Array.isArray(item?.content)) {
      for (const c of item.content) {
        if (typeof c?.result === "string") return c.result;
        if (typeof c?.image_base64 === "string") return c.image_base64;
        if (c?.type === "output_image" && typeof c?.image_url === "string" && c.image_url.startsWith("data:")) {
          return c.image_url.split(",")[1] ?? null;
        }
      }
    }
  }
  return null;
}

export async function generateTryOnImage(opts: {
  poseUrl: string;
  garmentUrl: string;
  poseAngle?: string;
  garmentAngle?: string;
  productDescription?: string;
}): Promise<TryOnGenResult | null> {
  if (!useLive(hasOpenAI(), "OpenAI")) {
    // Mock: deterministic placeholder so the GPT primary path runs offline.
    return { bytes: Buffer.from(TRANSPARENT_PNG_BASE64, "base64"), mime: "image/png" };
  }

  const guardUrl = (u?: string) => {
    if (u && !u.startsWith("data:")) assertPublicUrl(u);
  };
  guardUrl(opts.poseUrl);
  guardUrl(opts.garmentUrl);

  try {
    const { default: OpenAI } = await import("openai");
    const client = meterOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 90000 }));
    const model = process.env.OPENAI_TRYON_MODEL || "gpt-5.5";
    const prompt = buildTryOnPrompt(opts);
    console.info(
      "[video-generator] gpt.tryon.generate",
      JSON.stringify({
        model,
        poseAngle: opts.poseAngle ?? null,
        garmentAngle: opts.garmentAngle ?? null,
        poseUrl: opts.poseUrl.startsWith("data:") ? "<data-url>" : opts.poseUrl,
        garmentUrl: opts.garmentUrl.startsWith("data:") ? "<data-url>" : opts.garmentUrl,
      }),
    );
    const resp: any = await (client as any).responses.create({
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: opts.poseUrl },
            { type: "input_image", image_url: opts.garmentUrl },
          ],
        },
      ],
      tools: [{ type: "image_generation" }],
    });
    const b64 = extractGeneratedImageB64(resp);
    if (!b64) {
      console.warn("[video-generator] gpt tryon returned no image");
      return null;
    }
    return { bytes: Buffer.from(b64, "base64"), mime: "image/png" };
  } catch (err) {
    rethrowBudget(err);
    console.warn("[video-generator] gpt tryon failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stage 0 (AI Model) — generate a synthetic model image (GPT-5.5)
// ---------------------------------------------------------------------------
//
// The AI Model flow has no uploaded model: the user picks fixed model settings
// (gender, age, skin tone) and we GENERATE a virtual model photo, which then feeds
// the same try-on → video path as Personalized Model.
//
// GPT-5.5 (OpenAI image generation) is the ONLY generator — there is NO Kling
// fallback. If GPT can't produce an image the generation fails (soft-fails + refunds
// in auto mode; surfaces the error in live mode). There is no free-text prompt — the
// model is described ENTIRELY from the user's chosen settings plus the fixed
// safety/fidelity instructions, so a user can't steer it off-spec or unsafe.
//
// CRITICAL: the generated model MUST be decently clothed (plain neutral base
// clothing) — never nude/underwear/swimwear — and MUST match the chosen gender, age
// and skin tone. Those constraints are hard-coded into the prompt below.
//
// Returns the generated image bytes (and which provider produced them), or null on
// failure. Mock-aware: offline it returns placeholder bytes tagged as the GPT path.
export type ModelGender = "MALE" | "FEMALE";
export type ModelAge = "CHILD" | "YOUTH" | "ELDERLY";
export type ModelSkinTone = "LIGHT" | "FAIR" | "MEDIUM" | "DEEP";

export interface VirtualModelSettings {
  gender: ModelGender;
  age: ModelAge;
  skinTone: ModelSkinTone;
}

export interface VirtualModelResult {
  bytes: Buffer;
  mime: string;
  // Which provider produced the image. GPT-5.5 is the only model generator, so this
  // is always "OPENAI" (kept as a field so the caller logs the provider explicitly).
  provider: "OPENAI";
}

const MODEL_GENDER_DESC: Record<ModelGender, string> = {
  MALE: "male",
  FEMALE: "female",
};
const MODEL_AGE_DESC: Record<ModelAge, string> = {
  CHILD: "child",
  YOUTH: "young adult",
  ELDERLY: "elderly",
};
const MODEL_SKIN_TONE_DESC: Record<ModelSkinTone, string> = {
  LIGHT: "light, warm-toned",
  FAIR: "fair, porcelain",
  MEDIUM: "medium, tan brown",
  DEEP: "deep, dark brown",
};

function buildVirtualModelPrompt(s: VirtualModelSettings): string {
  const gender = MODEL_GENDER_DESC[s.gender] ?? "person";
  const age = MODEL_AGE_DESC[s.age] ?? "adult";
  const skin = MODEL_SKIN_TONE_DESC[s.skinTone] ?? "natural";
  return [
    "Generate ONE photorealistic, full-length studio photograph of a single fashion model.",
    // Stick strictly to the user's chosen settings — these are hard requirements.
    `The model MUST match these exact specifications and must not deviate from any of them: ` +
      `gender = ${gender}; age group = ${age}; skin tone = ${skin}. ` +
      `Do not change the gender, the age group, or the skin tone under any circumstances.`,
    "The model stands in a relaxed, natural, front-facing pose with arms at their sides, against a plain light-grey seamless studio backdrop under soft, even lighting.",
    // HARD safety + clothing guardrail — the model MUST be decently clothed so the
    // try-on step has a clean base garment to replace, and no unsafe image is produced.
    "STRICT SAFETY REQUIREMENT (overrides everything else): the model must be FULLY CLOTHED and modest at all times, " +
      "dressed in simple, plain, neutral-colored fitted base clothing — a plain crew-neck t-shirt and plain full-length trousers — " +
      "with absolutely no text, logos, graphics, or patterns. " +
      "NEVER produce nudity, partial nudity, exposed or suggestive intimate body parts, underwear, lingerie, swimwear, or revealing/sexualized clothing. " +
      "If anything would conflict with this rule, keep the model fully and decently clothed.",
    "Show exactly ONE person — no other people and no text overlays. Natural, realistic human anatomy and body proportions; " +
      "the whole body from head to feet visible in frame; sharp focus; high detail; professional e-commerce model photography.",
  ].join(" ");
}

export async function generateVirtualModel(
  settings: VirtualModelSettings,
): Promise<VirtualModelResult | null> {
  const mode = providerMode();
  if (mode === "mock") {
    // Deterministic placeholder tagged as the GPT (primary) path so the flow runs offline.
    return { bytes: Buffer.from(TRANSPARENT_PNG_BASE64, "base64"), mime: "image/png", provider: "OPENAI" };
  }

  const prompt = buildVirtualModelPrompt(settings);
  console.info(
    "[video-generator] model.generate",
    JSON.stringify({
      gender: settings.gender,
      age: settings.age,
      skinTone: settings.skinTone,
      promptPreview: prompt.slice(0, 240),
    }),
  );

  // GPT-5.5 image generation is the ONLY model generator (no Kling fallback).
  if (hasOpenAI()) {
    try {
      const gpt = await generateModelImageOpenAI(prompt);
      if (gpt) return { ...gpt, provider: "OPENAI" };
      console.warn("[video-generator] GPT model gen returned no image");
    } catch (err) {
    rethrowBudget(err);
      // Live mode surfaces the real provider error; auto degrades to null so the
      // pipeline fails softly and refunds.
      if (mode === "live") throw err;
      console.warn("[video-generator] GPT model gen failed:", err);
    }
  }

  if (mode === "live") {
    throw new Error("PROVIDER_MODE=live but OpenAI produced no model");
  }
  return null;
}

/** The model generator — GPT-5.5 image generation (text→image, no reference images).
 * Returns bytes or null; a thrown error is handled by the caller. */
async function generateModelImageOpenAI(prompt: string): Promise<TryOnGenResult | null> {
  const { default: OpenAI } = await import("openai");
  const client = meterOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 90000 }));
  const model = process.env.OPENAI_MODEL_GEN_MODEL || process.env.OPENAI_TRYON_MODEL || "gpt-5.5";
  const resp: any = await (client as any).responses.create({
    model,
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
    tools: [{ type: "image_generation" }],
  });
  const b64 = extractGeneratedImageB64(resp);
  if (!b64) return null;
  return { bytes: Buffer.from(b64, "base64"), mime: "image/png" };
}

// ---------------------------------------------------------------------------
// Stage 0 (AI Model) — pick the two keyframe angles + combined model+try-on gen
// ---------------------------------------------------------------------------
//
// The AI Model flow generates the model ALREADY WEARING the product, in a chosen
// angle, as a single generation — done twice to produce the video's two keyframes.
// GPT-5.5 first picks which of the user's labeled angles to use for the start and end
// keyframes, strategically for the motion the user asked for (turn/rotate → opposite
// views; subtle motion → same or adjacent view). There is NO separate pairing or
// keyframe-selection step — these two generations ARE the keyframes.

export interface ModelAnglePlan {
  startIndex: number;
  endIndex: number;
  startAngle?: string;
  endAngle?: string;
  reasoning?: string;
}

export async function planModelAngles(opts: {
  candidates: { url: string; angle?: string }[];
  /** The user's brief for the video — read for whatever movement it implies. */
  motion: string;
  productType?: string;
}): Promise<ModelAnglePlan> {
  const cands = opts.candidates ?? [];
  if (cands.length === 0) return { startIndex: 0, endIndex: 0 };
  if (cands.length === 1) {
    return { startIndex: 0, endIndex: 0, startAngle: cands[0].angle, endAngle: cands[0].angle };
  }
  const fallback = (): ModelAnglePlan => {
    const end = Math.min(1, cands.length - 1);
    return { startIndex: 0, endIndex: end, startAngle: cands[0].angle, endAngle: cands[end].angle };
  };
  if (!useLive(hasOpenAI(), "OpenAI")) return fallback();

  try {
    const { default: OpenAI } = await import("openai");
    const client = meterOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 90000 }));
    const model = process.env.OPENAI_MODEL_GEN_MODEL || process.env.OPENAI_TRYON_MODEL || "gpt-5.5";
    const angleList = cands.map((c, i) => `${i}=${c.angle || "unlabeled"}`).join(", ");
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You plan the TWO keyframes of a short product video in which an AI model wears the product. " +
            "You are given the product photos' available ANGLES (by index) and the USER'S BRIEF for the video — " +
            "read whatever camera/subject motion the brief implies. " +
            "Pick the START angle and the END angle for the clip so together they best express that motion, using ONLY the available angles. " +
            "For a turn/rotation/reveal, choose opposite or complementary views (e.g. front → back). For subtle motion, START and END may be the same angle. " +
            "Never invent an angle that is not in the list.\n" +
            'Reply ONLY with JSON: { "startIndex": number, "endIndex": number, "reasoning": string } — 0-based indices into the angle list.',
        },
        {
          role: "user",
          content:
            `Available product angles: ${angleList}.\n` +
            `User's brief for the video: ${opts.motion}\n` +
            `Product type: ${opts.productType || "product"}.`,
        },
      ],
      response_format: { type: "json_object" },
    });
    const p = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
    const inRange = (n: any) => Number.isInteger(n) && n >= 0 && n < cands.length;
    const startIndex = inRange(p.startIndex) ? p.startIndex : 0;
    const endIndex = inRange(p.endIndex) ? p.endIndex : startIndex;
    return {
      startIndex,
      endIndex,
      startAngle: cands[startIndex].angle,
      endAngle: cands[endIndex].angle,
      reasoning: typeof p.reasoning === "string" ? p.reasoning : undefined,
    };
  } catch (err) {
    rethrowBudget(err);
    console.warn("[video-generator] planModelAngles failed, using fallback:", err);
    return fallback();
  }
}

function buildModelTryOnPrompt(opts: {
  settings: VirtualModelSettings;
  angle?: string;
  hasReferenceModel?: boolean;
}): string {
  const gender = MODEL_GENDER_DESC[opts.settings.gender] ?? "person";
  const age = MODEL_AGE_DESC[opts.settings.age] ?? "adult";
  const skin = MODEL_SKIN_TONE_DESC[opts.settings.skinTone] ?? "natural";
  const view = opts.angle ? ` viewed from the ${opts.angle}` : "";
  // Second keyframe: the FIRST image is the model to reuse (identity anchor) so the two
  // keyframes are the same person — otherwise the video morphs between two people.
  const lead = opts.hasReferenceModel
    ? "Image 1 is the EXACT model to reuse — keep that same person IDENTICALLY: same face, identity, skin tone, hair, age, gender, and body. The remaining image(s) are the product garment. " +
      `Generate that same model wearing the exact garment${view}, standing in a relaxed, natural pose`
    : `Generate ONE photorealistic, full-length studio photograph of a single ${age} ${gender} fashion model with a ${skin} skin tone, ` +
      `wearing the exact product garment shown in the reference image(s)${view}, standing in a relaxed, natural pose`;
  return [
    `${lead} against a plain light-grey seamless studio backdrop under soft, even lighting.`,
    // Stick to the user's chosen settings (only needed when not anchored to a reference).
    opts.hasReferenceModel
      ? ""
      : `The model MUST match these exact specifications and must not deviate: gender = ${gender}; age group = ${age}; skin tone = ${skin}.`,
    // Product fidelity — copy the garment exactly.
    "Reproduce the garment EXACTLY as in the reference image(s): its design, graphics, prints, logos, text, colors, patterns, fabric and proportions — " +
      "do not alter, redraw, move, mirror, restyle, or invent any mark; copy them faithfully. Fit it naturally onto the body with correct drape and perspective for this view.",
    // Light safety guardrail — does NOT override the product. The model wears the
    // product as designed, including brief/revealing items (lingerie, underwear,
    // swimwear) when that IS the product; we only avoid explicit exposure.
    "Safety: the model properly wears the product garment exactly as designed — including brief, fitted, or revealing items such as lingerie, underwear or swimwear when that is the product. " +
      "Keep genitalia and other private, intimate body parts covered, and avoid overtly sexualized or suggestive posing.",
    "Show exactly ONE person, whole body from head to feet visible in frame, no text overlays; sharp focus; high detail; professional e-commerce model photography. Output only the final composed image.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Combined AI-Model keyframe generator: produces the model (per settings) already
 * WEARING the product in one angle, as a single image. Pass `referenceModelUrl` (a
 * prior keyframe) to keep the same person for the second keyframe. GPT-5.5 only (no
 * Kling fallback). Mock-aware. */
export async function generateModelWearingProduct(opts: {
  settings: VirtualModelSettings;
  productImageUrls: string[];
  angle?: string;
  referenceModelUrl?: string;
}): Promise<VirtualModelResult | null> {
  const mode = providerMode();
  if (mode === "mock") {
    return { bytes: Buffer.from(TRANSPARENT_PNG_BASE64, "base64"), mime: "image/png", provider: "OPENAI" };
  }

  const prompt = buildModelTryOnPrompt({
    settings: opts.settings,
    angle: opts.angle,
    hasReferenceModel: !!opts.referenceModelUrl,
  });
  const guardUrl = (u?: string) => {
    if (u && !u.startsWith("data:")) assertPublicUrl(u);
  };
  opts.productImageUrls.forEach(guardUrl);
  guardUrl(opts.referenceModelUrl);
  console.info(
    "[video-generator] model.generate",
    JSON.stringify({
      gender: opts.settings.gender,
      age: opts.settings.age,
      skinTone: opts.settings.skinTone,
      angle: opts.angle ?? null,
      hasReference: !!opts.referenceModelUrl,
      promptPreview: prompt.slice(0, 200),
    }),
  );

  // PRIMARY: GPT-5.5 image generation (model + garment + angle in one shot).
  if (hasOpenAI()) {
    try {
      const { default: OpenAI } = await import("openai");
      const client = meterOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 90000 }));
      const model = process.env.OPENAI_MODEL_GEN_MODEL || process.env.OPENAI_TRYON_MODEL || "gpt-5.5";
      const content: any[] = [{ type: "input_text", text: prompt }];
      // Reference model first (identity anchor), then the product photo(s).
      if (opts.referenceModelUrl) content.push({ type: "input_image", image_url: opts.referenceModelUrl });
      for (const u of opts.productImageUrls) content.push({ type: "input_image", image_url: u });
      const resp: any = await (client as any).responses.create({
        model,
        input: [{ role: "user", content }],
        tools: [{ type: "image_generation" }],
      });
      const b64 = extractGeneratedImageB64(resp);
      if (b64) return { bytes: Buffer.from(b64, "base64"), mime: "image/png", provider: "OPENAI" };
      console.warn("[video-generator] GPT model+product gen returned no image");
    } catch (err) {
    rethrowBudget(err);
      // Live mode surfaces the real provider error; auto degrades to null so the
      // pipeline fails softly and refunds.
      if (mode === "live") throw err;
      console.warn("[video-generator] GPT model+product gen failed:", err);
    }
  }

  if (mode === "live") {
    throw new Error("PROVIDER_MODE=live but OpenAI produced no model+product keyframe");
  }
  return null;
}

/** Reject obviously-internal hosts (defense-in-depth SSRF guard). */
function assertPublicUrl(url: string): void {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("bad scheme");
    host = u.hostname;
  } catch {
    throw new Error("Refusing to fetch a malformed URL");
  }
  const blocked =
    /^(localhost|0\.0\.0\.0|127\.|10\.|169\.254\.|192\.168\.|::1$|\[?::1\]?)/i.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith(".internal") ||
    host.endsWith(".local");
  if (blocked) throw new Error("Refusing to fetch an internal host");
}

/**
 * Download provider output bytes. Mock URLs resolve to placeholder bytes that MATCH the
 * URL's media kind — an MP4 for `.mp4` (the image2video mock), the PNG otherwise. The
 * kind has to agree with the extension because the store stage keys off the URL suffix,
 * so a PNG behind a `.mp4` produced an asset no player could decode.
 */
export async function downloadResult(
  url: string,
): Promise<{ bytes: Buffer; mime: string }> {
  if (url.includes("mock.local")) {
    return url.endsWith(".mp4")
      ? { bytes: Buffer.from(MOCK_MP4_BASE64, "base64"), mime: "video/mp4" }
      : { bytes: Buffer.from(TRANSPARENT_PNG_BASE64, "base64"), mime: "image/png" };
  }
  assertPublicUrl(url);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download generated asset: ${resp.status}`);
  const mime = resp.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  const bytes = Buffer.from(await resp.arrayBuffer());
  return { bytes, mime };
}
