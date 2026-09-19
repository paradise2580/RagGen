// POST /api/video-generator/assets/upload — SAME-ORIGIN proxy upload.
//
// The browser posts the file bytes here (multipart/form-data) and the server writes
// them to S3 itself, then creates a READY GenerationAsset. This replaces the legacy
// presign → browser-PUT-to-S3 → confirm dance, which fails in the browser because the
// bucket has no CORS rule allowing a cross-origin PUT (the preflight OPTIONS 403s).
// Going through our own origin sidesteps CORS entirely and needs no bucket/IAM change.
// Writes land in the legacy writable+presignable image/video trees (see uploadToS3).

import { createHash } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { gateVideoGenerator, jsonError } from "@/lib/video-generator/context";
import { mapGenerationAsset } from "@/lib/video-generator/mappers";
import {
  extFromMime,
  normalizeMime,
  unsupportedMediaMessage,
} from "@/lib/video-generator/media-formats";
import { uploadToS3 } from "@/lib/upload-to-s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — generous for a source photo
const ALLOWED_ASSET_TYPES = new Set([
  "PRODUCT_IMAGE",
  "GENERATED_IMAGE",
  "GENERATED_VIDEO",
  "BRAND_ASSET",
  "OTHER",
]);

export async function POST(req: NextRequest) {
  const gate = await gateVideoGenerator(req);
  if (!gate.ok) return gate.response;
  const { db, userId, tenantId } = gate.ctx;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("Expected multipart/form-data with a file field", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("Missing file", 400);

  const mime = normalizeMime(file.type || "application/octet-stream");
  // Reject here rather than at render time: an AVIF/HEIC photo stores fine but makes
  // every provider hop fail, and the OpenAI stages swallow their 400s as degradations,
  // so the job runs on to a hard Kling failure. See media-formats.ts.
  const unsupported = unsupportedMediaMessage(mime);
  if (unsupported) return jsonError(unsupported, 415);
  if (file.size > MAX_BYTES) {
    return jsonError("File is too large (max 25 MB)", 413);
  }

  const typeField = String(form.get("type") ?? "PRODUCT_IMAGE");
  const assetType = ALLOWED_ASSET_TYPES.has(typeField) ? typeField : "OTHER";

  const bytes = Buffer.from(await file.arrayBuffer());
  // Content hash → gives the image a stable identity independent of its S3 key, so the
  // try-on cache can reuse a prior result even if the SAME file is re-uploaded as a new
  // asset (see the `tryon` stage in pipeline.ts).
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const isVideo = mime.startsWith("video/");
  // Server-side PutObject into the writable media tree (images/ or videos/).
  const { key, cdnUrl } = await uploadToS3({
    tenantId,
    type: isVideo ? "video" : "image",
    content: bytes,
    contentType: mime,
    extension: extFromMime(mime),
  });

  const asset = await db.generationAsset.create({
    data: {
      createdByUserId: userId,
      type: assetType as any,
      source: "UPLOAD",
      status: "READY",
      s3Key: key,
      cdnUrl,
      mime,
      size: bytes.length,
      checksum,
    },
  });

  return NextResponse.json(
    { asset: mapGenerationAsset(asset), warnings: [] },
    { headers: noStore },
  );
}
