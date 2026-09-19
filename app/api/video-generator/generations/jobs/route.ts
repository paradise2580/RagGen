// POST|GET /api/video-generator/generations/jobs — pipeline tick.
//
// Advances every live, due job for the tenant by one step. Client polling of
// GET /generations/:id already drives individual jobs; this endpoint lets an
// external scheduler (or a manual ping) drive the whole tenant's queue, so progress
// does not depend on a browser being open. Idempotent and lock-guarded.

import { NextResponse, type NextRequest } from "next/server";
import { gateVideoGenerator } from "@/lib/video-generator/context";
import { advanceJob } from "@/lib/video-generator/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

const MAX_PER_TICK = 25;

async function tick(req: NextRequest) {
  const gate = await gateVideoGenerator(req);
  if (!gate.ok) return gate.response;
  const { db, tenantId } = gate.ctx;

  const now = new Date();
  const due = await db.generationJob.findMany({
    where: {
      status: { in: ["QUEUED", "RUNNING"] },
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }],
    },
    orderBy: { updatedAt: "asc" },
    take: MAX_PER_TICK,
    select: { id: true },
  });

  let advanced = 0;
  for (const j of due) {
    try {
      await advanceJob(db, j.id, { tenantId });
      advanced += 1;
    } catch (e) {
      console.warn("[video-generator] tick advance failed:", j.id, e);
    }
  }
  return NextResponse.json({ ok: true, scanned: due.length, advanced }, { headers: noStore });
}

export const GET = tick;
export const POST = tick;
