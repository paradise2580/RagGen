import { usageScope } from "@/lib/video-generator/rag/usage";
// GET  /api/video-generator/generations — list this tenant's generation jobs
// POST /api/video-generator/generations — create a job (debits credits, kicks pipeline)

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { gateVideoGenerator, jsonError } from "@/lib/video-generator/context";
import { mapGenerationJob } from "@/lib/video-generator/mappers";
import { advanceJob, resolveWorkflowName } from "@/lib/video-generator/pipeline";
import {
  VIDEO_GENERATOR_VIDEO_CREDIT_COST,
  VIDEO_GENERATOR_TRYON_IMAGE_CREDIT_COST,
  consumeTenantCredits,
  InsufficientTenantCreditsError,
} from "@/lib/tenant-credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

import { productFacts, retrieveBrandContext } from "@/lib/video-generator/rag/retrieval";
import { RagError, type RagContext } from "@/lib/video-generator/rag/core";

const CreateBody = z.object({
  brandId: z.string().min(1).optional(),
  campaign: z.string().max(120).optional(),
  referenceCaptionId: z.string().optional(),
  serviceType: z.enum(["PRODUCT_VIDEO_AD", "PRODUCT_ON_MODEL_AD"]),
  modelType: z.enum(["AI_MODEL", "PERSONALIZED_MODEL", "NO_MODEL", "EXISTING_MODEL_PHOTO"]),
  productId: z.string().min(1),
  aspectRatio: z.enum(["auto", "9:16", "1:1", "16:9", "4:5"]).optional(),
  resolution: z.enum(["1080p", "720p"]).optional(),
  modelAssetId: z.string().optional(),
  // AI Model: the virtual-model settings. The pipeline generates a fully-clothed
  // synthetic model from these (GPT-5.5, Kling fallback), then virtual-try-ons the
  // product onto it. Required when modelType === "AI_MODEL". No free-text prompt —
  // the model is described entirely from these fixed settings plus safety guardrails.
  aiModel: z
    .object({
      gender: z.enum(["MALE", "FEMALE"]),
      age: z.enum(["CHILD", "YOUTH", "ELDERLY"]),
      skinTone: z.enum(["LIGHT", "FAIR", "MEDIUM", "DEEP"]),
    })
    .optional(),
  // Personalized Model: uploaded model poses, each with a user-entered angle label
  // (front, back, left side…). Every pose is virtual-try-on'd with the garment; the
  // angle is stored as metadata for the pipeline. Distinct from modelAssetId (a single
  // "animate this model image" start frame) — do not send both.
  modelPoses: z
    .array(z.object({ assetId: z.string().min(1), angle: z.string().max(60).optional() }))
    .max(8)
    .optional(),
  // Back-compat: bare asset-id list (no angle). Superseded by modelPoses.
  modelPoseAssetIds: z.array(z.string()).max(8).optional(),
  productImageAssetIds: z.array(z.string()).optional(),
  // Personalized Model: selected product photos with a user-entered angle label
  // (front, back, left side…). Used by the try-on pairing step to match a garment side
  // to a model pose. assetId matches an entry in productImageAssetIds.
  productImages: z
    .array(z.object({ assetId: z.string().min(1), angle: z.string().max(60).optional() }))
    .max(24)
    .optional(),
  shotDurationSeconds: z.union([z.literal(5), z.literal(10)]).optional(),
  sceneCount: z.number().int().min(1).max(6).optional(),
  // The user's own description of the video they want, typed in the composer. This is
  // the PRIMARY creative direction — the pipeline hands it verbatim to every LLM stage
  // (describe, keyframe choice, prompt) and tells the prompt model to follow it over
  // its own instincts. Replaced the fixed template/preset catalogue.
  //
  // Optional at the API layer, required by the composer: jobs created before this field
  // existed (and the direct-DB paths in scripts/) must still advance, so the pipeline
  // falls back to a neutral brief rather than 400-ing here. Capped so a pasted essay
  // can't blow the prompt model's context.
  userInstructions: z.string().trim().max(2000).optional(),
});

