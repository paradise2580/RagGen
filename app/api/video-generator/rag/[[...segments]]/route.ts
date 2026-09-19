import { boundedBody } from "@/lib/video-generator/rag/request";
import { NextResponse,type NextRequest } from "next/server";
import { z } from "zod";
import { gateVideoGenerator } from "@/lib/video-generator/context";
import { RagError } from "@/lib/video-generator/rag/core";
import { BudgetError, monthStart, usageScope } from "@/lib/video-generator/rag/usage";
import { searchLibrary,indexCaption } from "@/lib/video-generator/rag/library";
import { activateEvaluatedModel,evalCases } from "@/lib/video-generator/rag/evaluations";
import { ingestDocument } from "@/lib/video-generator/rag/documents";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});
const scores=z.object({fidelity:z.number().int().min(1).max(5),briefAdherence:z.number().int().min(1).max(5),brandFit:z.number().int().min(1).max(5)});
export async function GET(req:NextRequest,args:{params:{segments?:string[]}}){return dispatch(req,args);}
export async function POST(req:NextRequest,args:{params:{segments?:string[]}}){return dispatch(req,args);}
export async function PATCH(req:NextRequest,args:{params:{segments?:string[]}}){return dispatch(req,args);}
async function dispatch(req:NextRequest,{params}:{params:{segments?:string[]}}){
 const gate=await gateVideoGenerator(req);if(!gate.ok)return gate.response;
 const {db,userId,role}=gate.ctx,tenantId=gate.ctx.tenantId||"raggen";
 return usageScope.run({db,tenantId},async()=>{try{
  const [resource,id,action]=params.segments||[];
  async function body(){try{return JSON.parse((await boundedBody(req,20000)).toString("utf8"));}catch(e){if(e instanceof RagError)throw e;throw new RagError("Invalid JSON request");}}
  const owner=()=>{if(role!=="OWNER")throw new RagError("Workspace owner permission required",403);};
  if(resource==="tasks"){
   if(req.method==="GET")return json(await db.ragTask.findMany({where:{tenantId,...(req.nextUrl.searchParams.get("brandId")?{brandId:req.nextUrl.searchParams.get("brandId")!}:{})},select:{id:true,type:true,status:true,progress:true,attempts:true,error:true,result:true,createdAt:true},orderBy:{createdAt:"desc"},take:100}));
   const task=await db.ragTask.findFirst({where:{id,tenantId}});if(!task)throw new RagError("Task not found",404);
   if(req.method==="POST"&&action==="retry"&&task.status==="FAILED"){await db.ragTask.update({where:{id},data:{status:"QUEUED",attempts:0,nextAt:new Date(),error:null}});return json({ok:true});}
  }
  if(resource==="usage"){
   const records=await db.ragUsage.findMany({where:{tenantId,createdAt:{gte:monthStart()}},orderBy:{createdAt:"desc"}});
   const actualMicros=records.reduce((s,r)=>s+(r.costMicros||0),0),reservedMicros=records.filter(r=>r.costMicros==null).reduce((s,r)=>s+r.reservedMicros,0);
   return json({budget:await db.ragBudget.findUnique({where:{tenantId}}),actualMicros,reservedMicros,unpricedCalls:records.filter(r=>r.status==="UNPRICED").length,records:records.slice(0,100),prices:await db.ragPrice.findMany({orderBy:{createdAt:"desc"},take:100}),routing:await db.ragCache.findUnique({where:{id:`prompt-route:${tenantId}`}})});
  }
  if(resource==="budget"&&req.method==="POST"){owner();const data=z.object({monthlyLimitMicros:z.number().int().min(0).max(2000000000).nullable()}).parse(await body());return json(await db.ragBudget.upsert({where:{tenantId},create:{tenantId,...data},update:data}));}
  if(resource==="prices"&&req.method==="POST"){
   owner();const rate=z.number().finite().min(0).max(10000);
   const data=z.object({provider:z.enum(["OPENAI","ANTHROPIC","KLING","RUNWAY"]),model:z.string().min(1).max(100),operation:z.string().max(40).default("*"),inputPerMillion:rate,outputPerMillion:rate,cacheReadPerMillion:rate,cacheWritePerMillion:rate,unitMicros:z.number().int().min(0).max(100000000),version:z.string().min(1).max(100)}).parse(await body());
   return json(await db.ragPrice.create({data}),201);
  }
  if(resource==="ratings"&&id){
   const job=await db.generationJob.findUnique({where:{id}});if(!job)throw new RagError("Generation not found",404);
   if(req.method==="GET")return json({rating:await db.ragRating.findUnique({where:{tenantId_jobId_userId:{tenantId,jobId:id,userId}}}),qa:(job.inputJson as any)._qa||null,providerMode:(job.inputJson as any).providerMode||"unknown"});
   const data=scores.extend({approved:z.boolean(),notes:z.string().max(3000)}).parse(await body());
   if(data.approved&&((job.inputJson as any).providerMode==="mock"||job.status!=="SUCCEEDED"))throw new RagError("Mock or incomplete generations cannot become approved examples.");
   return json(await db.ragRating.upsert({where:{tenantId_jobId_userId:{tenantId,jobId:id,userId}},create:{tenantId,jobId:id,userId,...data},update:data}));
  }
  if(resource==="lessons"&&req.method==="POST"){
   const data=z.object({brandId:z.string(),jobId:z.string(),correction:z.string().min(20).max(5000)}).parse(await body());
   const brand=await db.ragBrand.findFirst({where:{id:data.brandId,tenantId}}),job=await db.generationJob.findUnique({where:{id:data.jobId}});
   if(!brand||!job)throw new RagError("Brand or generation not found",404);
   const qa=(job.inputJson as any)._qa;
   const text=`Reviewed correction for a previous generation. Apply only where relevant.\nWorkflow: ${job.serviceType}/${job.modelType}\nObserved QA: ${JSON.stringify(qa?.latest?.scores||{})}\nHuman correction: ${data.correction}`;
   const result=await ingestDocument(db,brand.id,`lesson-${job.id}.txt`,Buffer.from(text),"",job.id);
   await db.ragDocument.update({where:{id:result.document.id},data:{kind:"LESSON"}});return json({id:result.document.id,status:"DRAFT"},201);
  }
  if(resource==="captions"){
   if(req.method==="GET")return json(await db.ragVideoCaption.findMany({where:{tenantId},orderBy:{updatedAt:"desc"}}));
   const data=z.object({assetId:z.string(),brandId:z.string().optional(),jobId:z.string().optional(),text:z.string().trim().min(20).max(3000),status:z.enum(["DRAFT","APPROVED"])}).parse(await body());
   const asset=await db.generationAsset.findUnique({where:{id:data.assetId}});if(!asset||asset.type!=="GENERATED_VIDEO")throw new RagError("Video not found",404);
   if(data.brandId&&!await db.ragBrand.findFirst({where:{id:data.brandId,tenantId}}))throw new RagError("Brand not found",404);
   if(data.jobId&&!await db.generationJob.findUnique({where:{id:data.jobId}}))throw new RagError("Generation not found",404);
   const row=await db.ragVideoCaption.upsert({where:{tenantId_assetId:{tenantId,assetId:data.assetId}},create:{tenantId,...data},update:{...data,embeddingModel:null}});
   if(row.status==="APPROVED")await db.ragTask.create({data:{tenantId,type:"CAPTION_INDEX",payload:{captionId:row.id}}});
   return json(row);
  }
  if(resource==="search"&&req.method==="POST"){const data=z.object({query:z.string().trim().min(1).max(2000),brandId:z.string().optional()}).parse(await body());return json(await searchLibrary(db,tenantId,data.query,data.brandId));}
  if(resource==="evaluations"){
   if(req.method==="GET"){
    if(!id)return json({cases:evalCases,runs:await db.ragEvalRun.findMany({where:{tenantId},orderBy:{createdAt:"desc"},take:50})});
    const run=await db.ragEvalRun.findFirst({where:{id,tenantId},include:{results:{orderBy:{blindLabel:"asc"}}}});if(!run)throw new RagError("Evaluation not found",404);
    const reveal=req.nextUrl.searchParams.get("reveal")==="1";
    return json({...run,results:run.results.map(r=>reveal?r:{id:r.id,caseId:r.caseId,blindLabel:r.blindLabel,prompt:r.prompt,humanScores:r.humanScores})});
   }
   if(action==="activate"){owner();return json(await activateEvaluatedModel(db,tenantId,id));}
   if(action==="rate"){
    const data=scores.extend({resultId:z.string()}).parse(await body());const result=await db.ragEvalResult.findFirst({where:{id:data.resultId,runId:id,run:{tenantId}}});if(!result)throw new RagError("Result not found",404);
    return json(await db.ragEvalResult.update({where:{id:result.id},data:{humanScores:{fidelity:data.fidelity,briefAdherence:data.briefAdherence,brandFit:data.brandFit}}}));
   }
   if(!id&&req.method==="POST"){
    const data=z.object({brandId:z.string(),name:z.string().min(1).max(120),model:z.string().min(1).max(100),live:z.boolean().default(false)}).parse(await body());
    if(!await db.ragBrand.findFirst({where:{id:data.brandId,tenantId}}))throw new RagError("Brand not found",404);
    if(data.live&&(process.env.PROVIDER_MODE==="mock"||!process.env.ANTHROPIC_API_KEY))throw new RagError("Live evaluation requires an enabled prompt provider.");
    const run=await db.ragEvalRun.create({data:{tenantId,name:data.name,model:data.model,providerMode:data.live?"live":"mock"}});
    await db.ragTask.create({data:{tenantId,brandId:data.brandId,type:"EVAL",payload:{runId:run.id,brandId:data.brandId}}});return json(run,202);
   }
  }
  throw new RagError("Route not found",404);
 }catch(e){if(e instanceof RagError)return json({message:e.message},e.status);if(e instanceof BudgetError)return json({message:e.message},402);if(e instanceof z.ZodError)return json({message:e.issues[0]?.message},400);return json({message:"Operation failed. Check the server configuration and try again."},400);}});
}
