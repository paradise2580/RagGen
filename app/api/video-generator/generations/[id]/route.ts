// GET    /api/video-generator/generations/:id — job status (drives the poll loop)
// DELETE /api/video-generator/generations/:id — hard-delete job (+ cascade steps)

import { NextResponse, type NextRequest } from "next/server";
import { gateVideoGenerator, jsonError } from "@/lib/video-generator/context";
import { mapGenerationJob } from "@/lib/video-generator/mappers";
import { advanceJob } from "@/lib/video-generator/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

async function load(db: any, id: string) {
  const job = await db.generationJob.findUnique({ where: { id }, include: { steps: true } });
  if (!job) return null;
  const product = job.productId
    ? await db.productRecord.findUnique({ where: { id: job.productId }, select: { title: true } })
    : null;
  return { job, productName: product?.title ?? null };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await gateVideoGenerator(req);
  if (!gate.ok) return gate.response;
  const { db, tenantId } = gate.ctx;

  const loaded = await load(db, params.id);
  if (!loaded) return jsonError("Generation not found", 404);

  // Client polling drives the state machine, but a single pipeline transition can take
  // MINUTES (AI-model generation runs two OpenAI image generations). We must NOT block
  // the status response on it — otherwise this GET hangs and the detail page is stuck on
  // loading skeletons the whole time. So kick the next transition off in the BACKGROUND
  // and return the CURRENT state immediately; the next poll (2s) reflects the progress.
  // advanceJob()'s lock prevents overlapping polls from double-running the same job, and
  // the lock lease + /generations/jobs tick keep it advancing regardless.
  const { job } = loaded;
  const due = !job.nextPollAt || new Date(job.nextPollAt).getTime() <= Date.now();
  if (["QUEUED", "RUNNING"].includes(job.status) && due) {
    void advanceJob(db, job.id, { tenantId }).catch((e) =>
      console.warn("[video-generator] advance on poll failed:", e),
    );
  }

  return NextResponse.json(
    mapGenerationJob(loaded.job, { productName: loaded.productName }),
    { headers: noStore },
  );
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await gateVideoGenerator(req);
  if (!gate.ok) return gate.response;
  const { db } = gate.ctx;

  const job = await db.generationJob.findUnique({ where: { id: params.id } });
  if (!job) return jsonError("Generation not found", 404);

  // A generation can only be deleted once it is no longer in progress. Deleting a live
  // job would forfeit reserved credits and race the running pipeline tick.
  if (["QUEUED", "RUNNING"].includes(job.status)) {
    return jsonError("Cannot delete a generation while it is still in progress.", 409);
  }

  await db.generationJob.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
