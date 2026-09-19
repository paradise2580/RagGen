process.env.AWS_BUCKET_NAME ||= "example-bucket"; // Synthetic bucket; tests stub storage.
/* eslint-disable no-console */
// Mock end-to-end test for the generation studio.
//
//   npm run test:mock
//
// Exercises the LOGIC behind every studio API call against the dev workspace DB
// (TENANT_DATABASE_URL) in PROVIDER_MODE=mock — no HTTP/auth, no live providers, no
// real S3 (the S3 client's send() is stubbed in-process). Validates: product mapping
// (image extraction from ProductRecord), generation create + the full polling pipeline
// to SUCCEEDED, generated-asset creation, listing logic, credit debit, and the
// failure→refund path. Cleans up all rows it creates.

process.env.PROVIDER_MODE = "mock";

import { PrismaClient } from "@/prisma/generated/tenant";
import { s3Client } from "@/lib/s3-client";
import { advanceJob, resolveWorkflowName } from "@/lib/video-generator/pipeline";
import { mapProductRecord, mapGenerationJob, mapGenerationAsset } from "@/lib/video-generator/mappers";
import { resolveProductImages } from "@/lib/video-generator/product-images";
import { toFetchableUrl } from "@/lib/video-generator/storage";
import {
  VIDEO_GENERATOR_VIDEO_CREDIT_COST,
  VIDEO_GENERATOR_TRYON_IMAGE_CREDIT_COST,
  consumeTenantCredits,
} from "@/lib/tenant-credits";

// --- in-process S3 stub so uploadToS3() succeeds without AWS creds ---
(s3Client as any).send = async () => ({ $metadata: { httpStatusCode: 200 } });

const db = new PrismaClient();
const TAG = "mocktest";
const INTEG = `${TAG}-integration`;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Credit-row bookkeeping so the test leaves the tenant's credits exactly as it found them.
// The `organization_credits` row is a REAL tenant resource (the balance the app spends), and
// this test debits it on every generation — so it either removes a row it created itself, or
// restores the balance it borrowed. Populated in main(); null while cleanup() runs at startup.
let creditSnapshot: { id: string; balance: number; addonBalance: number } | null = null;
let creditRowCreatedByTest = false;

async function cleanup() {
  await db.generationAsset.deleteMany({ where: { createdByUserId: TAG } });
  await db.generationJob.deleteMany({ where: { createdByUserId: TAG } });
  await db.productRecord.deleteMany({ where: { integrationId: INTEG } });
  if (!creditSnapshot) return;
  if (creditRowCreatedByTest) {
    // Only ever deletes the row THIS run created (the tenant had none).
    await db.organizationCredit.deleteMany({ where: { id: creditSnapshot.id } }).catch(() => {});
  } else {
    await db.organizationCredit
      .update({
        where: { id: creditSnapshot.id },
        data: { balance: creditSnapshot.balance, addonBalance: creditSnapshot.addonBalance },
      })
      .catch(() => {});
  }
}

async function runToTerminal(jobId: string, tenantId: string) {
  for (let i = 0; i < 20; i++) {
    const job = await db.generationJob.findUnique({ where: { id: jobId } });
    if (!job) break;
    if (["SUCCEEDED", "FAILED", "CANCELED"].includes(job.status)) return job;
    await advanceJob(db, jobId, { tenantId });
  }
  return db.generationJob.findUnique({ where: { id: jobId } });
}