async function withProductNames(db: any, jobs: any[]) {
  const productIds = Array.from(new Set(jobs.map((j) => j.productId).filter(Boolean)));
  const products = productIds.length
    ? await db.productRecord.findMany({ where: { id: { in: productIds } }, select: { id: true, title: true } })
    : [];
  const nameById = new Map<string, string | null>(
    products.map((p: any) => [p.id as string, (p.title ?? null) as string | null]),
  );
  // generationNumber: 1-based index within product by createdAt asc
  const seqByProduct = new Map<string, number>();
  const ordered = [...jobs].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const numberById = new Map<string, number>();
  for (const j of ordered) {
    if (!j.productId) continue;
    const n = (seqByProduct.get(j.productId) ?? 0) + 1;
    seqByProduct.set(j.productId, n);
    numberById.set(j.id, n);
  }
  return jobs.map((j) =>
    mapGenerationJob(j, {
      productName: j.productId ? (nameById.get(j.productId) ?? null) : null,
      generationNumber: numberById.get(j.id) ?? null,
    }),
  );
}

export async function GET(req: NextRequest) {
  const gate = await gateVideoGenerator(req);
  if (!gate.ok) return gate.response;
  const { db } = gate.ctx;

  const jobs = await db.generationJob.findMany({
    orderBy: { createdAt: "desc" },
    include: { steps: true },
  });
  return NextResponse.json(await withProductNames(db, jobs), { headers: noStore });
}

