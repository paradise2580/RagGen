import { usageScope } from "../lib/video-generator/rag/usage";
/* eslint-disable no-console */
// scripts/video-qa-probe.ts
//
// P0 (QA re-activation) — prove the fidelity QA path works END TO END on real, already
// generated clips BEFORE wiring anything into a user-facing outcome. Run this first; if it
// can't produce scores here, shadow mode in the pipeline will only ever record
// "unavailable".
//
// It picks recent SUCCEEDED video generations out of a tenant DB, resolves each one's stored
// clip + its ground-truth source frame, and calls the REAL runFidelityQa() — the same
// function the pipeline calls. Then it prints the rubric per clip plus a summary, which is
// the first look anyone has ever had at this rubric's score distribution.
//
// READ-ONLY with respect to job rows: it never updates a GenerationJob. It DOES write the
// sampled frames to S3 (that's what sampleVideoFrames does), so expect a few small JPEGs
// per clip.
//
// Requirements (all must be true or it tells you which is missing):
//   - VIDEO_FFMPEG_PATH  → a real ffmpeg binary (frame sampling)
//   - OPENAI_API_KEY     → the vision scorer
//   - AWS creds          → uploading the sampled frames
//
// Run:
//   TENANT_DB_URL='postgresql://…' [LIMIT=5] [TENANT_ID='…'] [JOB_IDS='id1,id2'] \
//     npx tsx -r tsconfig-paths/register -r dotenv/config scripts/video-qa-probe.ts
//   (or: npm run qa:probe:video)

import { PrismaClient } from "@/prisma/generated/tenant";
import { toFetchableUrl } from "@/lib/video-generator/storage";
import { qaEnabled, qaThreshold, runFidelityQa, type FidelityScores } from "@/lib/video-generator/qa";

const DIMENSIONS = ["logo", "text", "color", "pattern", "proportions", "overall"] as const;

function preflight(): string[] {
  const missing: string[] = [];
  if (!process.env.VIDEO_FFMPEG_PATH) missing.push("VIDEO_FFMPEG_PATH (no ffmpeg → no frames → no scores)");
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY (no vision scorer)");
  if (!process.env.AWS_ACCESS_KEY_ID) missing.push("AWS_ACCESS_KEY_ID (sampled frames are uploaded to S3)");
  return missing;
}

