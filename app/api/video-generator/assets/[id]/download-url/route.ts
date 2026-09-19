// GET /api/video-generator/assets/:id/download-url — short-lived presigned GET URL.

import { NextResponse, type NextRequest } from "next/server";
import { gateVideoGenerator, jsonError } from "@/lib/video-generator/context";
import { presignDownload } from "@/lib/video-generator/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const DOWNLOAD_EXPIRY = 600;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await gateVideoGenerator(req);
  if (!gate.ok) return gate.response;
  const { db } = gate.ctx;

  const asset = await db.generationAsset.findUnique({ where: { id: params.id } });
  if (!asset) return jsonError("Asset not found", 404);
  if (!asset.s3Key) return jsonError("Asset has no stored object", 400);

  // Derive a friendly download filename (keeps the object's real extension).
  const ext = asset.s3Key.split(".").pop()?.slice(0, 5) || "bin";
  const filename = `${asset.type?.toLowerCase() ?? "asset"}-${asset.id}.${ext}`;
  const url = await presignDownload(asset.s3Key, DOWNLOAD_EXPIRY, filename);
  return NextResponse.json({ url, expiresInSeconds: DOWNLOAD_EXPIRY }, { headers: noStore });
}
