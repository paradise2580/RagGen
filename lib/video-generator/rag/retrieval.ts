import type { PrismaClient } from "@/prisma/generated/tenant";
import { CONTEXT_CHARS, digest, RagError, selectSources, type RagContext } from "./core";
import { embeddingConfig, embedTexts } from "./embeddings";
import { syncVector, vectorLiteral } from "./vector";
export { embeddingConfig } from "./embeddings";

export async function indexDocument(db: PrismaClient, documentId: string) {
  const config = embeddingConfig();
  const chunks = await db.ragChunk.findMany({ where: { documentId }, orderBy: { ordinal: "asc" } });
  const missing = chunks.filter(c => c.embeddingModel !== config.key || !c.embedding);
  let tokens = 0;
  for (let start = 0; start < missing.length; start += 32) {
    const batch = missing.slice(start, start + 32);
    const result = await embedTexts(batch.map(c => c.text)); tokens += result.tokens;
    for (let i=0;i<batch.length;i++) {
      await db.ragChunk.update({ where: { id: batch[i].id }, data: { embedding: result.vectors[i], embeddingModel: config.key } });
      await syncVector(db, batch[i].id, result.vectors[i]);
    }
  }
  // Backfill JSON embeddings after migration, or recover a partially completed write.
  for (const chunk of chunks) if (chunk.embeddingModel === config.key && Array.isArray(chunk.embedding)) await syncVector(db, chunk.id, chunk.embedding as number[]);
  return { chunksIndexed: missing.length, embeddingTokens: tokens };
}

