/* eslint-disable no-console */
// scripts/video-qa-report.ts
//
// P2 (QA rollout) — turn the shadow-mode verdicts accumulated on GenerationJob.inputJson._qa
// into the numbers needed to answer three questions before enforcement is switched on:
//
//   1. What does this rubric actually score real clips at? (per-dimension distribution)
//   2. Which threshold would re-roll a sane fraction of jobs? (trip rate + projected spend)
//   3. Which dimension is the usual culprit — logo, or something compositing can't fix?
//      (this answers decision D3: whether the OpenCV compositor is worth building at all)
//
// STRICTLY READ-ONLY: opens the tenant DB, reads job rows, writes nothing.
//
// Run:
//   TENANT_DB_URL='postgresql://…' [SINCE=2026-07-01] [MODE=shadow|enforce|all] \
//     npx tsx -r tsconfig-paths/register -r dotenv/config scripts/video-qa-report.ts
//   (or: npm run qa:report:video)
//
// Run it per tenant DB and add the results up; there is no cross-tenant view by design.

import { PrismaClient } from "@/prisma/generated/tenant";

const DIMENSIONS = ["logo", "text", "color", "pattern", "proportions", "overall"] as const;
type Dimension = (typeof DIMENSIONS)[number];

interface Entry {
  jobId: string;
  flow: string;
  attempt: number;
  mode: string;
  available: boolean;
  reason?: string;
  minScore?: number;
  scores?: Record<Dimension, number> & { notes?: string };
  at?: string;
}

function bar(n: number, max: number, width = 28): string {
  if (max <= 0) return "";
  return "█".repeat(Math.max(n > 0 ? 1 : 0, Math.round((n / max) * width)));
}

