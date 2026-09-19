// GET /api/video-generator/assets?type=<AssetType> — list generated/uploaded assets.
// These are GenerationAsset rows in the tenant DB (generated media + user uploads
// such as a model photo). Source PRODUCT images are not assets — they come from
// ProductRecord (see /api/video-generator/products).

import { NextResponse, type NextRequest } from "next/server";
import { gateVideoGenerator } from "@/lib/video-generator/context";
import { mapGenerationAsset } from "@/lib/video-generator/mappers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const gate = await gateVideoGenerator(req);
  if (!gate.ok) return gate.response;
  const { db } = gate.ctx;

  const url = new URL(req.url);
  const type = url.searchParams.get("type") || undefined;

  const assets = await db.generationAsset.findMany({
    where: {
      status: { not: "ARCHIVED" },
      ...(type ? { type: type as any } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(assets.map((a) => mapGenerationAsset(a)), { headers: noStore });
}