async function main() {
  const tenantDbUrl = process.env.TENANT_DB_URL || process.env.TENANT_DATABASE_URL;
  if (!tenantDbUrl) throw new Error("Set TENANT_DB_URL (the tenant's own Postgres URL, from master Tenant.dbUrl)");
  const limit = Number(process.env.LIMIT) || 5;
  const jobIds = (process.env.JOB_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

  const missing = preflight();
  console.log("=== QA probe preflight ===");
  console.log(`  ffmpeg          : ${process.env.VIDEO_FFMPEG_PATH || "(unset)"}`);
  console.log(`  qaEnabled()     : ${qaEnabled()}`);
  console.log(`  qaThreshold()   : ${qaThreshold()} (gate is on the LOWEST dimension)`);
  if (missing.length) {
    console.log("\n  ⛔ Cannot score — missing:");
    missing.forEach((m) => console.log(`     - ${m}`));
    console.log("\n  Provision these first (P0 of docs/qa-composite-implementation-plan.md).");
    process.exitCode = 1;
    return;
  }

  const db = new PrismaClient({ datasourceUrl: tenantDbUrl });
  try {
    const jobs = await db.generationJob.findMany({
      where: jobIds.length ? { id: { in: jobIds } } : { status: "SUCCEEDED" },
      orderBy: { createdAt: "desc" },
      take: jobIds.length ? jobIds.length : limit * 3, // over-fetch; some won't have a usable clip
    });

    const scored: { jobId: string; flow: string; scores: FidelityScores; minScore: number }[] = [];
    const skipped: { jobId: string; reason: string }[] = [];

    for (const job of jobs) {
      if (scored.length >= limit && !jobIds.length) break;
      const input: any = job.inputJson ?? {};
      const state: any = input._state ?? {};
      const flow = `${job.serviceType}/${job.modelType}`;

      // Prefer the STORED asset (permanent) over the provider URL on _state (expires).
      let clipUrl: string | undefined;
      const assetIds: string[] = Array.isArray(job.outputAssetIds) ? (job.outputAssetIds as string[]) : [];
      if (assetIds.length) {
        const asset = await db.generationAsset.findFirst({
          where: { id: { in: assetIds }, type: "GENERATED_VIDEO" },
        });
        clipUrl = asset?.cdnUrl ?? undefined;
      }
      clipUrl = clipUrl || state.videoUrl;
      const sourceUrl = state.sourceFrameUrl || state.startFrameUrl;

      if (!clipUrl || !sourceUrl) {
        skipped.push({ jobId: job.id, reason: !clipUrl ? "no stored clip" : "no source frame on _state" });
        continue;
      }

      console.log(`\n--- ${job.id}  [${flow}]`);
      const verdict = await usageScope.run({db,tenantId:process.env.VIDEO_GENERATOR_TENANT_ID || "raggen",jobId:job.id},async()=>runFidelityQa({
        // Same presigning the pipeline does: OpenAI has to be able to FETCH the source frame.
        sourceFrameUrl: await toFetchableUrl(sourceUrl),
        videoUrl: await toFetchableUrl(clipUrl),
        durationSeconds: input.shotDurationSeconds ?? 5,
        brandText: state.brandText,
        tenantId: process.env.TENANT_ID,
      }));

      if (!verdict.available || !verdict.scores) {
        console.log(`  ⚠️  unavailable — ${verdict.reason ?? "unknown"}`);
        skipped.push({ jobId: job.id, reason: verdict.reason ?? "unavailable" });
        continue;
      }
      const s = verdict.scores;
      const min = verdict.minScore ?? 0;
      console.log(
        `  ${DIMENSIONS.map((d) => `${d}=${s[d]}`).join("  ")}   min=${min} ` +
          `${min >= qaThreshold() ? "PASS" : "FAIL"} @${qaThreshold()}`,
      );
      if (state.brandText) console.log(`  brandText: "${state.brandText}"`);
      if (s.notes) console.log(`  notes: ${s.notes}`);
      scored.push({ jobId: job.id, flow, scores: s, minScore: min });
    }

    // --- summary: the whole point of the probe ---
    console.log(`\n=== Summary: ${scored.length} scored, ${skipped.length} skipped ===`);
    if (skipped.length) {
      const byReason = new Map<string, number>();
      skipped.forEach((s) => byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1));
      Array.from(byReason.entries()).forEach(([r, n]) => console.log(`  skipped: ${n} × ${r}`));
    }
    if (!scored.length) {
      console.log("\n  No clips scored. If every skip says 'unavailable', ffmpeg or the scorer is the problem —");
      console.log("  fix that before proceeding to P1.");
      return;
    }

    const avg = (f: (x: (typeof scored)[number]) => number) =>
      (scored.reduce((a, x) => a + f(x), 0) / scored.length).toFixed(2);
    console.log("\n  mean scores:");
    DIMENSIONS.forEach((d) => console.log(`    ${d.padEnd(12)} ${avg((x) => x.scores[d])}`));
    console.log(`    ${"minScore".padEnd(12)} ${avg((x) => x.minScore)}`);

    console.log("\n  would-fail rate by candidate threshold (this is what tunes VIDEO_QA_THRESHOLD):");
    for (const t of [2, 3, 4, 5]) {
      const n = scored.filter((x) => x.minScore < t).length;
      console.log(
        `    threshold ${t}: ${n}/${scored.length} (${Math.round((n / scored.length) * 100)}%) would re-roll` +
          `  → up to ${n} extra PAID renders`,
      );
    }
    console.log(
      "\n  A sample this small only sanity-checks the plumbing. Do NOT pick a threshold from it —\n" +
        "  that's what P1 shadow mode + scripts/video-qa-report.ts are for.",
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
