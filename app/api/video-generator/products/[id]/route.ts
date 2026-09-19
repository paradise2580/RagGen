// GET /api/video-generator/products/:id — single product (from ProductRecord).

import { NextResponse, type NextRequest } from "next/server";
import { gateVideoGenerator, jsonError } from "@/lib/video-generator/context";
import { mapProductRecord } from "@/lib/video-generator/mappers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await gateVideoGenerator(req);
  if (!gate.ok) return gate.response;
  const { db } = gate.ctx;

  const product = await db.productRecord.findUnique({ where: { id: params.id } });
  if (!product) return jsonError("Product not found", 404);

  return NextResponse.json(mapProductRecord(product), { headers: noStore });
}
