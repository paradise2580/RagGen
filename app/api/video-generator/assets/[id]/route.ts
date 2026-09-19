import { requireS3Bucket } from "@/lib/s3-config";
// GET /api/video-generator/assets/:id    — single asset
// DELETE /api/video-generator/assets/:id  — hard-delete (best-effort S3 cleanup)

import { NextResponse, type NextRequest } from "next/server";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3Client } from "@/lib/s3-client";
import { gateVideoGenerator, jsonError } from "@/lib/video-generator/context";
import { mapGenerationAsset } from "@/lib/video-generator/mappers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await gateVideoGenerator(req);
  if (!gate.ok) return gate.response;
  const { db } = gate.ctx;

  const asset = await db.generationAsset.findUnique({ where: { id: params.id } });
  if (!asset) return jsonError("Asset not found", 404);
  return NextResponse.json(mapGenerationAsset(asset), { headers: noStore });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await gateVideoGenerator(req);
  if (!gate.ok) return gate.response;
  const { db } = gate.ctx;

  const asset = await db.generationAsset.findUnique({ where: { id: params.id } });
  if (!asset) return jsonError("Asset not found", 404);

  if (asset.s3Key) {
    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: requireS3Bucket(),
          Key: asset.s3Key,
        }),
      );
    } catch (e) {
      console.warn("[video-generator] S3 delete failed (continuing):", e);
    }
  }

  await db.generationAsset.delete({ where: { id: asset.id } });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