export async function POST(req: NextRequest) {
  const gate = await gateVideoGenerator(req);
  if (!gate.ok) return gate.response;
  const { db, userId, tenantId } = gate.ctx;

  let input: z.infer<typeof CreateBody>;
  try {
    input = CreateBody.parse(await req.json());
  } catch (e: any) {
    return jsonError(e?.issues?.[0]?.message || "Invalid request", 400);
  }

  if (!resolveWorkflowName(input.serviceType, input.modelType)) {
    return jsonError(`Unsupported combination: ${input.serviceType} + ${input.modelType}`, 400);
  }

  const product = await db.productRecord.findUnique({ where: { id: input.productId } });
  if (!product) return jsonError("Product not found", 404);

  let ragContext: RagContext | null = null;
  if (input.brandId) {
    try {
      ragContext = await usageScope.run({ db, tenantId: tenantId || "raggen" }, () => retrieveBrandContext(db, tenantId || "standalone", input.brandId!, `${input.userInstructions || ""}\n${JSON.stringify(productFacts(product))}`, { serviceType: input.serviceType, modelType: input.modelType, campaign: input.campaign }));
    } catch (e) {
      return jsonError(e instanceof RagError ? e.message : "Brand knowledge is unavailable. No credits were charged.", e instanceof RagError ? e.status : 503);
    }
  }

  const route = await db.ragCache.findFirst({ where: { id: `prompt-route:${tenantId}`, expiresAt: { gt: new Date() } } });
  let referenceCaption: string | undefined;
  if (input.referenceCaptionId) {
    const reference = await db.ragVideoCaption.findFirst({ where: { id: input.referenceCaptionId, tenantId, status: "APPROVED" } });
    if (!reference) return jsonError("Approved reference not found", 404);
    if (input.brandId && reference.brandId && reference.brandId !== input.brandId) return jsonError("Reference belongs to a different brand", 400);
    referenceCaption = reference.text;
  }
  // Normalize the AI-model settings into a plain string map. Absent when not AI Model.
  const aiModelJson: Record<string, string> | undefined = input.aiModel
    ? {
        gender: input.aiModel.gender,
        age: input.aiModel.age,
        skinTone: input.aiModel.skinTone,
      }
    : undefined;

  // Personalized Model = a try-on job: one Kling virtual try-on render per uploaded
  // pose, then the normal video render. Reserve the try-on image cost on top of the
  // base video cost so the whole flow is charged (and refunded) atomically as one sum.
  if (input.modelType === "AI_MODEL" && !input.aiModel) {
    return jsonError("AI Model requires model settings (gender, age, skin tone).", 400);
  }
  const poseCount =
    input.modelType === "PERSONALIZED_MODEL"
      ? (input.modelPoses?.length ?? input.modelPoseAssetIds?.length ?? 0)
      : 0;
  if (input.modelType === "PERSONALIZED_MODEL" && poseCount === 0) {
    return jsonError("Personalized Model requires at least one model pose image.", 400);
  }
  // Cost = base video + per-generated-image add-ons (each billed at the try-on image
  // rate). Personalized: GPT pairs product↔pose and we run at most TRYON_MAX_PAIRS
  // try-ons, so charge for that many. AI Model: one generated model image + one try-on
  // onto it. Kept in sync with the pair-stage cap in pipeline.ts.
  const TRYON_MAX_PAIRS = 2;
  const imageAddonCount =
    input.modelType === "AI_MODEL" ? 2 : Math.min(TRYON_MAX_PAIRS, poseCount);
  const creditCost =
    VIDEO_GENERATOR_VIDEO_CREDIT_COST + imageAddonCount * VIDEO_GENERATOR_TRYON_IMAGE_CREDIT_COST;

  // Reserve credits up front (risk #4); refunded by the pipeline on failure.
  let charged = false;
  try {
    await consumeTenantCredits(db, creditCost);
    charged = true;
  } catch (err) {
    if (err instanceof InsufficientTenantCreditsError) {
      return NextResponse.json(
        { message: "INSUFFICIENT_CREDITS", code: "INSUFFICIENT_CREDITS", balance: err.remaining },
        { status: 402, headers: noStore },
      );
    }
    throw err;
  }

  let job: any;
  try {
    job = await db.generationJob.create({
      data: {
        createdByUserId: userId,
        productId: input.productId,
        serviceType: input.serviceType,
        modelType: input.modelType,
        status: "QUEUED",
        progress: 0,
        inputJson: {
          productId: input.productId,
          providerMode: process.env.PROVIDER_MODE === "mock" || (process.env.PROVIDER_MODE !== "live" && !process.env.KLING_API_KEY) ? "mock" : "live",
          promptModel: (route?.value as any)?.model || process.env.ANTHROPIC_PROMPT_MODEL || "claude-opus-4-8",
          referenceCaption,
          campaign: input.campaign,
          brandId: input.brandId,
          ragContext: ragContext as any,
          productFacts: productFacts(product),
          aspectRatio: input.aspectRatio ?? "auto",
          resolution: input.resolution ?? undefined,
          modelAssetId: input.modelAssetId,
          aiModel: aiModelJson,
          modelPoses: input.modelPoses,
          modelPoseAssetIds: input.modelPoseAssetIds,
          productImageAssetIds: input.productImageAssetIds,
          productImages: input.productImages,
          shotDurationSeconds: input.shotDurationSeconds,
          sceneCount: input.sceneCount,
          // The user's brief, stored verbatim on the job so every poll tick and retry
          // re-reads the same direction (see readInstructions in pipeline.ts).
          userInstructions: input.userInstructions,
          _creditCost: creditCost,
          _state: { stage: "validate", charged: true },
        },
      },
    });
  } catch (e) {
    if (charged) {
      const { refundTenantCredits } = await import("@/lib/tenant-credits");
      await refundTenantCredits(db, creditCost).catch(() => {});
    }
    throw e;
  }

  // Kick the first (fast, no external call) transition so the job is RUNNING when
  // we return; the rest is driven by client polling of GET /:id and the jobs tick.
  await advanceJob(db, job.id, { tenantId }).catch((e) =>
    console.warn("[video-generator] initial advance failed:", e),
  );

  const fresh = await db.generationJob.findUnique({ where: { id: job.id }, include: { steps: true } });
  return NextResponse.json(
    mapGenerationJob(fresh ?? job, { productName: product.title ?? null, generationNumber: null }),
    { headers: noStore },
  );
}
