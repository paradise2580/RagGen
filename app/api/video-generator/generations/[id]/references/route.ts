import { NextResponse, type NextRequest } from "next/server";
import { gateVideoGenerator } from "@/lib/video-generator/context";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await gateVideoGenerator(req); if (!gate.ok) return gate.response;
  const job = await gate.ctx.db.generationJob.findUnique({ where: { id: params.id }, select: { inputJson: true, promptVersions: { orderBy: { createdAt: "desc" }, take: 1, select: { outputJson: true } } } });
  if (!job) return NextResponse.json({ message: "Generation not found" }, { status: 404 });
  const audit = (job.promptVersions[0]?.outputJson as any)?.rag;
  return NextResponse.json({ context: (job.inputJson as any)?.ragContext || null, cacheHit: audit?.cacheHit ?? null, usage: audit?.usage ?? null }, { headers: { "Cache-Control": "no-store" } });
}
