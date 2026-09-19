import { digest } from "./core";
import type { PrismaClient } from "@/prisma/generated/tenant";
import { embeddingConfig, embedTexts } from "./embeddings";
import { syncVector, vectorLiteral } from "./vector";
export async function indexCaption(db:PrismaClient,id:string){
  const row=await db.ragVideoCaption.findUniqueOrThrow({where:{id}});const config=embeddingConfig();
  if(row.status!=="APPROVED")return;
  if(row.embeddingModel===config.key&&Array.isArray(row.embedding))return;
  const result=await embedTexts([row.text]);await db.$transaction(async tx=>{const updated=await tx.ragVideoCaption.updateMany({where:{id,updatedAt:row.updatedAt,status:"APPROVED"},data:{embedding:result.vectors[0],embeddingModel:config.key}});if(updated.count)await syncVector(tx,id,result.vectors[0],"rag_video_captions");});
}
export async function searchLibrary(db:PrismaClient,tenantId:string,query:string,brandId?:string){
  const config=embeddingConfig();let vector:number[]|null=null,warning:string|undefined;
  if(process.env.RAG_RETRIEVAL_MODE==="hybrid")try{
    const id=digest(JSON.stringify([tenantId,config.key,query]));
    const cached=await db.ragCache.findFirst({where:{id,expiresAt:{gt:new Date()}}});
    if(cached)vector=(cached.value as any).vector;
    else{vector=(await embedTexts([query])).vectors[0];const expiresAt=new Date(Date.now()+86400000);await db.ragCache.upsert({where:{id},create:{id,scope:`embedding:${tenantId}`,value:{vector},expiresAt},update:{value:{vector},expiresAt}});}
  }catch{warning="Semantic search unavailable; keyword matches are shown.";}
  const rows=await db.$queryRaw<{id:string;assetId:string;jobId:string|null;brandId:string|null;text:string;lexical:number;semantic:number}[]>`
    WITH matches AS (SELECT c.id,c."assetId",c."jobId",c."brandId",c.text,
      ts_rank_cd(to_tsvector('english',c.text),websearch_to_tsquery('english',${query}))::float8 AS lexical,
      CASE WHEN c."embeddingModel"=${config.key} AND ${vector?vectorLiteral(vector):null}::vector IS NOT NULL AND c.vector IS NOT NULL THEN 1-(c.vector <=> ${vector?vectorLiteral(vector):null}::vector) ELSE 0 END::float8 AS semantic
      FROM rag_video_captions c JOIN video_generator_assets a ON a.id=c."assetId"
      WHERE c."tenantId"=${tenantId} AND c.status='APPROVED' AND a.status='READY' AND (${brandId||null}::text IS NULL OR c."brandId"=${brandId||null}))
    SELECT * FROM matches WHERE id IN ((SELECT id FROM matches WHERE lexical>0 ORDER BY lexical DESC LIMIT 40) UNION (SELECT id FROM matches WHERE semantic>=0.35 ORDER BY semantic DESC LIMIT 40))`;
  // Reciprocal rank fusion avoids treating a keyword score as a cosine distance.
  const ranks=new Map<string,number>();
  [[...rows].filter(r=>r.lexical>0).sort((a,b)=>b.lexical-a.lexical),[...rows].filter(r=>r.semantic>=0.35).sort((a,b)=>b.semantic-a.semantic)].forEach(list=>list.forEach((r,i)=>ranks.set(r.id,(ranks.get(r.id)||0)+1/(61+i))));
  return {results:rows.sort((a,b)=>(ranks.get(b.id)||0)-(ranks.get(a.id)||0)).slice(0,30),mode:vector?"hybrid":"lexical",warning};
}