async function main() {
  const tenantDbUrl = process.env.TENANT_DB_URL;
  if (!tenantDbUrl) throw new Error("Set TENANT_DB_URL (the tenant's own Postgres URL, from master Tenant.dbUrl)");
  const since = process.env.SINCE ? new Date(process.env.SINCE) : null;
  const modeFilter = process.env.MODE || "all";

  const db = new PrismaClient({ datasourceUrl: tenantDbUrl });
  try {
    const jobs = await db.generationJob.findMany({
      where: since ? { createdAt: { gte: since } } : undefined,
      orderBy: { createdAt: "desc" },
    });

    // Flatten every QA pass ever recorded. One job can hold several (retries).
    const entries: Entry[] = [];
    let jobsWithQa = 0;
    for (const job of jobs) {
      const qa: any = (job.inputJson as any)?._qa;
      if (!qa) continue;
      jobsWithQa++;
      const history: any[] = Array.isArray(qa.history) ? qa.history : qa.latest ? [qa.latest] : [];
      for (const h of history) {
        if (modeFilter !== "all" && (h.mode ?? "shadow") !== modeFilter) continue;
        entries.push({
          jobId: job.id,
          flow: `${job.serviceType}/${job.modelType}`,
          attempt: h.attempt ?? 0,
          mode: h.mode ?? "shadow",
          available: !!h.available,
          reason: h.reason,
          minScore: h.minScore,
          scores: h.scores,
          at: h.at,
        });
      }
    }

    console.log("=== Video QA report ===");
    console.log(`  jobs examined      : ${jobs.length}${since ? ` (since ${since.toISOString().slice(0, 10)})` : ""}`);
    console.log(`  jobs with QA data  : ${jobsWithQa}`);
    console.log(`  QA passes recorded : ${entries.length}${modeFilter !== "all" ? ` (mode=${modeFilter})` : ""}`);

    if (!entries.length) {
      console.log(
        "\n  No QA verdicts recorded yet. Either shadow mode hasn't run (is VIDEO_FFMPEG_PATH set\n" +
          "  on the server?) or no jobs have completed since it was enabled. Check the server log for\n" +
          "  '[video-generator] qa inert' — that means the sampler isn't configured.",
      );
      return;
    }

    const unavailable = entries.filter((e) => !e.available);
    const scored = entries.filter((e) => e.available && e.scores);
    if (unavailable.length) {
      console.log(`\n  ⚠️  ${unavailable.length} pass(es) produced NO score:`);
      const byReason = new Map<string, number>();
      unavailable.forEach((e) => byReason.set(e.reason ?? "unknown", (byReason.get(e.reason ?? "unknown") ?? 0) + 1));
      Array.from(byReason.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([r, n]) => console.log(`      ${String(n).padStart(4)} × ${r}`));
      console.log("      (a high rate here means QA is not actually gating anything — fix before enforcing)");
    }
    if (!scored.length) {
      console.log("\n  Nothing scored — see the reasons above.");
      return;
    }

    // --- 1. distribution per dimension ---
    console.log(`\n--- Score distribution (${scored.length} scored passes) ---`);
    const maxCount = Math.max(
      ...DIMENSIONS.flatMap((d) => [1, 2, 3, 4, 5].map((v) => scored.filter((e) => Math.round(e.scores![d]) === v).length)),
    );
    for (const d of DIMENSIONS) {
      const mean = scored.reduce((a, e) => a + e.scores![d], 0) / scored.length;
      console.log(`  ${d} (mean ${mean.toFixed(2)})`);
      for (const v of [1, 2, 3, 4, 5]) {
        const n = scored.filter((e) => Math.round(e.scores![d]) === v).length;
        console.log(`    ${v}: ${String(n).padStart(4)} ${bar(n, maxCount)}`);
      }
    }

    // --- 2. threshold trip rates ---
    console.log("\n--- Threshold simulation (gate is on the LOWEST dimension) ---");
    console.log("  threshold  would-fail   share   note");
    for (const t of [2, 3, 4, 5]) {
      const n = scored.filter((e) => (e.minScore ?? 0) < t).length;
      const pct = (n / scored.length) * 100;
      const note =
        pct === 0 ? "gates nothing" : pct > 60 ? "re-rolls most jobs — provider spend explodes" : pct > 30 ? "aggressive" : "plausible";
      console.log(
        `  ${String(t).padStart(9)}  ${String(n).padStart(10)}  ${pct.toFixed(1).padStart(5)}%   ${note}`,
      );
    }
    console.log(
      "\n  Each would-fail becomes up to VIDEO_QA_MAX_RETRIES extra PAID renders. Multiply by your\n" +
        "  per-render provider cost to price the gate before enabling it.",
    );

    // --- 3. which dimension is the culprit ---
    console.log("\n--- Weakest dimension per pass (answers: is logo drift really the problem?) ---");
    const culprit = new Map<string, number>();
    for (const e of scored) {
      const gateDims = DIMENSIONS.filter((d) => d !== "overall");
      const worst = Math.min(...gateDims.map((d) => e.scores![d]));
      gateDims.filter((d) => e.scores![d] === worst).forEach((d) => culprit.set(d, (culprit.get(d) ?? 0) + 1));
    }
    const culpritMax = Math.max(...Array.from(culprit.values()));
    Array.from(culprit.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([d, n]) => console.log(`  ${d.padEnd(12)} ${String(n).padStart(4)} ${bar(n, culpritMax)}`));
    const logoShare = ((culprit.get("logo") ?? 0) / scored.length) * 100;
    console.log(
      `\n  logo is the weakest dimension in ${logoShare.toFixed(0)}% of passes. Decision D3: the OpenCV\n` +
        "  compositor (P4/P5) only fixes logos — if this share is low, that build is the wrong investment.",
    );

    // --- per-flow breakdown: some flows may be systematically worse ---
    console.log("\n--- By flow ---");
    const flows = Array.from(new Set(scored.map((e) => e.flow)));
    for (const f of flows) {
      const rows = scored.filter((e) => e.flow === f);
      const mean = rows.reduce((a, e) => a + (e.minScore ?? 0), 0) / rows.length;
      console.log(`  ${f.padEnd(38)} n=${String(rows.length).padStart(4)}  mean minScore ${mean.toFixed(2)}`);
    }

    // --- retries actually recorded (only meaningful once enforce is on) ---
    const retried = Array.from(new Set(entries.filter((e) => e.attempt > 0).map((e) => e.jobId)));
    if (retried.length) {
      console.log(`\n--- Retries (enforce mode) ---\n  ${retried.length} job(s) re-rolled at least once.`);
      for (const jobId of retried) {
        const passes = entries
          .filter((e) => e.jobId === jobId)
          .sort((a, b) => a.attempt - b.attempt)
          .map((e) => `a${e.attempt}:${e.minScore ?? "?"}`)
          .join(" → ");
        console.log(`    ${jobId}  ${passes}`);
      }
      console.log("    (if minScore doesn't climb across attempts, the stricter re-roll isn't working — lower MAX_RETRIES)");
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
