import { requireS3Bucket } from "@/lib/s3-config";
// POST /api/video-generator/assets/upload-url — start a direct-to-S3 upload.
// Creates a PENDING GenerationAsset and returns a presigned PUT URL to the configured
// bucket. The browser PUTs the file, then calls .../confirm to mark it READY.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { gateVideoGenerator, jsonError } from "@/lib/video-generator/context";
import { mapGenerationAsset } from "@/lib/video-generator/mappers";
import {
  extFromMime,
  normalizeMime,
  unsupportedMediaMessage,
} from "@/lib/video-generator/media-formats";
import { presignUpload, type VideoGeneratorMediaPrefix } from "@/lib/video-generator/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

const Body = z.object({
  filename: z.string().min(1).max(512).optional(),
  mime: z.string().min(1),
  size: z.number().int().positive().optional(),
  type: z
    .enum(["PRODUCT_IMAGE", "GENERATED_IMAGE", "GENERATED_VIDEO", "BRAND_ASSET", "OTHER"])
    .optional(),
});

const UPLOAD_EXPIRY_SECONDS = 15 * 60;

export async function POST(req: NextRequest) {
  const gate = await gateVideoGenerator(req);
  if (!gate.ok) return gate.response;
  const { db, userId, tenantId } = gate.ctx;

  let input: z.infer<typeof Body>;
  try {
    input = Body.parse(await req.json());
  } catch (e: any) {
    return jsonError(e?.issues?.[0]?.message || "Invalid request", 400);
  }

  // Same gate as the proxy-upload route — a presigned PUT must not be the way an
  // AVIF/HEIC photo gets in behind the check. See media-formats.ts.
  const mime = normalizeMime(input.mime);
  const unsupported = unsupportedMediaMessage(mime);
  if (unsupported) return jsonError(unsupported, 415);

  const prefix: VideoGeneratorMediaPrefix = "originals";
  const { key, uploadUrl, cdnUrl } = await presignUpload({
    tenantId,
    prefix,
    contentType: mime,
    ext: extFromMime(mime),
    expiresIn: UPLOAD_EXPIRY_SECONDS,
  });

  const asset = await db.generationAsset.create({
    data: {
      createdByUserId: userId,
      type: (input.type ?? "OTHER") as any,
      source: "UPLOAD",
      status: "PENDING",
      s3Key: key,
      cdnUrl,
      mime,
      size: input.size ?? null,
    },
  });

  return NextResponse.json(
    {
      assetId: asset.id,
      uploadUrl,
      key,
      bucket: requireS3Bucket(),
      expiresInSeconds: UPLOAD_EXPIRY_SECONDS,
      // included for convenience; SPA primarily uses assetId + uploadUrl
      asset: mapGenerationAsset(asset),
    },
    { headers: noStore },
  );
}