export type RetrievalOptions = { serviceType?: string; modelType?: string; campaign?: string; provider?: string; modelVersion?: string; mode?: "none" | "lexical" | "hybrid" };
export async function retrieveBrandContext(db: PrismaClient, tenantId: string, brandId: string, query: string, options: RetrievalOptions = {}): Promise<RagContext> {
  const exists = await db.ragBrand.findFirst({ where: { id: brandId, tenantId } });
  if (!exists) throw new RagError("Brand not found",404);
  const config = embeddingConfig();
  let vector: number[] | null = null, embeddingTokens = 0, warning: string | undefined;
  const requested = options.mode || process.env.RAG_RETRIEVAL_MODE || "lexical";
  if (requested === "hybrid") {
    const indexed = await db.ragChunk.count({ where: { embeddingModel: config.key, document: { brandId, status: "APPROVED" } } });
    if (!indexed) warning = "No semantic index is available yet; keyword retrieval was used.";
    else try {
      const id = digest(JSON.stringify([tenantId,config.key,query]));
      const cached = await db.ragCache.findFirst({where:{id,expiresAt:{gt:new Date()}}});
      if(cached) vector=(cached.value as any).vector;
      else {
        const result=await embedTexts([query]);vector=result.vectors[0];embeddingTokens=result.tokens;
        await db.ragCache.upsert({where:{id},create:{id,scope:`embedding:${tenantId}`,value:{vector},expiresAt:new Date(Date.now()+86400000)},update:{value:{vector},expiresAt:new Date(Date.now()+86400000)}});
      }
    } catch { warning="Semantic retrieval unavailable; keyword retrieval was used."; }
  }
  const provider=options.provider||"KLING", model=options.modelVersion||process.env.KLING_VIDEO_MODEL||"kling-v3";
  const campaign=options.campaign||null, service=options.serviceType||null, modelType=options.modelType||null;
  const result = await db.$transaction(async tx => {
    const brand=await tx.ragBrand.findFirstOrThrow({where:{id:brandId,tenantId}});
    // SQL filters happen before ranking. No arbitrary 5,000-chunk truncation.
    const candidates = await tx.$queryRaw<{id:string;text:string;documentId:string;locator:string;title:string;contentHash:string;sourceJobId:string|null;lexical:number;semantic:number}[]>`
      WITH eligible AS (
        SELECT c.id,c.text,c."documentId",c.locator,c.vector,c."embeddingModel",d.title,d."contentHash",d."sourceJobId"
        FROM rag_chunks c JOIN rag_documents d ON d.id=c."documentId"
        JOIN rag_brands b ON b.id=d."brandId"
        LEFT JOIN video_generator_generation_jobs j ON j.id=d."sourceJobId"
        WHERE b.id=${brandId} AND b."tenantId"=${tenantId} AND d.status='APPROVED'
          AND (d.kind<>'EXAMPLE' OR EXISTS (SELECT 1 FROM rag_ratings r WHERE r."jobId"=d."sourceJobId" AND r."tenantId"=${tenantId} AND r.approved=true))
          AND (d."expiresAt" IS NULL OR d."expiresAt">now())
          AND (d.campaign IS NULL OR d.campaign=${campaign})
          AND (d.provider IS NULL OR d.provider=${provider})
          AND (d."modelVersion" IS NULL OR d."modelVersion"=${model})
          AND (d."sourceJobId" IS NULL OR (${service}::text IS NULL) OR (j."serviceType"::text=${service} AND j."modelType"::text=${modelType}))
      ), ranked AS (
        SELECT *,ts_rank_cd(to_tsvector('english',text),websearch_to_tsquery('english',${query}))::float8 AS lexical,
          CASE WHEN ${vector ? vectorLiteral(vector) : null}::vector IS NOT NULL AND "embeddingModel"=${config.key} AND vector IS NOT NULL THEN 1-(vector <=> ${vector ? vectorLiteral(vector) : null}::vector) ELSE 0 END::float8 AS semantic
        FROM eligible
      ), picks AS (
        (SELECT id FROM ranked WHERE lexical>0 ORDER BY lexical DESC LIMIT 40)
        UNION (SELECT id FROM ranked WHERE semantic>=0.35 ORDER BY semantic DESC LIMIT 40)
      ) SELECT id,text,"documentId",locator,title,"contentHash","sourceJobId",lexical,semantic FROM ranked WHERE id IN (SELECT id FROM picks)`;
    return {brand,candidates};
  },{isolationLevel:"RepeatableRead",timeout:15000});
  const {brand,candidates}=result;
  const lexical=[...candidates].filter(c=>c.lexical>0).sort((a,b)=>b.lexical-a.lexical);
  const semantic=[...candidates].filter(c=>c.semantic>=0.35).sort((a,b)=>b.semantic-a.semantic);
  const scores=new Map<string,number>();
  [lexical,semantic].forEach(list=>list.forEach((c,i)=>scores.set(c.id,(scores.get(c.id)||0)+1/(61+i))));
  const sources=requested === "none" ? [] : selectSources(candidates.map(c=>({documentId:c.documentId,chunkId:c.id,title:c.title,locator:c.locator,hash:c.contentHash,text:c.text,score:scores.get(c.id)||0,sourceJobId:c.sourceJobId})).sort((a,b)=>b.score-a.score),CONTEXT_CHARS);
  const contextChars=brand.description.length+brand.mandatoryRules.length+sources.reduce((n,s)=>n+s.text.length,0);
  return {brandId,brandName:brand.name,brandDescription:brand.description,revision:brand.revision,mandatoryRules:brand.mandatoryRules,sources,mode:vector?"hybrid":requested==="none"?"none":"lexical",...(warning?{warning}:{}),contextChars,estimatedContextTokens:Math.ceil(contextChars/4),approvedCorpusChars:candidates.reduce((n,c)=>n+c.text.length,0),embeddingTokens};
}

export function productFacts(product: { title: string | null; payload: any }) {
  const p = product.payload || {};
  const clean = (v: unknown, max: number) => typeof v === "string" ? v.replace(/<[^>]*>/g, " ").slice(0, max) : "";
  return { title: clean(product.title || p.title, 200), brand: clean(p.vendor || p.brand, 120), category: clean(p.product_type || p.category, 120), description: clean(p.description || p.body_html, 2500) };
}
