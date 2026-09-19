import { RagError } from "./core";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/prisma/generated/tenant";
import { buildPromptMessages } from "../pipeline";
import { generatePromptText } from "../providers";
import { retrieveBrandContext } from "./retrieval";
import { usageScope } from "./usage";

export const evalCases = [
  ["hoodie","Soft studio push-in preserving the chest lettering"], ["sneakers","Slow side profile reveal on a warm neutral surface"],
  ["watch","Premium macro dial detail with restrained movement"], ["handbag","Gentle camera arc that preserves stitching"],
  ["bottle","Cool lighting and a slow push toward the label"], ["shirt","Natural fabric movement without distorting the print"],
].flatMap(([product,brief],i)=>["minimal","editorial","energetic","calm"].map((mood,j)=>({id:`case-${i*4+j+1}`,product,brief:`${brief}. Keep the mood ${mood}.`,description:`A ${product} photographed from the front, with its brand mark visible. Only this viewpoint is available.`})));

export async function executeEvaluation(db:PrismaClient,tenantId:string,runId:string){
  const run=await db.ragEvalRun.findFirstOrThrow({where:{id:runId,tenantId}});
  const task=await db.ragTask.findFirstOrThrow({where:{tenantId,type:"EVAL",payload:{path:["runId"],equals:runId}}});
  const brandId=(task.payload as any).brandId;
  await db.ragEvalRun.update({where:{id:runId},data:{status:"RUNNING"}});
  for(const c of evalCases){
    for(const variant of ["none","lexical","hybrid"] as const){
      if(await db.ragEvalResult.findUnique({where:{runId_caseId_variant:{runId,caseId:c.id,variant}}}))continue;
      const context=variant==="none"?null:await retrieveBrandContext(db,tenantId,brandId,`${c.product} ${c.brief}`,{mode:variant,serviceType:"PRODUCT_VIDEO_AD",modelType:"NO_MODEL"});
      const messages=buildPromptMessages({serviceType:"PRODUCT_VIDEO_AD",modelType:"NO_MODEL",productType:c.product,productDescription:c.description,combinedDescription:c.description,userInstructions:c.brief,hasEndFrame:false,ragContext:context});
      let usage:any=null;
      const started=Date.now();
      const prompt=run.providerMode==="mock"?JSON.stringify({finalPrompt:`[MOCK EVALUATION] ${c.brief}`,negativePrompt:"product deformation"}):await generatePromptText({...messages,model:run.model,onUsage:u=>{usage=u;}});
      await db.ragEvalResult.create({data:{runId,caseId:c.id,variant,blindLabel:randomUUID().slice(0,8),prompt,context:context as any||{},metrics:{usage,elapsedMs:Date.now()-started,inputCharacters:messages.system.length+messages.user.length,mock:run.providerMode==="mock",degraded:run.providerMode!=="mock"&&!usage,retrievalMode:context?.mode||"none"}}});
    }
  }
  await db.ragEvalRun.update({where:{id:runId},data:{status:"SUCCEEDED"}});
  return {runId,cases:evalCases.length,variants:3};
}

export async function activateEvaluatedModel(db:PrismaClient,tenantId:string,runId:string){
  const run=await db.ragEvalRun.findFirstOrThrow({where:{id:runId,tenantId},include:{results:true}});
  if(run.status!=="SUCCEEDED"||run.providerMode==="mock")throw new RagError("Only completed live evaluations can activate a model.");
  const evaluated=run.results.filter(r=>r.variant==="hybrid"&&r.humanScores&&(r.metrics as any)?.retrievalMode==="hybrid"&&!(r.metrics as any)?.degraded);
  if(evaluated.length<20)throw new RagError("Rate at least 20 non-degraded hybrid results before activating a model.");
  for(const dimension of ["fidelity","briefAdherence","brandFit"]){const avg=evaluated.reduce((n,r)=>n+Number((r.humanScores as any)[dimension]||0),0)/evaluated.length;if(avg<4)throw new RagError(`Model did not meet the 4/5 ${dimension} threshold.`);}
  const id=`prompt-route:${tenantId}`,value={model:run.model,evaluationRunId:runId},expiresAt=new Date(Date.now()+365*86400000);
  await db.ragCache.upsert({where:{id},create:{id,scope:`routing:${tenantId}`,value,expiresAt},update:{value,expiresAt}});
  return value;
}
