// scripts/recover-video-job.ts
//
// One-off recovery for a video-generator job that FAILED at the store stage (the
// clip was produced by Kling but the S3 upload was denied by IAM before the fix).
// It downloads the Kling clip already persisted on the job's _state.videoUrl,
// stores it via uploadToS3 (legacy IAM-allowed prefix — same as the fixed store
// stage), creates the GENERATED_VIDEO asset, and marks the job SUCCEEDED.
//
// Self-contained: does NOT import tenant-db/pipeline (which pull in `server-only`).
//
// Run:
//   TENANT_DB_URL='postgresql://…' JOB_ID='…' TENANT_ID='…' \
//     tsx -r tsconfig-paths/register -r dotenv/config scripts/recover-video-job.ts
//   Add COMMIT=1 to actually write; otherwise it's a dry run.

import { PrismaClient } from "@/prisma/generated/tenant";
import { uploadToS3 } from "@/lib/upload-to-s3";

async function main() {
  const tenantDbUrl = process.env.TENANT_DB_URL;
  const jobId = process.env.JOB_ID;
  const tenantId = process.env.TENANT_ID;
  const commit = process.env.COMMIT === "1";
  if (!tenantDbUrl || !jobId || !tenantId) {
    throw new Error("Set TENANT_DB_URL, JOB_ID and TENANT_ID env vars");
  }

  const db = new PrismaClient({ datasourceUrl: tenantDbUrl });
  try {
    const job = await db.generationJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.status === "SUCCEEDED") {
      console.log("Job already SUCCEEDED — nothing to do."); return;
    }
    const state: any = (job.inputJson as any)?._state ?? {};
    const url: string | undefined = state.videoUrl || state.startFrameUrl;
    if (!url) throw new Error("Job has no videoUrl on its persisted state — cannot recover without re-generating.");

    console.log(`[recover] job=${jobId} status=${job.status} sourceUrl=${url.slice(0, 80)}…`);

    // Download the already-produced clip.
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Clip URL returned HTTP ${resp.status} — it may have expired; a re-generation is required.`);
    const mime = resp.headers.get("content-type") || "video/mp4";
    const bytes = Buffer.from(await resp.arrayBuffer());
    const isVideo = mime.includes("video") || url.endsWith(".mp4");
    console.log(`[recover] downloaded ${bytes.length}B (${mime})`);

    if (!commit) {
      console.log("[recover] DRY RUN — set COMMIT=1 to store the asset and mark the job SUCCEEDED.");
      return;
    }

    // Store to the shared bucket under an IAM-allowed prefix (same as fixed store stage).
    const { key, cdnUrl } = await uploadToS3({
      tenantId,
      type: isVideo ? "video" : "image",
      content: bytes,
      contentType: mime,
      extension: isVideo ? "mp4" : "png",
    });
    console.log(`[recover] uploaded to ${key}`);

    const asset = await db.generationAsset.create({
      data: {
        createdByUserId: job.createdByUserId ?? null,
        productId: job.productId ?? null,
        type: isVideo ? "GENERATED_VIDEO" : "GENERATED_IMAGE",
        source: "GENERATED",
        status: "READY",
        s3Key: key,
        cdnUrl,
        mime,
        size: bytes.length,
      },
    });

    // Mark the store step SUCCEEDED (update existing FAILED row or create one).
    const storeStep = await db.generationStep.findFirst({ where: { jobId, name: "store" } });
    if (storeStep) {
      await db.generationStep.update({
        where: { id: storeStep.id },
        data: { status: "SUCCEEDED", error: null, completedAt: new Date() },
      });
    } else {
      await db.generationStep.create({
        data: { jobId, name: "store", status: "SUCCEEDED", startedAt: new Date(), completedAt: new Date() },
      });
    }

    await db.generationJob.update({
      where: { id: jobId },
      data: {
        status: "SUCCEEDED",
        progress: 100,
        error: null,
        completedAt: new Date(),
        lockedAt: null,
        outputAssetIds: [asset.id],
        inputJson: { ...(job.inputJson as any), _state: { ...state, stage: "done", videoUrl: url } },
      },
    });

    console.log(`[recover] DONE — asset ${asset.id} created, job ${jobId} marked SUCCEEDED, cdnUrl=${cdnUrl}`);
  } finally {
    await db.$disconnect();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[recover] failed:", e?.message || e);
    process.exit(1);
  },
);
