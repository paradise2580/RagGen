import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { zipSync,strToU8 } from "fflate";
import { createCanvas } from "canvas";
import { prisma as db } from "../lib/db";
import { extractDocument,ingestDocument,documentPath } from "../lib/video-generator/rag/documents";
import { enqueueUpload,runNextTask,claimTask,unpackKit } from "../lib/video-generator/rag/queue";
import { retrieveBrandContext,indexDocument } from "../lib/video-generator/rag/retrieval";
import { metered,usageScope,BudgetError,calculateMicros } from "../lib/video-generator/rag/usage";
import { resolveIdentity,hashPassword,verifyPassword,tokenHash,sameOrigin } from "../lib/rag-auth";
import { singleFlight,publicAddress } from "../lib/video-generator/rag/vision";
import { activateEvaluatedModel } from "../lib/video-generator/rag/evaluations";
import { buildPromptMessages } from "../lib/video-generator/pipeline";

const tenant=`ext-${randomUUID()}`, files=new Set<string>();let checks=0;
async function check(name:string,fn:()=>unknown|Promise<unknown>){await fn();checks++;console.log(`PASS ${name}`);}
async function main(){
 assert.equal(new URL(process.env.TENANT_DATABASE_URL!).pathname,"/raggen");
 process.env.PROVIDER_MODE="mock";process.env.RAG_EMBEDDING_PROVIDER="local";process.env.RAG_RETRIEVAL_MODE="hybrid";
 const brand=await db.ragBrand.create({data:{tenantId:tenant,name:"Extended test"}});
 await check("PPTX slide extraction",async()=>{
  const pptx=zipSync({"ppt/slides/slide1.xml":strToU8('<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><a:t>Keep the logo unchanged. Use restrained studio lighting.</a:t></p:cSld></p:sld>')});
  assert.match((await extractDocument("kit.pptx",Buffer.from(pptx))).text,/restrained/);
 });
 await check("ZIP paths, nested archives and expansion limits",()=>{
  assert.throws(()=>unpackKit(Buffer.from(zipSync({"../escape.txt":strToU8("bad")}))));
  assert.throws(()=>unpackKit(Buffer.from(zipSync({"inner.zip":new Uint8Array(2)}))));
  assert.throws(()=>unpackKit(Buffer.from(zipSync({"huge.txt":new Uint8Array(11*1024*1024)}))));
  assert.equal(unpackKit(Buffer.from(zipSync({"kit/guide.txt":strToU8("Good")})))[0].name,"guide.txt");
 });
 await check("local OCR recognizes a real image",async()=>{
  const canvas=createCanvas(1100,220),ctx=canvas.getContext("2d");ctx.fillStyle="white";ctx.fillRect(0,0,1100,220);ctx.fillStyle="black";ctx.font="42px Arial";ctx.fillText("ACME BRAND GUIDELINES",30,70);ctx.fillText("Keep the logo unchanged.",30,150);
  assert.match((await extractDocument("scan.png",canvas.toBuffer("image/png"),"",{ocr:true})).text,/logo unchanged/i);
 });
 await check("durable queued kit ingestion and duplicate retry",async()=>{
  const bytes=Buffer.from(zipSync({"guidelines.txt":strToU8("Footwear should use warm studio lighting. Shoes keep their original silhouette.")}));
  const task=await enqueueUpload(db,tenant,brand.id,"kit.zip",bytes,{ocr:true});files.add((task.payload as any).storageKey);
  assert.equal(await runNextTask(db,tenant),true);assert.equal((await db.ragTask.findUniqueOrThrow({where:{id:task.id}})).status,"SUCCEEDED");
  await enqueueUpload(db,tenant,brand.id,"kit.zip",bytes);await runNextTask(db,tenant);
  // OCR is irrelevant to plain text but part of extraction provenance; retries of identical options deduplicate.
  await enqueueUpload(db,tenant,brand.id,"kit.zip",bytes);await runNextTask(db,tenant);
  assert.equal(await db.ragDocument.count({where:{brandId:brand.id}}),2);
 });
 await check("concurrent workers claim a task only once and recover expired leases",async()=>{
  const task=await db.ragTask.create({data:{tenantId:tenant,type:"TEST",payload:{}}});
  const results=await Promise.all([claimTask(db,tenant),claimTask(db,tenant)]);assert.equal(results.filter(Boolean).length,1);
  await db.ragTask.update({where:{id:task.id},data:{lockedUntil:new Date(0)}});assert.equal((await claimTask(db,tenant))?.id,task.id);
  await db.ragTask.delete({where:{id:task.id}});
 });
 const doc=(await db.ragDocument.findFirstOrThrow({where:{brandId:brand.id}}));
 await db.ragDocument.update({where:{id:doc.id},data:{status:"APPROVED"}});
 await check("local embeddings persist to pgvector and semantic synonyms retrieve",async()=>{
  await indexDocument(db,doc.id);
  const context=await retrieveBrandContext(db,tenant,brand.id,"shoes in a photography studio");assert.equal(context.mode,"hybrid");assert.ok(context.sources.some(s=>s.documentId===doc.id));
  const rows=await db.$queryRaw<{dimensions:number}[]>`SELECT vector_dims(vector) AS dimensions FROM rag_chunks WHERE "documentId"=${doc.id}`;assert.equal(rows[0].dimensions,384);
 });
 await check("campaign, expiry, provider and model scope filter before retrieval",async()=>{
  await db.ragDocument.update({where:{id:doc.id},data:{campaign:"holiday"}});
  assert.equal((await retrieveBrandContext(db,tenant,brand.id,"footwear lighting",{mode:"lexical"})).sources.length,0);
  assert.ok((await retrieveBrandContext(db,tenant,brand.id,"footwear lighting",{mode:"lexical",campaign:"holiday"})).sources.length);
  await db.ragDocument.update({where:{id:doc.id},data:{campaign:null,expiresAt:new Date(0)}});
  assert.equal((await retrieveBrandContext(db,tenant,brand.id,"footwear lighting",{mode:"lexical"})).sources.length,0);
  await db.ragDocument.update({where:{id:doc.id},data:{expiresAt:null,provider:"RUNWAY"}});
  assert.equal((await retrieveBrandContext(db,tenant,brand.id,"footwear lighting",{mode:"lexical"})).sources.length,0);
  await db.ragDocument.update({where:{id:doc.id},data:{provider:null,modelVersion:"obsolete"}});
  assert.equal((await retrieveBrandContext(db,tenant,brand.id,"footwear lighting",{mode:"lexical"})).sources.length,0);
  await db.ragDocument.update({where:{id:doc.id},data:{modelVersion:null}});
 });
 await check("cached-token price accounting",()=>{
  assert.equal(calculateMicros({inputPerMillion:2,outputPerMillion:10,cacheReadPerMillion:.2,cacheWritePerMillion:2.5,unitMicros:0},{inputTokens:100,outputTokens:10,cacheReadTokens:50,cacheWriteTokens:0}),210);
 });
 await check("concurrent budget reservations prevent overbooking and retain uncertain charges",async()=>{
  await db.ragPrice.create({data:{provider:"TEST",model:tenant,version:tenant,inputPerMillion:1,outputPerMillion:0}});
  await db.ragBudget.create({data:{tenantId:tenant,monthlyLimitMicros:10}});
  let calls=0;const results=await usageScope.run({db,tenantId:tenant},()=>Promise.allSettled([1,2].map(()=>metered("TEST",tenant,"test",async()=>{calls++;await new Promise(r=>setTimeout(r,50));throw new Error("Timeout");},{maxInput:10,maxOutput:0}))));
  assert.equal(calls,1);assert.ok(results.some(r=>r.status==="rejected"&&r.reason instanceof BudgetError));
  assert.equal((await db.ragUsage.findFirstOrThrow({where:{tenantId:tenant}})).reservedMicros,10);
  await assert.rejects(usageScope.run({db,tenantId:tenant},()=>metered("TEST","missing","test",async()=>{throw new Error("Must not call");})),BudgetError);
 });
 await check("authentication validates sessions and workspace membership",async()=>{
  process.env.RAG_AUTH_MODE="required";const hash=await hashPassword("test-password-long");assert.ok(await verifyPassword("test-password-long",hash));assert.equal(await verifyPassword("wrong",hash),false);
  await db.ragWorkspace.create({data:{id:tenant,name:"Test",databaseName:tenant.replaceAll("-","_")}});
  const user=await db.ragUser.create({data:{email:`${tenant}@test.invalid`,name:"Test",passwordHash:hash,memberships:{create:{workspaceId:tenant,role:"EDITOR"}}}});
  await db.ragSession.create({data:{id:tokenHash(tenant),userId:user.id,expiresAt:new Date(Date.now()+60000)}});
  const req=(workspace:string)=>new Request("http://localhost:3101/api/video-generator/brands",{headers:{cookie:`raggen-session=${tenant}`,"x-workspace-id":workspace}});
  assert.equal((await resolveIdentity(req(tenant)))?.role,"EDITOR");assert.equal(await resolveIdentity(req("unauthorized")),null);
  assert.equal(sameOrigin(new Request("http://localhost:3101/api/test",{headers:{origin:"https://attacker.invalid"}})),false);
  await db.ragUser.delete({where:{id:user.id}});await db.ragWorkspace.delete({where:{id:tenant}});process.env.RAG_AUTH_MODE="local";
 });
 await check("vision request coalescing and private-address blocking",async()=>{
  let calls=0;await Promise.all([1,2,3].map(()=>singleFlight(tenant,async()=>{calls++;await new Promise(r=>setTimeout(r,20));return "ok";})));assert.equal(calls,1);
  for(const ip of ["127.0.0.1","10.0.0.1","192.168.1.1","::1","fc00::1","::ffff:127.0.0.1"])assert.equal(publicAddress(ip),false);
 });
 await check("static prompt prefix remains stable across briefs",()=>{
  const base={serviceType:"PRODUCT_VIDEO_AD",modelType:"NO_MODEL",productType:"hoodie",productDescription:"A hoodie",combinedDescription:"A hoodie",hasEndFrame:true};
  assert.equal(buildPromptMessages({...base,userInstructions:"Warm studio",motion:"Slow arc"}).system,buildPromptMessages({...base,userInstructions:"Cold outdoor",motion:"Quick orbit"}).system);
 });
 await check("24-case blind benchmark runs all 72 mock variants and cannot activate routing",async()=>{
  const run=await db.ragEvalRun.create({data:{tenantId:tenant,name:"Test",providerMode:"mock",model:"mock"}});
  await db.ragTask.create({data:{tenantId:tenant,brandId:brand.id,type:"EVAL",payload:{runId:run.id,brandId:brand.id}}});
  await runNextTask(db,tenant);assert.equal((await db.ragEvalRun.findUniqueOrThrow({where:{id:run.id}})).status,"SUCCEEDED");
  assert.equal(await db.ragEvalResult.count({where:{runId:run.id}}),72);await assert.rejects(activateEvaluatedModel(db,tenant,run.id),/live evaluations/);
 });
 console.log(`\n${checks} extended checks passed; no paid providers called.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 for(const d of await db.ragDocument.findMany({where:{brand:{tenantId:tenant}}}))if(d.storageKey)files.add(d.storageKey);
 for(const t of await db.ragTask.findMany({where:{tenantId:tenant}}))if((t.payload as any).storageKey)files.add((t.payload as any).storageKey);
 await db.ragEvalRun.deleteMany({where:{tenantId:tenant}});await db.ragTask.deleteMany({where:{tenantId:tenant}});await db.ragBrand.deleteMany({where:{tenantId:tenant}});
 await db.ragUsage.deleteMany({where:{tenantId:tenant}});await db.ragBudget.deleteMany({where:{tenantId:tenant}});await db.ragPrice.deleteMany({where:{version:tenant}});await db.ragCache.deleteMany({where:{scope:{contains:tenant}}});
 await db.ragUser.deleteMany({where:{email:`${tenant}@test.invalid`}});await db.ragWorkspace.deleteMany({where:{id:tenant}});
 for(const key of files)await unlink(documentPath(key)).catch(()=>{});await db.$disconnect();
});
