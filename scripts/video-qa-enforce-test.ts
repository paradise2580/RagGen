process.env.AWS_BUCKET_NAME ||= "example-bucket"; // Synthetic bucket; tests stub storage.
/* eslint-disable no-console */
// scripts/video-qa-enforce-test.ts
//
// Verification harness for the QA (P5) + compositing (P6) pipeline stages.
//
//   npm run test:video-qa
//
// This is the P3 pre-flip check: it proves the enforce-mode decisions (stricter re-roll,
// flag-and-refund, the D2 severity gate) and the P6 own-tick handoff behave correctly BEFORE
// anyone points them at real traffic — and it proves the inert/shadow paths change nothing.
//
// Deliberately hermetic: an in-memory fake of the tenant Prisma client, a stubbed S3 client,
// `mock.local` asset URLs (short-circuited by downloadResult), and PROVIDER_MODE=mock. So,
// unlike scripts/video-generator-mock-test.ts, it needs **no database, no network, no
// provider keys, and no ffmpeg** — and it never spends a credit or a render.
//
// Scores are forced through the double-guarded seam in qa.ts (`PROVIDER_MODE=mock` +
// `VIDEO_QA_MOCK_MIN_SCORE`), so no vision call happens.
//
// Do NOT load dotenv here — the whole point is a controlled environment.

process.env.PROVIDER_MODE = "mock";

import { s3Client } from "@/lib/s3-client";
// Stub S3 before anything imports the uploader.
(s3Client as any).send = async () => ({ $metadata: { httpStatusCode: 200 } });

import { advanceJob } from "@/lib/video-generator/pipeline";
import { compositingEnabled } from "@/lib/video-generator/compositing";

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

const QA_ENV = [
  "VIDEO_QA_MODE",
  "VIDEO_QA_ENABLED",
  "VIDEO_QA_THRESHOLD",
  "VIDEO_QA_MAX_RETRIES",
  "VIDEO_QA_REFUND_BELOW",
  "VIDEO_QA_MOCK_MIN_SCORE",
  "VIDEO_FFMPEG_PATH",
  "VIDEO_COMPOSITE_LOGO",
  "VIDEO_COMPOSITOR_CMD",
] as const;

function setEnv(vars: Record<string, string>) {
  QA_ENV.forEach((k) => delete process.env[k]);
  Object.assign(process.env, vars);
}

