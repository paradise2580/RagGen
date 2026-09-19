// scripts/tick-jobs.ts
//
// Drives the generation pipeline from OUTSIDE the browser. The studio advances a job every
// time the SPA polls GET /generations/:id, so a job only moves while someone has the page
// open. This ticks the whole queue instead — run it from cron (or leave it looping) so jobs
// finish unattended.
//
//   npx tsx -r dotenv/config scripts/tick-jobs.ts            # one tick
//   npx tsx -r dotenv/config scripts/tick-jobs.ts --watch    # every TICK_INTERVAL_MS
//
// It calls the app's own /api/video-generator/generations/jobs endpoint, so the request
// takes the same lock-guarded, idempotent path the UI does (no double-running).

const BASE = process.env.VIDEO_GENERATOR_BASE_URL || "http://localhost:3100";
const TOKEN = process.env.VIDEO_GENERATOR_API_TOKEN || "";
const INTERVAL = Number(process.env.TICK_INTERVAL_MS ?? 10_000);

async function tick(): Promise<void> {
  const res = await fetch(`${BASE}/api/video-generator/generations/jobs`, {
    method: "POST",
    headers: TOKEN ? { "x-api-token": TOKEN } : {},
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`[tick] ${res.status} ${body}`);
    return;
  }
  console.log(`[tick] ${body}`);
}

async function main() {
  if (!process.argv.includes("--watch")) {
    await tick();
    return;
  }
  console.log(`[tick] watching ${BASE} every ${INTERVAL}ms (ctrl-c to stop)`);
  for (;;) {
    await tick().catch((e) => console.error("[tick] failed:", e));
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
