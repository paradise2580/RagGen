import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { prisma as db } from "../lib/db";
import { runNextTask } from "../lib/video-generator/rag/queue";
import { documentPath } from "../lib/video-generator/rag/documents";
const base="http://127.0.0.1:5177/api/video-generator",tag=randomUUID();let brandId="",assetId="",jobId="",runId="",passed=0;
async function request(path:string,method="GET",body?:any){const multipart=body instanceof FormData;const r=await fetch(base+path,{method,headers:{...(process.env.VIDEO_GENERATOR_API_TOKEN?{"x-api-token":process.env.VIDEO_GENERATOR_API_TOKEN}:{}),...(!multipart?{"Content-Type":"application/json"}:{})},body:body?(multipart?body:JSON.stringify(body)):undefined});return {status:r.status,data:await r.json()};}
const pass=(label:string)=>{passed++;console.log(`PASS ${label}`);};
async function main(){
 assert.equal(new URL(process.env.TENANT_DATABASE_URL!).pathname,"/raggen");process.env.PROVIDER_MODE="mock";process.env.RAG_EMBEDDING_PROVIDER="local";
 const b=await request("/brands","POST",{name:`Workflow ${tag}`});assert.equal(b.status,201);brandId=b.data.id;
 const form=new FormData();form.append("background","1");form.append("file",new Blob(["Brand footwear should use warm neutral studio lighting and keep all logo lettering unchanged."]),"workflow.txt");
 const uploaded=await request(`/brands/${brandId}/documents`,"POST",form);assert.equal(uploaded.status,202);
 const tenantId=process.env.VIDEO_GENERATOR_TENANT_ID||"raggen";
 await runNextTask(db,tenantId);
 const docs=(await request(`/brands/${brandId}/documents`)).data;assert.equal(docs.length,1);pass("background upload becomes a reviewable draft");
 assert.equal((await request(`/brands/${brandId}/documents/${docs[0].id}`,"PATCH",{status:"APPROVED"})).status,200);await runNextTask(db,tenantId);
 const preview=await request(`/brands/${brandId}/retrieve`,"POST",{query:"footwear studio lighting"});assert.equal(preview.data.mode,"hybrid");assert.equal(preview.data.sources.length,1);pass("approval queues local vectors and HTTP retrieval uses hybrid search");
 const asset=await db.generationAsset.create({data:{type:"GENERATED_VIDEO",source:"GENERATED",status:"READY"}});assetId=asset.id;
 const caption=await request("/rag/captions","POST",{assetId,brandId,text:"Black sneakers on a warm studio backdrop, slow side reveal, restrained luxury lighting.",status:"APPROVED"});assert.equal(caption.status,200);await runNextTask(db,tenantId);
 const search=await request("/rag/search","POST",{brandId,query:"black shoes studio"});assert.equal(search.status,200);assert.ok(search.data.results.some((r:any)=>r.assetId===assetId));pass("approved video captions are indexed and searchable");
 await request("/rag/captions","POST",{assetId,brandId,text:"Black sneakers on a warm studio backdrop, slow side reveal, restrained luxury lighting.",status:"DRAFT"});
 assert.equal((await request("/rag/search","POST",{brandId,query:"black shoes studio"})).data.results.length,0);pass("draft video captions are excluded immediately");
 const job=await db.generationJob.create({data:{serviceType:"PRODUCT_VIDEO_AD",modelType:"NO_MODEL",status:"SUCCEEDED",inputJson:{providerMode:"mock"}}});jobId=job.id;
 assert.equal((await request(`/rag/ratings/${jobId}`,"POST",{fidelity:5,briefAdherence:5,brandFit:5,approved:true,notes:""})).status,400);pass("mock output cannot become an approved creative example");
 assert.equal((await request(`/rag/ratings/${jobId}`,"POST",{fidelity:2,briefAdherence:3,brandFit:2,approved:false,notes:"Preserve the original chest logo without changing letter spacing."})).status,200);
 const lesson=await request("/rag/lessons","POST",{brandId,jobId,correction:"Preserve the original chest logo without changing letter spacing."});assert.equal(lesson.status,201);assert.equal(lesson.data.status,"DRAFT");pass("human corrections enter knowledge as drafts");
 const evalRun=await db.ragEvalRun.create({data:{tenantId,name:tag,providerMode:"mock",model:"mock",status:"SUCCEEDED",results:{create:{caseId:"case-1",variant:"hybrid",blindLabel:"blind",prompt:"Test output",context:{},metrics:{mock:true}}}}});runId=evalRun.id;
 const blind=(await request(`/rag/evaluations/${runId}`)).data;assert.equal(blind.results[0].variant,undefined);assert.equal(blind.results[0].metrics,undefined);
 const reveal=(await request(`/rag/evaluations/${runId}?reveal=1`)).data;assert.equal(reveal.results[0].variant,"hybrid");assert.equal((await request(`/rag/evaluations/${runId}/activate`,"POST",{})).status,400);pass("blind evaluation hides variants; mock activation rejected");
 assert.equal((await request("/rag/usage")).status,200);pass("usage dashboard API responds");
 console.log(`\n${passed} workflow HTTP checks passed; no paid calls.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 if(runId)await db.ragEvalRun.delete({where:{id:runId}});
 if(brandId){const docs=await db.ragDocument.findMany({where:{brandId}});await db.ragTask.deleteMany({where:{brandId}});await db.ragBrand.delete({where:{id:brandId}});for(const d of docs)if(d.storageKey)await unlink(documentPath(d.storageKey)).catch(()=>{});}
 if(assetId){const captions=await db.ragVideoCaption.findMany({where:{assetId}});for(const c of captions)await db.ragTask.deleteMany({where:{payload:{path:["captionId"],equals:c.id}}});await db.ragVideoCaption.deleteMany({where:{assetId}});await db.generationAsset.delete({where:{id:assetId}});}
 if(jobId){await db.ragRating.deleteMany({where:{jobId}});await db.generationJob.delete({where:{id:jobId}});}await db.$disconnect();
});
