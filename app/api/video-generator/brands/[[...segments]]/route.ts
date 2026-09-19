import { boundedBody } from "@/lib/video-generator/rag/request";
import { enqueueUpload } from "@/lib/video-generator/rag/queue";
import { usageScope } from "@/lib/video-generator/rag/usage";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { gateVideoGenerator } from "@/lib/video-generator/context";
import { RagError, MAX_RULE_CHARS } from "@/lib/video-generator/rag/core";
import { ingestDocument, readOriginal } from "@/lib/video-generator/rag/documents";
import { indexDocument, productFacts, retrieveBrandContext } from "@/lib/video-generator/rag/retrieval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
const BrandBody = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(1500).default(""), mandatoryRules: z.string().trim().max(MAX_RULE_CHARS).default("") });


async function handle(req: NextRequest, { params }: { params: { segments?: string[] } }) {
  const gate = await gateVideoGenerator(req); if (!gate.ok) return gate.response;
  const { db } = gate.ctx; const tenantId = gate.ctx.tenantId || "standalone";
  const [brandId, resource, documentId] = params.segments || [];
  try {
    const body = async () => JSON.parse((await boundedBody(req, 20000)).toString("utf8"));
    if (!brandId) {
      if (req.method === "GET") {
        const brands = await db.ragBrand.findMany({ where: { tenantId }, orderBy: { name: "asc" }, include: { _count: { select: { documents: true } } } });
        return json(brands.map(b => ({ ...b, semanticEnabled: process.env.RAG_RETRIEVAL_MODE === "hybrid" })));
      }
      if (req.method === "POST") return json(await db.ragBrand.create({ data: { tenantId, ...BrandBody.parse(await body()) } }), 201);
    }
    const brand = await db.ragBrand.findFirst({ where: { id: brandId, tenantId } });
    if (!brand) throw new RagError("Brand not found", 404);
    if (!resource) {
      if (req.method === "GET") return json(brand);
      if (req.method === "PATCH") return json(await db.ragBrand.update({ where: { id: brandId }, data: { ...BrandBody.parse(await body()), revision: { increment: 1 } } }));
    }
    if (resource === "retrieve" && req.method === "POST") {
      const input = z.object({ query: z.string().trim().min(1).max(2000), productId: z.string().optional(), campaign: z.string().max(120).optional(), workflow: z.object({ serviceType: z.string().max(60), modelType: z.string().max(60) }).optional() }).parse(await body());
      const product = input.productId ? await db.productRecord.findUnique({ where: { id: input.productId } }) : null;
      if (input.productId && !product) throw new RagError("Product not found", 404);
      const query = input.query + (product ? `\n${JSON.stringify(productFacts(product))}` : "");
      return json(await retrieveBrandContext(db, tenantId, brandId, query, { ...input.workflow, campaign: input.campaign }));
    }
    if (resource === "documents" && !documentId) {
      if (req.method === "GET") return json(await db.ragDocument.findMany({ where: { brandId }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true, mime: true, createdAt: true, contentHash: true, sourceJobId: true, _count: { select: { chunks: true } } } }));
      if (req.method === "POST") {
        if (await db.ragDocument.count({ where: { brandId } }) >= 1000) throw new RagError("A brand can hold up to 1000 documents in this local release.", 409);
        let result;
        if (req.headers.get("content-type")?.includes("multipart/form-data")) {
          const bytes = await boundedBody(req, 11 * 1024 * 1024);
          const form = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": req.headers.get("content-type")! } }).formData();
          const file = form.get("file");
          if (!file || typeof file === "string") throw new RagError("Choose a document to upload.");
          const description = z.string().max(5000).parse(form.get("description") || "");
          const fileBytes = Buffer.from(await file.arrayBuffer());
          if (form.get("background") === "1" || /\.(pdf|docx|pptx|zip)$/i.test(file.name) || form.get("ocr") === "1" || form.get("caption") === "1") {
            const task = await enqueueUpload(db, tenantId, brandId, file.name, fileBytes, { description, ocr: form.get("ocr") === "1", caption: form.get("caption") === "1" });
            return json({ id: task.id, taskId: task.id, status: task.status, queued: true }, 202);
          }
          result = await ingestDocument(db, brandId, file.name, fileBytes, description);
        } else {
          const input = z.object({ sourceJobId: z.string().min(1) }).parse(await body());
          const job = await db.generationJob.findUnique({ where: { id: input.sourceJobId }, include: { promptVersions: { orderBy: { createdAt: "desc" }, take: 1 } } });
          if (!job || job.status !== "SUCCEEDED" || !job.promptVersions[0]) throw new RagError("Choose a completed generation with a saved prompt.");
          if ((job.inputJson as any).providerMode === "mock" || (job.promptVersions[0].outputJson as any)?.providerMode === "mock") throw new RagError("Mock generations cannot be used as examples.");
          if (!await db.ragRating.findFirst({ where: { tenantId, jobId: job.id, approved: true } })) throw new RagError("Review and approve this generation on its detail page before importing it.");
          const prompt = job.promptVersions[0];
          const text = `Creative example only. Do not copy product facts or claims.\nWorkflow: ${job.serviceType} / ${job.modelType}\nBrief: ${(job.inputJson as any).userInstructions || ""}\nPrompt: ${prompt.promptText}\nNegative prompt: ${prompt.negativePrompt || ""}`;
          result = await ingestDocument(db, brandId, `example-${job.id}.txt`, Buffer.from(text), "", job.id);
          await db.ragDocument.update({where:{id:result.document.id},data:{kind:"EXAMPLE"}});
        }
        return json({ id: result.document.id, title: result.document.title, status: result.document.status, duplicate: result.duplicate }, result.duplicate ? 200 : 201);
      }
    }
    if (resource === "documents" && documentId) {
      const document = await db.ragDocument.findFirst({ where: { id: documentId, brandId } });
      if (!document) throw new RagError("Document not found", 404);
      if (req.method === "GET") {
        if (req.nextUrl.searchParams.get("download") === "1") {
          if (!document.storageKey) throw new RagError("Original file unavailable", 404);
          return new NextResponse(new Uint8Array(await readOriginal(document.storageKey)), { headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.originalName)}`, "X-Content-Type-Options": "nosniff" } });
        }
        return json({ ...document, storageKey: undefined });
      }
      if (req.method === "PATCH") {
        const input = z.object({ campaign: z.string().max(120).nullable().optional(), expiresAt: z.string().datetime().nullable().optional(), provider: z.string().max(100).nullable().optional(), modelVersion: z.string().max(100).nullable().optional(), kind: z.enum(["GUIDELINE","TECHNIQUE","LESSON","EXAMPLE"]).optional(), status: z.enum(["DRAFT", "APPROVED", "ARCHIVED"]).optional(), index: z.boolean().optional() }).parse(await body());
        if (input.index) {
          if (process.env.RAG_RETRIEVAL_MODE !== "hybrid") throw new RagError("Semantic indexing is disabled. Set RAG_RETRIEVAL_MODE=hybrid to enable provider-backed embeddings.", 409);
          if (document.status !== "APPROVED") throw new RagError("Approve the document before creating its semantic index.");
          return json(await db.ragTask.create({ data: { tenantId, brandId, type: "INDEX", payload: { documentId } } }), 202);
        }

        const [updated] = await db.$transaction([
          db.ragDocument.update({ where: { id: documentId }, data: { status: input.status, campaign: input.campaign, expiresAt: input.expiresAt === undefined ? undefined : input.expiresAt ? new Date(input.expiresAt) : null, provider: input.provider, modelVersion: input.modelVersion, kind: input.kind } }),
          db.ragBrand.update({ where: { id: brandId }, data: { revision: { increment: 1 } } }),
        ]);
        if (input.status === "APPROVED" && process.env.RAG_EMBEDDING_PROVIDER !== "openai") await db.ragTask.create({ data: { tenantId, brandId, type: "INDEX", payload: { documentId } } });
        return json({ id: updated.id, status: updated.status });
      }
    }
    throw new RagError("Route not found", 404);
  } catch (error) {
    if (error instanceof RagError) return json({ message: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ message: error.issues[0]?.message || "Invalid request" }, 400);
    if (error instanceof SyntaxError) return json({ message: "Invalid JSON request" }, 400);
    console.error("[raggen] request failed", error instanceof Error ? error.name : "UnknownError");
    return json({ message: "Brand knowledge request failed. Check that the RagGen database and document storage are available." }, 500);
  }
}

async function scoped(req: NextRequest, args: { params: { segments?: string[] } }) {
 const gate = await gateVideoGenerator(req); if (!gate.ok) return gate.response;
 return usageScope.run({ db: gate.ctx.db, tenantId: gate.ctx.tenantId || "raggen" }, () => handle(req, args));
}
export const GET = scoped;
export const POST = scoped;
export const PATCH = scoped;
