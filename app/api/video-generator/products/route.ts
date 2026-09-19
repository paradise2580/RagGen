// GET /api/video-generator/products — product picker for the studio.
// Source of truth is ProductRecord (+ its image URLs), so every product added to the
// catalog is visible here automatically.

import { NextResponse, type NextRequest } from "next/server";
import { gateVideoGenerator } from "@/lib/video-generator/context";
import { mapProductRecord } from "@/lib/video-generator/mappers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const MAX_PRODUCTS = 500;

export async function GET(req: NextRequest) {
  const gate = await gateVideoGenerator(req);
  if (!gate.ok) return gate.response;
  const { db } = gate.ctx;

  const url = new URL(req.url);
  const take = Math.min(parseInt(url.searchParams.get("take") || "200", 10), MAX_PRODUCTS);

  const products = await db.productRecord.findMany({
    orderBy: { updatedAt: "desc" },
    take,
  });

  // Only surface products that actually have an image (a video needs a source frame).
  const mapped = products
    .map(mapProductRecord)
    .filter((p) => (p.imageAssetIds?.length ?? 0) > 0);

  return NextResponse.json(mapped, { headers: noStore });
}
