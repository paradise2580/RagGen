// POST /api/video-generator/assets/:id/confirm — finalize a direct-to-S3 upload.
// Verifies the object landed in the shared bucket, then flips the asset to READY.
// Idempotent: a second confirm on a READY asset just returns it.

import { NextResponse, type NextRequest } from "next/server";
import { gateVideoGenerator, jsonError } from "@/lib/video-generator/context";
import { mapGenerationAsset } from "@/lib/video-generator/mappers";
import { objectExists } from "@/lib/video-generator/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await gateVideoGenerator(req);
  if (!gate.ok) return gate.response;
  const { db } = gate.ctx;

  const asset = await db.generationAsset.findUnique({ where: { id: params.id } });
  if (!asset) return jsonError("Asset not found", 404);

  if (asset.status === "READY") {
    return NextResponse.json({ asset: mapGenerationAsset(asset), warnings: [] }, { headers: noStore });
  }

  const warnings: string[] = [];
  if (!asset.s3Key || !(await objectExists(asset.s3Key))) {
    await db.generationAsset.update({ where: { id: asset.id }, data: { status: "FAILED" } });
    return jsonError("Uploaded object not found in storage", 400);
  }

  const updated = await db.generationAsset.update({
    where: { id: asset.id },
    data: { status: "READY" },
  });

  return NextResponse.json({ asset: mapGenerationAsset(updated), warnings }, { headers: noStore });
}