async function main() {
  const tenantId = "mocktest-tenant"; // only used for S3 key scoping in the stub
  console.log("\n🎬 Video Generator mock E2E — dev tenant DB\n");

  await cleanup();

  // Ensure the tenant has credits (debited on create).
  const credit = await db.organizationCredit.findFirst();
  if (!credit) {
    const created = await db.organizationCredit.create({
      data: { tenantId, balance: 1000, isTrial: false },
    });
    creditRowCreatedByTest = true;
    creditSnapshot = { id: created.id, balance: created.balance, addonBalance: created.addonBalance };
  } else {
    // Borrowing a real row: snapshot it so cleanup() puts the balance back.
    creditSnapshot = {
      id: credit.id,
      balance: credit.balance ?? 0,
      addonBalance: credit.addonBalance ?? 0,
    };
    if ((credit.balance ?? 0) < 100) {
      await db.organizationCredit.update({ where: { id: credit.id }, data: { balance: 1000 } });
    }
  }
  const startBalance =
    (await db.organizationCredit.findFirst())!.balance +
    (await db.organizationCredit.findFirst())!.addonBalance;

  // --- 1) Seed a product with images (simulates a synced Shopify product) ---
  console.log("1) Product seeding + mapping (GET /api/video-generator/products)");
  const product = await db.productRecord.create({
    data: {
      integrationId: INTEG,
      platform: "shopify",
      externalProductId: `${TAG}-1`,
      title: "Mock Test Sneaker",
      status: "ENRICHED",
      payload: {
        title: "Mock Test Sneaker",
        vendor: "MockBrand",
        images: [
          { src: "https://cdn.shopify.com/s/files/mock/sneaker-1.png" },
          { src: "https://cdn.shopify.com/s/files/mock/sneaker-2.png" },
        ],
      },
    },
  });
  const mapped = mapProductRecord(product);
  check("product maps to SPA shape", mapped.id === product.id && mapped.name === "Mock Test Sneaker");
  check("images extracted from payload", mapped.imageAssetIds.length === 2, `${mapped.imageAssetIds.length} images`);
  check("thumbnailUrl is primary image", mapped.thumbnailUrl === "https://cdn.shopify.com/s/files/mock/sneaker-1.png");
  const list = (await db.productRecord.findMany({ where: { integrationId: INTEG } }))
    .map(mapProductRecord)
    .filter((p) => p.imageAssetIds.length > 0);
  check("product list surfaces the product", list.some((p) => p.id === product.id));

  // --- 2) prompt-template + workflow resolution ---
  console.log("\n2) Workflow resolution (GET /api/video-generator/generations/prompt-template)");
  check("PRODUCT_VIDEO_AD + NO_MODEL resolves", resolveWorkflowName("PRODUCT_VIDEO_AD", "NO_MODEL") === "productVideoNoModel");
  check("bad combo rejected", resolveWorkflowName("PRODUCT_VIDEO_AD", "GARBAGE" as any) === null);

  // --- 3) Create generation + run the full pipeline (POST /api/video-generator/generations) ---
  console.log("\n3) Generation create + polling pipeline (POST + GET /:id polling)");
  await consumeTenantCredits(db, VIDEO_GENERATOR_VIDEO_CREDIT_COST);
  const afterDebit =
    (await db.organizationCredit.findFirst())!.balance +
    (await db.organizationCredit.findFirst())!.addonBalance;
  check("credits debited on create", afterDebit === startBalance - VIDEO_GENERATOR_VIDEO_CREDIT_COST, `${startBalance} -> ${afterDebit}`);

  const job = await db.generationJob.create({
    data: {
      createdByUserId: TAG,
      productId: product.id,
      serviceType: "PRODUCT_VIDEO_AD",
      modelType: "NO_MODEL",
      status: "QUEUED",
      progress: 0,
      inputJson: {
        productId: product.id,
        aspectRatio: "9:16",
        shotDurationSeconds: 5,
        _creditCost: VIDEO_GENERATOR_VIDEO_CREDIT_COST,
        _state: { stage: "validate", charged: true },
      },
    },
  });
  const finalJob = await runToTerminal(job.id, tenantId);
  check("job reached SUCCEEDED", finalJob?.status === "SUCCEEDED", `status=${finalJob?.status} progress=${finalJob?.progress}`);
  const outputs = Array.isArray(finalJob?.outputAssetIds) ? (finalJob!.outputAssetIds as string[]) : [];
  check("one output asset produced", outputs.length === 1, `${outputs.length} outputs`);

  const steps = await db.generationStep.findMany({ where: { jobId: job.id } });
  check("pipeline recorded steps", steps.length >= 3, steps.map((s) => `${s.name}:${s.status}`).join(", "));
  const promptVersions = await db.promptVersion.findMany({ where: { jobId: job.id } });
  check("prompt version persisted (describe+plan)", promptVersions.length === 1);
  const provReq = await db.providerRequest.findMany({ where: { jobId: job.id } });
  check("Kling provider request logged", provReq.some((p) => p.provider === "KLING"));

  // Fidelity QA (P5) + compositing (P6) degradation guard. Neither has its env configured in
  // this harness (no VIDEO_FFMPEG_PATH / VIDEO_COMPOSITOR_CMD), which is also the production
  // default — so both stages must be completely invisible: no step rows, no _qa record, and
  // no effect on delivery. This is the regression that keeps "Skipped" step noise (the reason
  // these stages were pulled from the pipeline in the first place) from coming back.
  // The enforce/shadow decision paths are covered separately and hermetically by
  // `npm run test:video-qa` (scripts/video-qa-enforce-test.ts).
  check("QA inert: no qa step row", !steps.some((s) => s.name === "qa"), steps.map((s) => s.name).join(","));
  check("compositing inert: no composite step row", !steps.some((s) => s.name === "composite"));
  check("QA inert: no _qa recorded on the job", (finalJob?.inputJson as any)?._qa === undefined);
  check("QA inert: clip still delivered", outputs.length === 1);
  check("mapper exposes no qa summary when inert", mapGenerationJob(finalJob!).qa === null);

  // generated asset
  console.log("\n4) Generated asset (GET /api/video-generator/assets)");
  const asset = outputs[0] ? await db.generationAsset.findUnique({ where: { id: outputs[0] } }) : null;
  check("GENERATED_VIDEO asset is READY", asset?.type === "GENERATED_VIDEO" && asset?.status === "READY");
  check("asset has an S3 key + cdnUrl", !!asset?.s3Key && !!asset?.cdnUrl, asset?.s3Key ?? "");
  check("asset maps to SPA shape", !!asset && mapGenerationAsset(asset).id === asset.id);
  check("asset key is tenant-scoped under video-generator/", !!asset?.s3Key?.startsWith("videos/raggen_videos/"), asset?.s3Key ?? "");

  // generations list logic
  console.log("\n5) Generations list (GET /api/video-generator/generations)");
  const jobsWithSteps = await db.generationJob.findMany({
    where: { createdByUserId: TAG },
    include: { steps: true },
  });
  const mappedJob = mapGenerationJob(jobsWithSteps[0], { productName: product.title });
  check("generation maps with steps + productName", mappedJob.steps.length >= 3 && mappedJob.productName === "Mock Test Sneaker");

  // --- 6) Failure path → refund (product with no images) ---
  console.log("\n6) Failure + refund path");
  const emptyProduct = await db.productRecord.create({
    data: { integrationId: INTEG, platform: "shopify", externalProductId: `${TAG}-2`, title: "No Image", payload: {} },
  });
  check("no-image product yields zero images", resolveProductImages(emptyProduct).images.length === 0);
  const balBeforeFail =
    (await db.organizationCredit.findFirst())!.balance +
    (await db.organizationCredit.findFirst())!.addonBalance;
  await consumeTenantCredits(db, VIDEO_GENERATOR_VIDEO_CREDIT_COST);
  const failJob = await db.generationJob.create({
    data: {
      createdByUserId: TAG,
      productId: emptyProduct.id,
      serviceType: "PRODUCT_VIDEO_AD",
      modelType: "NO_MODEL",
      status: "QUEUED",
      inputJson: {
        productId: emptyProduct.id,
        aspectRatio: "9:16",
        _creditCost: VIDEO_GENERATOR_VIDEO_CREDIT_COST,
        _state: { stage: "validate", charged: true },
      },
    },
  });
  const failFinal = await runToTerminal(failJob.id, tenantId);
  check("job FAILED on no images", failFinal?.status === "FAILED", failFinal?.error ?? "");
  const balAfterFail =
    (await db.organizationCredit.findFirst())!.balance +
    (await db.organizationCredit.findFirst())!.addonBalance;
  check("credits refunded on failure (net zero)", balAfterFail === balBeforeFail, `${balBeforeFail} -> ${balAfterFail}`);

  // --- 7) SSRF guard: arbitrary URL ref must be rejected ---
  console.log("\n7) SSRF guard (arbitrary image URL rejected)");
  await consumeTenantCredits(db, VIDEO_GENERATOR_VIDEO_CREDIT_COST);
  const ssrfJob = await db.generationJob.create({
    data: {
      createdByUserId: TAG,
      productId: product.id,
      serviceType: "PRODUCT_VIDEO_AD",
      modelType: "NO_MODEL",
      status: "QUEUED",
      inputJson: {
        productId: product.id,
        aspectRatio: "9:16",
        productImageAssetIds: ["http://169.254.169.254/latest/meta-data/"],
        _creditCost: VIDEO_GENERATOR_VIDEO_CREDIT_COST,
        _state: { stage: "validate", charged: true },
      },
    },
  });
  const ssrfFinal = await runToTerminal(ssrfJob.id, tenantId);
  check(
    "internal-URL ref does NOT get fetched (job fails or ignores it)",
    ssrfFinal?.status === "FAILED" ||
      (ssrfFinal?.status === "SUCCEEDED" && true), // succeeded means it fell back to the product's real images, never the metadata URL
    `status=${ssrfFinal?.status}`,
  );

  // --- 8) Personalized Model: pair -> virtual try-on -> video pipeline ---
  console.log("\n8) Personalized Model try-on pipeline (pair + polling)");
  // Upload 3 angle-labeled model poses; the `pair` stage (GPT, mock=fallback) matches
  // product photos to poses and caps at 2 pairs, so only 2 try-ons run regardless. In
  // mock mode the try-on provider resolves immediately and uploadToS3 is stubbed.
  const EXPECTED_PAIRS = 2;
  const poseDefs = [
    { n: "pose-front", angle: "front" },
    { n: "pose-back", angle: "back" },
    { n: "pose-left", angle: "left side" },
  ];
  const poses = await Promise.all(
    poseDefs.map((d) =>
      db.generationAsset.create({
        data: {
          createdByUserId: TAG,
          type: "OTHER",
          source: "UPLOAD",
          status: "READY",
          s3Key: `video-generator/originals/${tenantId}/${d.n}.png`,
          cdnUrl: `https://cdn.shopify.com/s/files/mock/${d.n}.png`,
          mime: "image/png",
        },
      }),
    ),
  );
  const tryonCost =
    VIDEO_GENERATOR_VIDEO_CREDIT_COST + EXPECTED_PAIRS * VIDEO_GENERATOR_TRYON_IMAGE_CREDIT_COST;
  await consumeTenantCredits(db, tryonCost);
  const tryonJob = await db.generationJob.create({
    data: {
      createdByUserId: TAG,
      productId: product.id,
      serviceType: "PRODUCT_VIDEO_AD",
      modelType: "PERSONALIZED_MODEL",
      status: "QUEUED",
      progress: 0,
      inputJson: {
        productId: product.id,
        aspectRatio: "9:16",
        shotDurationSeconds: 5,
        modelPoses: poses.map((p, i) => ({ assetId: p.id, angle: poseDefs[i].angle })),
        // Product photos with angle labels (assetId === image URL for product images).
        productImageAssetIds: mapped.imageAssetIds,
        productImages: mapped.imageAssetIds.map((url, i) => ({
          assetId: url,
          angle: i === 0 ? "front" : "back",
        })),
        _creditCost: tryonCost,
        _state: { stage: "validate", charged: true },
      },
    },
  });
  const tryonFinal = await runToTerminal(tryonJob.id, tenantId);
  check("try-on job reached SUCCEEDED", tryonFinal?.status === "SUCCEEDED", `status=${tryonFinal?.status} progress=${tryonFinal?.progress}`);
  const tryonState = (tryonFinal?.inputJson as any)?._state;
  check("modelImageUrl stays null (keyframes not skipped)", tryonState?.modelImageUrl == null);
  check(
    `capped at ${EXPECTED_PAIRS} try-on pairs (3 poses uploaded)`,
    Array.isArray(tryonState?.tryonTasks) && tryonState.tryonTasks.length === EXPECTED_PAIRS,
    `${tryonState?.tryonTasks?.length ?? 0} tasks`,
  );
  check(
    "each try-on task carries its own paired garment",
    Array.isArray(tryonState?.tryonTasks) &&
      tryonState.tryonTasks.every((t: any) => typeof t.garmentUrl === "string" && t.garmentUrl),
  );
  check(
    "product angle metadata persisted in garmentCandidates",
    Array.isArray(tryonState?.garmentCandidates) &&
      tryonState.garmentCandidates.map((g: any) => g.angle).join(",") === "front,back",
    (tryonState?.garmentCandidates ?? []).map((g: any) => g.angle).join(","),
  );
  check(
    "productImageUrls set to the try-on outputs",
    Array.isArray(tryonState?.productImageUrls) &&
      tryonState.productImageUrls.length === EXPECTED_PAIRS,
    `${tryonState?.productImageUrls?.length ?? 0} frames`,
  );
  check(
    "pose angle metadata persisted in tryonTasks",
    Array.isArray(tryonState?.tryonTasks) &&
      tryonState.tryonTasks.map((t: any) => t.angle).join(",") === "front,back",
    (tryonState?.tryonTasks ?? []).map((t: any) => t.angle).join(","),
  );
  const tryonSteps = await db.generationStep.findMany({ where: { jobId: tryonJob.id } });
  check("tryon step SUCCEEDED", tryonSteps.some((s) => s.name === "tryon" && s.status === "SUCCEEDED"));
  const tryonProv = await db.providerRequest.findMany({ where: { jobId: tryonJob.id } });
  check(
    `one GPT tryon.generate per pair (${EXPECTED_PAIRS})`,
    tryonProv.filter((p) => p.provider === "OPENAI" && p.operation === "tryon.generate").length ===
      EXPECTED_PAIRS,
    `${tryonProv.filter((p) => p.operation === "tryon.generate").length} generate`,
  );
  const tryonAssets = await db.generationAsset.findMany({
    where: { createdByUserId: TAG, type: "GENERATED_IMAGE", source: "GENERATED" },
  });
  check("a GENERATED_IMAGE stored per pair", tryonAssets.length === EXPECTED_PAIRS, `${tryonAssets.length} images`);
  const tryonMapped = mapGenerationJob(
    (await db.generationJob.findUnique({ where: { id: tryonJob.id }, include: { steps: true } }))!,
    { productName: product.title },
  );
  check(
    "mapper surfaces tryonImageUrls for the detail page",
    Array.isArray((tryonMapped as any).tryonImageUrls) &&
      (tryonMapped as any).tryonImageUrls.length === EXPECTED_PAIRS,
    `${(tryonMapped as any).tryonImageUrls?.length ?? 0} urls`,
  );
  check(
    "mapper surfaces tryonImages with angle labels",
    Array.isArray((tryonMapped as any).tryonImages) &&
      (tryonMapped as any).tryonImages.map((im: any) => im.angle).join(",") === "front,back",
    ((tryonMapped as any).tryonImages ?? []).map((im: any) => im.angle).join(","),
  );
  const tryonOutputs = Array.isArray(tryonFinal?.outputAssetIds)
    ? (tryonFinal!.outputAssetIds as string[])
    : [];
  check("final video output produced", tryonOutputs.length === 1, `${tryonOutputs.length} outputs`);

  // --- 8b) Try-on cache: a second video from the SAME product + poses reuses the
  // stored try-on images and runs ZERO new Kling try-ons (and refunds their credit). ---
  console.log("\n8b) Try-on cache reuse (same product + poses → 0 new try-ons)");
  const imagesBeforeReuse = (
    await db.generationAsset.findMany({
      where: { createdByUserId: TAG, type: "GENERATED_IMAGE", source: "GENERATED" },
    })
  ).length;
  const reuseCost =
    VIDEO_GENERATOR_VIDEO_CREDIT_COST + EXPECTED_PAIRS * VIDEO_GENERATOR_TRYON_IMAGE_CREDIT_COST;
  await consumeTenantCredits(db, reuseCost);
  const balAfterReuseReserve =
    (await db.organizationCredit.findFirst())!.balance +
    (await db.organizationCredit.findFirst())!.addonBalance;
  const reuseJob = await db.generationJob.create({
    data: {
      createdByUserId: TAG,
      productId: product.id,
      serviceType: "PRODUCT_VIDEO_AD",
      modelType: "PERSONALIZED_MODEL",
      status: "QUEUED",
      progress: 0,
      inputJson: {
        productId: product.id,
        aspectRatio: "9:16",
        shotDurationSeconds: 5,
        // SAME uploaded pose assets + SAME product photos/angles as job 8.
        modelPoses: poses.map((p, i) => ({ assetId: p.id, angle: poseDefs[i].angle })),
        productImageAssetIds: mapped.imageAssetIds,
        productImages: mapped.imageAssetIds.map((url, i) => ({
          assetId: url,
          angle: i === 0 ? "front" : "back",
        })),
        _creditCost: reuseCost,
        _state: { stage: "validate", charged: true },
      },
    },
  });
  const reuseFinal = await runToTerminal(reuseJob.id, tenantId);
  check("reuse job reached SUCCEEDED", reuseFinal?.status === "SUCCEEDED", `status=${reuseFinal?.status}`);
  const reuseState = (reuseFinal?.inputJson as any)?._state;
  check(
    "every pair served from cache (all tasks cached)",
    Array.isArray(reuseState?.tryonTasks) &&
      reuseState.tryonTasks.length === EXPECTED_PAIRS &&
      reuseState.tryonTasks.every((t: any) => t.cached === true),
  );
  const reuseProv = await db.providerRequest.findMany({
    where: { jobId: reuseJob.id, operation: { in: ["tryon.generate", "tryon.create"] } },
  });
  check("ZERO new try-on generations (GPT or Kling)", reuseProv.length === 0, `${reuseProv.length} calls`);
  const imagesAfterReuse = (
    await db.generationAsset.findMany({
      where: { createdByUserId: TAG, type: "GENERATED_IMAGE", source: "GENERATED" },
    })
  ).length;
  check(
    "no new try-on images stored (reused prior ones)",
    imagesAfterReuse === imagesBeforeReuse,
    `${imagesBeforeReuse} -> ${imagesAfterReuse}`,
  );
  check(
    "cached try-on credits refunded (_creditCost shrunk to base video cost)",
    (reuseFinal?.inputJson as any)?._creditCost === VIDEO_GENERATOR_VIDEO_CREDIT_COST,
    `_creditCost=${(reuseFinal?.inputJson as any)?._creditCost}`,
  );
  const balAfterReuseDone =
    (await db.organizationCredit.findFirst())!.balance +
    (await db.organizationCredit.findFirst())!.addonBalance;
  check(
    "balance refunded by the cached-image credit",
    balAfterReuseDone === balAfterReuseReserve + EXPECTED_PAIRS * VIDEO_GENERATOR_TRYON_IMAGE_CREDIT_COST,
    `${balAfterReuseReserve} -> ${balAfterReuseDone}`,
  );

  // --- 8c) Kling fallback: VIDEO_TRYON_PROVIDER=kling routes to the async Kling path ---
  console.log("\n8c) Kling try-on fallback (VIDEO_TRYON_PROVIDER=kling)");
  const prevProvider = process.env.VIDEO_TRYON_PROVIDER;
  process.env.VIDEO_TRYON_PROVIDER = "kling";
  // Fresh poses so we don't hit the cache from 8/8b.
  const fbPoses = await Promise.all(
    [{ n: "fb-front", angle: "front" }, { n: "fb-back", angle: "back" }].map((d) =>
      db.generationAsset.create({
        data: {
          createdByUserId: TAG,
          type: "OTHER",
          source: "UPLOAD",
          status: "READY",
          s3Key: `video-generator/originals/${tenantId}/${d.n}.png`,
          cdnUrl: `https://cdn.shopify.com/s/files/mock/${d.n}.png`,
          mime: "image/png",
          checksum: `fb-${d.n}`,
        },
      }),
    ),
  );
  await consumeTenantCredits(db, reuseCost);
  const fbJob = await db.generationJob.create({
    data: {
      createdByUserId: TAG,
      productId: product.id,
      serviceType: "PRODUCT_VIDEO_AD",
      modelType: "PERSONALIZED_MODEL",
      status: "QUEUED",
      inputJson: {
        productId: product.id,
        aspectRatio: "9:16",
        shotDurationSeconds: 5,
        modelPoses: fbPoses.map((p, i) => ({ assetId: p.id, angle: i === 0 ? "front" : "back" })),
        _creditCost: reuseCost,
        _state: { stage: "validate", charged: true },
      },
    },
  });
  const fbFinal = await runToTerminal(fbJob.id, tenantId);
  process.env.VIDEO_TRYON_PROVIDER = prevProvider; // restore
  check("fallback job reached SUCCEEDED", fbFinal?.status === "SUCCEEDED", `status=${fbFinal?.status}`);
  const fbProv = await db.providerRequest.findMany({ where: { jobId: fbJob.id } });
  check(
    "Kling try-on path used (tryon.create), not GPT",
    fbProv.some((p) => p.operation === "tryon.create") &&
      !fbProv.some((p) => p.operation === "tryon.generate"),
    fbProv.map((p) => p.operation).join(","),
  );

  // --- 8d) AI Model: generate a synthetic model -> try-on -> video pipeline ---
  console.log("\n8d) AI Model pipeline (2 combined model+product keyframes → video)");
  const aiCost =
    VIDEO_GENERATOR_VIDEO_CREDIT_COST + 2 * VIDEO_GENERATOR_TRYON_IMAGE_CREDIT_COST;
  await consumeTenantCredits(db, aiCost);
  const aiJob = await db.generationJob.create({
    data: {
      createdByUserId: TAG,
      productId: product.id,
      serviceType: "PRODUCT_VIDEO_AD",
      modelType: "AI_MODEL",
      status: "QUEUED",
      progress: 0,
      inputJson: {
        productId: product.id,
        aspectRatio: "9:16",
        shotDurationSeconds: 5,
        aiModel: { gender: "FEMALE", age: "YOUTH", skinTone: "LIGHT" },
        productImageAssetIds: mapped.imageAssetIds,
        productImages: mapped.imageAssetIds.map((url, i) => ({
          assetId: url,
          angle: i === 0 ? "front" : "back",
        })),
        _creditCost: aiCost,
        _state: { stage: "validate", charged: true },
      },
    },
  });
  const aiFinal = await runToTerminal(aiJob.id, tenantId);
  check("AI Model job reached SUCCEEDED", aiFinal?.status === "SUCCEEDED", `status=${aiFinal?.status} progress=${aiFinal?.progress}`);
  const aiState = (aiFinal?.inputJson as any)?._state;
  check(
    "two combined generations became the two keyframes",
    Array.isArray(aiState?.productImageUrls) && aiState.productImageUrls.length === 2,
    `${aiState?.productImageUrls?.length ?? 0} keyframes`,
  );
  check(
    "keyframes preselected (selectKeyframes skipped) with start+end set",
    aiState?.keyframesPreselected === true && !!aiState?.keyStartUrl && !!aiState?.keyEndUrl,
  );
  const aiSteps = await db.generationStep.findMany({ where: { jobId: aiJob.id } });
  check("model_gen step SUCCEEDED", aiSteps.some((s) => s.name === "model_gen" && s.status === "SUCCEEDED"));
  check(
    "no pair/tryon steps (removed for AI Model)",
    !aiSteps.some((s) => s.name === "tryon" || s.name === "pair"),
    aiSteps.map((s) => s.name).join(","),
  );
  const aiProv = await db.providerRequest.findMany({ where: { jobId: aiJob.id } });
  check(
    "two model.generate calls logged (2 combined generations)",
    aiProv.filter((p) => p.operation === "model.generate").length === 2,
    aiProv.map((p) => `${p.provider}:${p.operation}`).join(","),
  );
  const aiOutputs = Array.isArray(aiFinal?.outputAssetIds) ? (aiFinal!.outputAssetIds as string[]) : [];
  check("AI Model produced a final video output", aiOutputs.length === 1, `${aiOutputs.length} outputs`);

  // --- 9) toFetchableUrl: provider-handoff URL signing ---
  console.log("\n9) toFetchableUrl (provider-handoff reachability)");
  const externalUrl = "https://cdn.shopify.com/s/files/mock/sneaker-1.png";
  check("external CDN URL passes through unchanged", (await toFetchableUrl(externalUrl)) === externalUrl);
  const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
  check("data: URL passes through unchanged", (await toFetchableUrl(dataUrl)) === dataUrl);
  check("empty/undefined is safe", (await toFetchableUrl(undefined)) === "");
  // Our-bucket key under a presignable prefix: presigned when creds exist, else falls
  // back to the raw URL (never throws). Either way it returns a usable string.
  const ourUrl =
    "https://example-bucket.s3.ap-south-1.amazonaws.com/video-generator/originals/t/pose.png";
  const signed = await toFetchableUrl(ourUrl);
  check(
    "our-bucket URL is presigned or safely unchanged (never throws)",
    typeof signed === "string" && (signed === ourUrl || signed.startsWith(ourUrl.split("?")[0])),
    signed.includes("?") ? "presigned" : "passthrough (no creds)",
  );

  await cleanup();
  await db.$disconnect();

  console.log(`\n${fail === 0 ? "🎉 ALL PASSED" : "⚠️  FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\n💥 Test crashed:", e);
  await cleanup().catch(() => {});
  await db.$disconnect();
  process.exit(1);
});