/** Minimal in-memory stand-in for the tenant Prisma client — only what these stages touch. */
function makeDb(state: Record<string, any>, creditCost = 10) {
  const job: any = {
    id: "job1",
    status: "RUNNING",
    progress: 85,
    attempts: 0,
    maxAttempts: 90,
    externalTaskId: "task-1",
    lockedAt: null,
    nextPollAt: null,
    createdByUserId: "u1",
    productId: "p1",
    serviceType: "PRODUCT_VIDEO_AD",
    modelType: "NO_MODEL",
    inputJson: { _creditCost: creditCost, shotDurationSeconds: 5, _state: state },
  };
  const steps: any[] = [];
  let credited = 0;
  const db: any = {
    generationJob: {
      findUnique: async () => ({ ...job, inputJson: { ...job.inputJson } }),
      update: async ({ data }: any) => {
        Object.assign(job, data);
        return job;
      },
      updateMany: async () => ({ count: 1 }),
    },
    generationStep: {
      findFirst: async ({ where }: any) => steps.find((s) => s.name === where.name) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `s${steps.length}`, ...data };
        steps.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = steps.find((s) => s.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    promptVersion: { findFirst: async () => null, update: async () => ({}) },
    generationAsset: { create: async () => ({ id: "asset1" }) },
    organizationCredit: {
      findFirst: async () => ({ id: "c1" }),
      update: async ({ data }: any) => {
        credited += data.balance.increment;
        return {};
      },
    },
    providerRequest: { create: async () => ({}) },
  };
  return {
    db,
    job,
    steps,
    stepNames: () => steps.map((s) => s.name).join(",") || "(none)",
    step: (name: string) => steps.find((s) => s.name === name),
    refunded: () => credited,
    state: () => job.inputJson._state,
    qa: () => job.inputJson._qa,
  };
}

const BASE_STATE = {
  stage: "qa",
  videoUrl: "https://mock.local/clip.mp4",
  startFrameUrl: "https://mock.local/frame.png",
  sourceFrameUrl: "https://mock.local/frame.png",
  brandText: "ASICS",
  charged: true,
  seed: 5,
};

const ENFORCE = { VIDEO_QA_MODE: "enforce", VIDEO_QA_THRESHOLD: "4", VIDEO_QA_MAX_RETRIES: "1", VIDEO_QA_REFUND_BELOW: "3" };

async function qaSuite() {
  console.log("\n=== QA (P5) decision paths ===");

  console.log("\n[1] below threshold with a retry left → stricter re-roll");
  setEnv({ ...ENFORCE, VIDEO_QA_MOCK_MIN_SCORE: "2" });
  let h = makeDb({ ...BASE_STATE, qaAttempts: 0 });
  await advanceJob(h.db, "job1", { tenantId: "t1" });
  check("re-queued at render", h.state().stage === "render", `stage=${h.state().stage}`);
  check("qaAttempts incremented", h.state().qaAttempts === 1);
  check("cfgScale raised 0.8 → 0.9", h.state().cfgOverride === 0.9, `cfgOverride=${h.state().cfgOverride}`);
  check("seed changed for a different roll", h.state().seed !== 5, `seed=${h.state().seed}`);
  check("externalTaskId cleared (mints a new task next tick)", h.job.externalTaskId === null);
  check("stale clip URL dropped", h.state().videoUrl === undefined);
  check("NOT refunded on a retry", h.refunded() === 0);
  check("job still running", h.job.status === "RUNNING");
  check("verdict recorded in _qa history", (h.qa()?.history ?? []).length === 1);

  console.log("\n[2] retries exhausted + severe score → flag, refund, still deliver");
  setEnv({ ...ENFORCE, VIDEO_QA_MOCK_MIN_SCORE: "2" });
  h = makeDb({ ...BASE_STATE, qaAttempts: 1 });
  await advanceJob(h.db, "job1", { tenantId: "t1" });
  check("delivered anyway", h.job.status === "SUCCEEDED");
  check("refunded exactly the reserved cost", h.refunded() === 10, `credited=${h.refunded()}`);
  check("refund latched (no double refund)", h.state().refunded === true);
  check("flagged on the job", h.qa()?.flagged === true);
  check("qa step explains why", /flagged: minScore 2 < 4/.test(h.step("qa")?.error ?? ""));

  console.log("\n[3] retries exhausted + usable score → flag, NO refund (decision D2)");
  setEnv({ ...ENFORCE, VIDEO_QA_MOCK_MIN_SCORE: "3" });
  h = makeDb({ ...BASE_STATE, qaAttempts: 1 });
  await advanceJob(h.db, "job1", { tenantId: "t1" });
  check("delivered", h.job.status === "SUCCEEDED");
  check("NOT refunded — 3/5 is usable, not free", h.refunded() === 0);
  check("still flagged for internal visibility", h.qa()?.flagged === true);

  console.log("\n[3b] VIDEO_QA_REFUND_BELOW=threshold restores always-refund");
  setEnv({ ...ENFORCE, VIDEO_QA_REFUND_BELOW: "4", VIDEO_QA_MOCK_MIN_SCORE: "3" });
  h = makeDb({ ...BASE_STATE, qaAttempts: 1 });
  await advanceJob(h.db, "job1", { tenantId: "t1" });
  check("refunded when the knob is widened", h.refunded() === 10, `credited=${h.refunded()}`);

  console.log("\n[4] passing score → straight through");
  setEnv({ ...ENFORCE, VIDEO_QA_MOCK_MIN_SCORE: "5" });
  h = makeDb({ ...BASE_STATE, qaAttempts: 0 });
  await advanceJob(h.db, "job1", { tenantId: "t1" });
  check("succeeded", h.job.status === "SUCCEEDED");
  check("no re-roll", h.state().qaAttempts === 0);
  check("not refunded", h.refunded() === 0);
  check("qa step SUCCEEDED", h.step("qa")?.status === "SUCCEEDED");

  console.log("\n[5] SHADOW mode with a failing score → must change nothing");
  setEnv({ VIDEO_QA_MODE: "shadow", VIDEO_QA_THRESHOLD: "4", VIDEO_QA_MOCK_MIN_SCORE: "1" });
  h = makeDb({ ...BASE_STATE, qaAttempts: 0 });
  await advanceJob(h.db, "job1", { tenantId: "t1" });
  check("delivered unchanged", h.job.status === "SUCCEEDED");
  check("no re-roll", h.state().qaAttempts === 0);
  check("no refund", h.refunded() === 0);
  check("NO qa step row (shadow is invisible)", !h.step("qa"), `steps=${h.stepNames()}`);
  check("verdict still recorded for the report", h.qa()?.latest?.minScore === 1);
  check("tagged mode=shadow", h.qa()?.latest?.mode === "shadow");

  console.log("\n[6] QA inert (no ffmpeg, no seam) → production behaviour today");
  setEnv({});
  h = makeDb({ ...BASE_STATE, qaAttempts: 0 });
  await advanceJob(h.db, "job1", { tenantId: "t1" });
  check("delivered", h.job.status === "SUCCEEDED");
  check("no qa step row", !h.step("qa"));
  check("no composite step row", !h.step("composite"));
  check("no _qa written at all", h.qa() === undefined);

  console.log("\n[7] broken ffmpeg path → degrades to unavailable, still delivers");
  setEnv({ ...ENFORCE, VIDEO_FFMPEG_PATH: "/nonexistent/ffmpeg" });
  h = makeDb({ ...BASE_STATE, qaAttempts: 0 });
  await advanceJob(h.db, "job1", { tenantId: "t1" });
  check("delivered", h.job.status === "SUCCEEDED");
  check("qa step SKIPPED with a reason", h.step("qa")?.status === "SKIPPED", `reason=${h.step("qa")?.error}`);
  check("no re-roll on an unavailable verdict", h.state().qaAttempts === 0);
  check("no refund", h.refunded() === 0);
}

async function compositeSuite() {
  console.log("\n=== Compositing (P6) own-tick handoff ===");
  const CONFIGURED = {
    VIDEO_COMPOSITE_LOGO: "1",
    VIDEO_FFMPEG_PATH: "/nonexistent/ffmpeg",
    VIDEO_COMPOSITOR_CMD: "/nonexistent/compositor",
  };
  // No OPENAI_API_KEY in this hermetic env, so detectLogoRegion declines — which is exactly
  // the pass-through path we need to prove never costs a user their video.
  delete process.env.OPENAI_API_KEY;

  console.log("\n[8] needs all three env vars to activate");
  setEnv({ VIDEO_COMPOSITE_LOGO: "1" });
  check("flag alone → off", compositingEnabled() === false);
  setEnv({ VIDEO_COMPOSITE_LOGO: "1", VIDEO_COMPOSITOR_CMD: "/x" });
  check("flag + cmd without ffmpeg → off", compositingEnabled() === false);
  setEnv(CONFIGURED);
  check("all three → on", compositingEnabled() === true);

  console.log("\n[9] tick A: qa hands off to composite WITHOUT storing");
  const h = makeDb({ ...BASE_STATE, stage: "qa" });
  await advanceJob(h.db, "job1", { tenantId: "t1" });
  check("stage advanced to composite", h.state().stage === "composite", `stage=${h.state().stage}`);
  check("job not finished yet (own tick, not inline)", h.job.status === "RUNNING");
  check("nextPollAt set so a later tick picks it up", !!h.job.nextPollAt);
  check("nothing stored yet", !h.step("store"));
  check("lock released between ticks", h.job.lockedAt === null);

  console.log("\n[10] tick B: compositor declines → ships the ORIGINAL clip");
  await advanceJob(h.db, "job1", { tenantId: "t1" });
  check("composite step SKIPPED with a reason", h.step("composite")?.status === "SKIPPED", `reason=${h.step("composite")?.error}`);
  check("job delivered (a bad compositor never costs a video)", h.job.status === "SUCCEEDED");
  check("composited latch set", h.state().composited === true);
  check("stored the original clip URL", h.state().videoUrl === "https://mock.local/clip.mp4");

  console.log("\n[11] a reclaimed lock must not re-composite");
  const h2 = makeDb({ ...BASE_STATE, stage: "composite", composited: true });
  await advanceJob(h2.db, "job1", { tenantId: "t1" });
  check("no composite step on re-entry", !h2.step("composite"), `steps=${h2.stepNames()}`);
  check("still delivered", h2.job.status === "SUCCEEDED");

  console.log("\n[12] compositing not configured → qa stores in ONE tick");
  setEnv({});
  const h3 = makeDb({ ...BASE_STATE, stage: "qa" });
  await advanceJob(h3.db, "job1", { tenantId: "t1" });
  check("delivered in one tick", h3.job.status === "SUCCEEDED");
  check("no composite step row", !h3.step("composite"));
}

async function main() {
  console.log("🎬 Video Generator QA + compositing harness (no DB, no network, no spend)");
  await qaSuite();
  await compositeSuite();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
