// POST /api/video-generator/generations/:id/retry — re-run a FAILED/CANCELED job.
// Re-reserves credits and resets the pipeline to the start.

import { NextResponse, type NextRequest } from "next/server";
import { gateVideoGenerator, jsonError } from "@/lib/video-generator/context";
import { mapGenerationJob } from "@/lib/video-generator/mappers";
import { advanceJob } from "@/lib/video-generator/pipeline";
import {
  VIDEO_GENERATOR_VIDEO_CREDIT_COST,
  VIDEO_GENERATOR_TRYON_IMAGE_CREDIT_COST,
  consumeTenantCredits,
  refundTenantCredits,
  InsufficientTenantCreditsError,
} from "@/lib/tenant-credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await gateVideoGenerator(req);
  if (!gate.ok) return gate.response;
  const { db, tenantId } = gate.ctx;

  const job = await db.generationJob.findUnique({ where: { id: params.id } });
  if (!job) return jsonError("Generation not found", 404);
  if (!["FAILED", "CANCELED"].includes(job.status)) {
    return jsonError("Only failed or canceled generations can be retried", 409);
  }

  // Recompute the full cost (base video + per-pose try-on) so a Personalized Model
  // retry re-reserves the same amount the original create did — mirrors the create
  // route so retries aren't silently under-charged.
  const retryInput = (job.inputJson as any) || {};
  const poseCount =
    job.modelType === "PERSONALIZED_MODEL"
      ? (Array.isArray(retryInput.modelPoses)
          ? retryInput.modelPoses.length
          : Array.isArray(retryInput.modelPoseAssetIds)
            ? retryInput.modelPoseAssetIds.length
            : 0)
      : 0;
  // Per-generated-image add-ons, billed at the try-on image rate — must match the
  // create route. Personalized: at most 2 try-ons (GPT pairs product↔pose). AI Model:
  // one generated model image + one try-on onto it.
  const imageAddonCount = job.modelType === "AI_MODEL" ? 2 : Math.min(2, poseCount);
  const creditCost =
    VIDEO_GENERATOR_VIDEO_CREDIT_COST + imageAddonCount * VIDEO_GENERATOR_TRYON_IMAGE_CREDIT_COST;

  try {
    await consumeTenantCredits(db, creditCost);
  } catch (err) {
    if (err instanceof InsufficientTenantCreditsError) {
      return NextResponse.json(
        { message: "INSUFFICIENT_CREDITS", code: "INSUFFICIENT_CREDITS", balance: err.remaining },
        { status: 402, headers: noStore },
      );
    }
    throw err;
  }

  // Reset the job to the start. If any reset step throws AFTER we've charged, refund
  // the credits we just reserved so the user isn't billed for a retry that never ran.
  try {
    await db.generationStep.deleteMany({ where: { jobId: params.id } });
    const input = retryInput;
    await db.generationJob.update({
      where: { id: params.id },
      data: {
        status: "QUEUED",
        progress: 0,
        error: null,
        outputAssetIds: [],
        attempts: 0,
        nextPollAt: null,
        lockedAt: null,
        externalTaskId: null,
        startedAt: null,
        completedAt: null,
        canceledAt: null,
        inputJson: { ...input, _creditCost: creditCost, _state: { stage: "validate", charged: true } },
      },
    });
  } catch (e) {
    await refundTenantCredits(db, creditCost).catch(() => {});
    throw e;
  }

  await advanceJob(db, params.id, { tenantId }).catch((e) =>
    console.warn("[video-generator] retry advance failed:", e),
  );

  const fresh = await db.generationJob.findUnique({ where: { id: params.id }, include: { steps: true } });
  const product = fresh?.productId
    ? await db.productRecord.findUnique({ where: { id: fresh.productId }, select: { title: true } })
    : null;
  return NextResponse.json(
    mapGenerationJob(fresh ?? job, { productName: product?.title ?? null }),
    { headers: noStore },
  );
}
