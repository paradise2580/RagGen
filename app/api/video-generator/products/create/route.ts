// POST /api/video-generator/products/create — create a MANUAL source product.
//
// Lets the studio add its own source products, so the picker can be filled from the UI
// rather than only by `npm run db:seed` or `npm run product:add` from a terminal.
//
// It is a SEPARATE FILE rather than a POST added to ../route.ts so the read routes stay
// small and this feature can be removed by deleting one file. Note `create` can never
// shadow ../[id] for a real product: ids are cuids.
//
// This is the HTTP equivalent of scripts/add-product.ts and writes the exact same row
// shape — `platform: "manual"` with `payload.images: string[]` — which is the one shape
// extractProductImageUrls() reads for manual products (branch 0b in product-images.ts).

import { NextResponse, type NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { gateVideoGenerator, jsonError } from "@/lib/video-generator/context";
import { mapProductRecord } from "@/lib/video-generator/mappers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/** Matches the picker's practical ceiling; a generation only ever uses a few frames. */
const MAX_IMAGES = 10;

const CreateBody = z.object({
  name: z.string().trim().min(1, "Product name is required").max(200),
  brand: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
  description: z.string().trim().max(5000).optional(),
  // At least one image is REQUIRED, and not just as a nicety: GET /products filters out
  // products with no resolvable image (a video needs a start frame), so an image-less
  // product would be created successfully and then be invisible in the UI.
  images: z
    .array(z.string().trim().url("Each image must be a URL"))
    .min(1, "At least one product image is required")
    .max(MAX_IMAGES),
});

export async function POST(req: NextRequest) {
  const gate = await gateVideoGenerator(req);
  if (!gate.ok) return gate.response;
  const { db, userId } = gate.ctx;

  let input: z.infer<typeof CreateBody>;
  try {
    input = CreateBody.parse(await req.json());
  } catch (e: any) {
    return jsonError(e?.issues?.[0]?.message || "Invalid request", 400);
  }

  // De-duplicate while preserving order — images[0] becomes the product's primary frame
  // (resolveProductImages), so the first one the user picked must stay first.
  const images = Array.from(new Set(input.images));

  // `payload` mirrors the platform-agnostic keys the mappers read, so a manual product
  // presents identically to a synced one: `vendor` → brand, `product_type` → category.
  // Typed as string | string[] rather than `unknown` so it satisfies Prisma's
  // InputJsonValue without a cast.
  const payload: Record<string, string | string[]> = { title: input.name, images };
  if (input.brand) payload.vendor = input.brand;
  if (input.category) payload.product_type = input.category;
  if (input.description) payload.description = input.description;

  // A uuid, not the `manual-${Date.now()}` that scripts/add-product.ts uses: there is a
  // @@unique([integrationId, externalProductId]), and two products created inside the same
  // millisecond would collide on a timestamp.
  const product = await db.productRecord.create({
    data: {
      integrationId: "standalone",
      externalProductId: `manual-${uuidv4()}`,
      platform: "manual",
      userId,
      title: input.name,
      payload,
    },
  });

  return NextResponse.json(mapProductRecord(product), { status: 201, headers: noStore });
}
